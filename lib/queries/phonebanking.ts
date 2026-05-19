import { runQuery, PROJECT, DATASET } from "../bigquery";
import { assertDataAccessAllowed } from "@/lib/credentials/gate";
import { isValidIsoDate } from "../validation/iso-date";
import { rowToPhoneBankSummary, toNum, toStr, toDateString } from "./bq-row-parsers";
import {
  loadCallSurveyFillSnapshot,
  loadDailyCallerSnapshot,
  loadPhoneBanksSnapshot,
  loadQuestionStatsSnapshot,
  saveCallSurveyFillSnapshot,
  saveDailyCallerSnapshot,
  savePhoneBanksSnapshot,
  saveQuestionStatsSnapshot,
  snapshotsDisabled,
} from "../bq-snapshot-store";
import { cachedBq } from "../bq-cache";
import { buildTagWhereClause, getTagById } from "../campaign-tags";
import { phonebankingPhoneBanksTag } from "../phonebanking-data-cache";
import { canonicalizePhonebankerName } from "../phonebanker-name";
import { buildDisclaimerHintsPattern, buildPhraseNormalizedExpr } from "../survey-i18n/bq-expressions";
import {
  SCRIPT_BLOCK_EXCLUSION_REGEX_BODY,
  TRACI_SCRIPT_EXCLUSION_REGEX_BODY,
} from "../survey-i18n/rules";
import type {
  PhoneBankSummary,
  PhonebankerDailyStat,
  PhonebankerAggregateStat,
  PhoneBankDetail,
  TagDailyCallerStat,
  PhonebankerQuestionResponseStat,
  CallSurveyRowForFill,
} from "../types";

const P = PROJECT;
const D = DATASET;
const PHONEBANK_WINDOW_START_DATE = "2025-12-01";

/** When session credentials are enabled, block shared snapshots until this browser uploads GCP keys. */
function requireDashboardDataAccess(): void {
  assertDataAccessAllowed({ gcp: true });
}

type CampaignLifecycleColumnSet = {
  status: boolean;
  state: boolean;
  active: boolean;
  is_active: boolean;
  archived_at: boolean;
  ended_at: boolean;
};

let campaignLifecycleColumnsCache: CampaignLifecycleColumnSet | null = null;
/** Coalesce parallel callers (e.g. `fetchAllTagStats`) so we only hit INFORMATION_SCHEMA once. */
let campaignLifecycleColumnsInFlight: Promise<CampaignLifecycleColumnSet> | null = null;

async function getCampaignLifecycleColumns(): Promise<CampaignLifecycleColumnSet> {
  if (campaignLifecycleColumnsCache) return campaignLifecycleColumnsCache;
  if (!campaignLifecycleColumnsInFlight) {
    campaignLifecycleColumnsInFlight = runQuery<Record<string, unknown>>(`
      SELECT column_name
      FROM \`${P}.${D}.INFORMATION_SCHEMA.COLUMNS\`
      WHERE table_name = 'campaigns'
    `)
      .then((rows) => {
        const set = new Set(rows.map((r) => toStr(r.column_name).toLowerCase()));
        campaignLifecycleColumnsCache = {
          status: set.has("status"),
          state: set.has("state"),
          active: set.has("active"),
          is_active: set.has("is_active"),
          archived_at: set.has("archived_at"),
          ended_at: set.has("ended_at"),
        };
        return campaignLifecycleColumnsCache;
      })
      .finally(() => {
        campaignLifecycleColumnsInFlight = null;
      });
  }
  return campaignLifecycleColumnsInFlight;
}

function buildCampaignLifecycleFilter(
  cols: CampaignLifecycleColumnSet,
  alias = "campaigns"
): string {
  // Prefer explicit lifecycle enums when available (include paused so dialers still see those banks).
  if (cols.status) {
    return `LOWER(CAST(${alias}.status AS STRING)) IN ('active','complete','completed','archived','paused')`;
  }
  if (cols.state) {
    return `LOWER(CAST(${alias}.state AS STRING)) IN ('active','complete','completed','archived','paused')`;
  }

  // Fallbacks for schemas without status/state.
  const activeChecks: string[] = [];
  if (cols.active) activeChecks.push(`${alias}.active = TRUE`);
  if (cols.is_active) activeChecks.push(`${alias}.is_active = TRUE`);
  if (cols.archived_at) activeChecks.push(`${alias}.archived_at IS NOT NULL`);
  if (cols.ended_at) activeChecks.push(`${alias}.ended_at IS NOT NULL`);

  if (activeChecks.length) return `(${activeChecks.join(" OR ")})`;
  return "TRUE";
}

// ─── Phone bank list for a given tag ─────────────────────────────────────────

export async function fetchPhoneBanksByTag(
  tagId: string
): Promise<PhoneBankSummary[]> {
  requireDashboardDataAccess();
  if (!snapshotsDisabled()) {
    const snap = loadPhoneBanksSnapshot(tagId);
    if (snap) {
      return snap.rows;
    }
    const live = await fetchPhoneBanksByTagUncached(tagId);
    savePhoneBanksSnapshot(tagId, live);
    return live;
  }
  return cachedBq(["fetchPhoneBanksByTag", tagId], () => fetchPhoneBanksByTagUncached(tagId), {
    tags: [phonebankingPhoneBanksTag(tagId)],
  });
}

async function fetchPhoneBanksByTagUncached(tagId: string): Promise<PhoneBankSummary[]> {
  const tag = getTagById(tagId);
  if (!tag) return [];

  const lifecycleColumns = await getCampaignLifecycleColumns();
  const lifecycleFilter = buildCampaignLifecycleFilter(lifecycleColumns);
  const whereClause = buildTagWhereClause(tag);

  const sql = `
    WITH campaign_calls AS (
      SELECT
        campaigns.id          AS campaign_id,
        campaigns.name        AS campaign_name,
        campaigns.created_at  AS campaign_created_date,
        COUNT(DISTINCT calls.id)        AS total_dials,
        COUNT(DISTINCT calls.caller_id) AS unique_callers,
        SUM(CAST(calls.duration AS FLOAT64)) AS total_seconds,
        MIN(calls.connected_at) AS first_call_date,
        MAX(calls.connected_at) AS last_call_date
      FROM \`${P}.${D}.campaigns\` AS campaigns
      LEFT JOIN \`${P}.${D}.calls\` AS calls
        ON campaigns.id = calls.campaign_id
      WHERE DATE(calls.connected_at, 'America/Los_Angeles') >= '${PHONEBANK_WINDOW_START_DATE}'
        AND ${lifecycleFilter}
        AND ${whereClause}
      GROUP BY campaigns.id, campaigns.name, campaigns.created_at
    )
    SELECT *
    FROM campaign_calls
    ORDER BY campaign_created_date DESC, total_dials DESC
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);

  return rows.map((r) => rowToPhoneBankSummary(r));
}

/**
 * All campaigns matching the same lifecycle + date window as `fetchPhoneBanksByTag`,
 * without filtering by candidate tag (name LIKE terms).
 */
export async function fetchAllActivePhoneBankSummaries(): Promise<PhoneBankSummary[]> {
  requireDashboardDataAccess();
  return cachedBq(["fetchAllActivePhoneBankSummaries"], () => fetchAllActivePhoneBankSummariesUncached());
}

async function fetchAllActivePhoneBankSummariesUncached(): Promise<PhoneBankSummary[]> {
  const lifecycleColumns = await getCampaignLifecycleColumns();
  const lifecycleFilter = buildCampaignLifecycleFilter(lifecycleColumns);

  const sql = `
    WITH campaign_calls AS (
      SELECT
        campaigns.id          AS campaign_id,
        campaigns.name        AS campaign_name,
        campaigns.created_at  AS campaign_created_date,
        COUNT(DISTINCT calls.id)        AS total_dials,
        COUNT(DISTINCT calls.caller_id) AS unique_callers,
        SUM(CAST(calls.duration AS FLOAT64)) AS total_seconds,
        MIN(calls.connected_at) AS first_call_date,
        MAX(calls.connected_at) AS last_call_date
      FROM \`${P}.${D}.campaigns\` AS campaigns
      LEFT JOIN \`${P}.${D}.calls\` AS calls
        ON campaigns.id = calls.campaign_id
      WHERE DATE(calls.connected_at, 'America/Los_Angeles') >= '${PHONEBANK_WINDOW_START_DATE}'
        AND ${lifecycleFilter}
      GROUP BY campaigns.id, campaigns.name, campaigns.created_at
    )
    SELECT *
    FROM campaign_calls
    ORDER BY campaign_created_date DESC, total_dials DESC
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);

  return rows.map((r) => rowToPhoneBankSummary(r));
}

/** `YYYY-MM-DD` — used to validate route/API params before interpolating SQL. */
export function isValidPhonebankingIsoDate(raw: string): boolean {
  return isValidIsoDate(raw);
}

/**
 * Campaigns with at least one connected call on the given **America/Los_Angeles** calendar day.
 * Same lifecycle rules as {@link fetchAllActivePhoneBankSummaries}; metrics are **for that day only**.
 * Cached per ISO date when BQ cache env is enabled.
 */
export async function fetchAllPhoneBankSummariesForDate(isoDate: string): Promise<PhoneBankSummary[]> {
  requireDashboardDataAccess();
  if (!isValidPhonebankingIsoDate(isoDate)) return [];
  return cachedBq(
    ["fetchAllPhoneBankSummariesForDate", isoDate],
    () => fetchAllPhoneBankSummariesForDateUncached(isoDate)
  );
}

async function fetchAllPhoneBankSummariesForDateUncached(isoDate: string): Promise<PhoneBankSummary[]> {
  const lifecycleColumns = await getCampaignLifecycleColumns();
  const lifecycleFilter = buildCampaignLifecycleFilter(lifecycleColumns);

  const sql = `
    WITH campaign_calls AS (
      SELECT
        campaigns.id          AS campaign_id,
        campaigns.name        AS campaign_name,
        campaigns.created_at  AS campaign_created_date,
        COUNT(DISTINCT calls.id)        AS total_dials,
        COUNT(DISTINCT calls.caller_id) AS unique_callers,
        SUM(CAST(calls.duration AS FLOAT64)) AS total_seconds,
        MIN(calls.connected_at) AS first_call_date,
        MAX(calls.connected_at) AS last_call_date
      FROM \`${P}.${D}.campaigns\` AS campaigns
      INNER JOIN \`${P}.${D}.calls\` AS calls
        ON campaigns.id = calls.campaign_id
        AND DATE(calls.connected_at, 'America/Los_Angeles') = '${isoDate}'
      WHERE ${lifecycleFilter}
      GROUP BY campaigns.id, campaigns.name, campaigns.created_at
      HAVING COUNT(DISTINCT calls.id) > 0
    )
    SELECT *
    FROM campaign_calls
    ORDER BY campaign_created_date DESC, total_dials DESC
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);

  return rows.map((r) => rowToPhoneBankSummary(r));
}

/**
 * Per-phonebanker aggregates for **all** lifecycle-eligible campaigns, limited to one LA session day.
 * Mirrors {@link fetchPhonebankersByTag} date grain (`callers.created_at`) but without a candidate tag filter.
 */
export async function fetchAllPhonebankersForDate(isoDate: string): Promise<PhonebankerAggregateStat[]> {
  requireDashboardDataAccess();
  if (!isValidPhonebankingIsoDate(isoDate)) return [];
  return cachedBq(
    ["fetchAllPhonebankersForDate", isoDate],
    () => fetchAllPhonebankersForDateUncached(isoDate)
  );
}

async function fetchAllPhonebankersForDateUncached(isoDate: string): Promise<PhonebankerAggregateStat[]> {
  const lifecycleColumns = await getCampaignLifecycleColumns();
  const lifecycleFilter = buildCampaignLifecycleFilter(lifecycleColumns);
  const dateFilter = `AND CAST(DATETIME(callers.created_at, 'America/Los_Angeles') AS DATE) = '${isoDate}'`;

  const sql = `
    WITH session_seconds AS (
      SELECT
        callers.name AS phonebanker_name,
        campaigns.name AS campaign_name,
        SUM(callers.seconds_in_calls) AS total_call_seconds
      FROM \`${P}.${D}.callers\` AS callers
      JOIN \`${P}.${D}.campaigns\` AS campaigns
        ON callers.campaign_id = campaigns.id
      WHERE ${lifecycleFilter}
        AND DATE(callers.created_at, 'America/Los_Angeles') >= '${PHONEBANK_WINDOW_START_DATE}'
        ${dateFilter}
      GROUP BY callers.name, campaigns.name
    ),
    dial_counts AS (
      SELECT
        callers.name AS phonebanker_name,
        campaigns.name AS campaign_name,
        COUNT(DISTINCT calls.id) AS num_dials
      FROM \`${P}.${D}.callers\` AS callers
      JOIN \`${P}.${D}.campaigns\` AS campaigns
        ON callers.campaign_id = campaigns.id
      LEFT JOIN \`${P}.${D}.calls\` AS calls
        ON callers.id = calls.caller_id
      WHERE ${lifecycleFilter}
        AND DATE(callers.created_at, 'America/Los_Angeles') >= '${PHONEBANK_WINDOW_START_DATE}'
        ${dateFilter}
      GROUP BY callers.name, campaigns.name
    ),
    call_counts AS (
      SELECT
        s.phonebanker_name,
        s.campaign_name,
        s.total_call_seconds,
        COALESCE(d.num_dials, 0) AS num_dials
      FROM session_seconds s
      LEFT JOIN dial_counts d
        ON s.phonebanker_name = d.phonebanker_name
        AND s.campaign_name = d.campaign_name
    )
    SELECT
      phonebanker_name,
      STRING_AGG(DISTINCT campaign_name ORDER BY campaign_name) AS campaign_list,
      SUM(num_dials) AS total_dials,
      ROUND(SUM(total_call_seconds) / 3600, 2) AS total_call_hours,
      COUNT(DISTINCT campaign_name) AS campaign_count
    FROM call_counts
    GROUP BY phonebanker_name
    ORDER BY total_dials DESC
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);

  const byName = new Map<string, PhonebankerAggregateStat>();
  for (const r of rows) {
    const canonical = canonicalizePhonebankerName(toStr(r.phonebanker_name));
    if (!byName.has(canonical)) {
      byName.set(canonical, {
        phonebankerName: canonical,
        totalDials: 0,
        totalCallHours: 0,
        totalDialerHours: 0,
        daysWorked: 0,
        campaigns: [],
      });
    }
    const agg = byName.get(canonical)!;
    agg.totalDials += toNum(r.total_dials);
    agg.totalCallHours = Math.round((agg.totalCallHours + toNum(r.total_call_hours)) * 100) / 100;
    const campaigns = toStr(r.campaign_list)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    agg.campaigns = [...new Set([...agg.campaigns, ...campaigns])];
  }
  return Array.from(byName.values()).sort((a, b) => b.totalDials - a.totalDials);
}

// ─── Aggregate stats for all tags (landing overview) ─────────────────────────

export async function fetchAllTagStats(
  tagIds: string[]
): Promise<Record<string, PhoneBankSummary[]>> {
  const result: Record<string, PhoneBankSummary[]> = {};
  await Promise.all(
    tagIds.map(async (id) => {
      result[id] = await fetchPhoneBanksByTag(id);
    })
  );
  return result;
}

// ─── Per-phonebanker daily stats for a specific campaign ─────────────────────

export async function fetchPhoneBankDetail(
  campaignId: string
): Promise<PhoneBankDetail | null> {
  requireDashboardDataAccess();
  // Fetch the basic campaign info
  const campaignSql = `
    SELECT
      campaigns.id          AS campaign_id,
      campaigns.name        AS campaign_name,
      campaigns.created_at  AS campaign_created_date,
      COUNT(DISTINCT calls.id)        AS total_dials,
      COUNT(DISTINCT calls.caller_id) AS unique_callers,
      SUM(CAST(calls.duration AS FLOAT64)) AS total_seconds,
      MIN(calls.connected_at) AS first_call_date,
      MAX(calls.connected_at) AS last_call_date
    FROM \`${P}.${D}.campaigns\` AS campaigns
    LEFT JOIN \`${P}.${D}.calls\` AS calls
      ON campaigns.id = calls.campaign_id
    WHERE campaigns.id = '${campaignId}'
    GROUP BY campaigns.id, campaigns.name, campaigns.created_at
    LIMIT 1
  `;

  const campaignRows = await runQuery<Record<string, unknown>>(campaignSql);
  if (!campaignRows.length) return null;

  const cr = campaignRows[0];
  const campaign: PhoneBankSummary = {
    campaignId: toStr(cr.campaign_id),
    campaignName: toStr(cr.campaign_name),
    totalDials: toNum(cr.total_dials),
    uniqueCallers: toNum(cr.unique_callers),
    totalHours: Math.round((toNum(cr.total_seconds) / 3600) * 100) / 100,
    totalSeconds: toNum(cr.total_seconds),
    firstCallDate: toDateString(cr.first_call_date),
    lastCallDate: toDateString(cr.last_call_date),
    campaignCreatedDate: toDateString(cr.campaign_created_date) ?? "",
  };

  // Per-phonebanker daily stats — same as `stw_phonebanker_survey_export.py` `daily_summary`:
  // time-in-calls and logged-in both sum each `callers` row in `caller_data` (no merged-session math).
  const dailySql = `
    WITH caller_activity AS (
      SELECT
        calls.caller_id,
        MAX(
          DATETIME(
            TIMESTAMP_ADD(
              calls.connected_at,
              INTERVAL CAST(COALESCE(calls.duration, 0) AS INT64) SECOND
            ),
            'America/Los_Angeles'
          )
        ) AS last_call_end_time
      FROM \`${P}.${D}.calls\` AS calls
      GROUP BY calls.caller_id
    ),
    caller_data AS (
      SELECT
        callers.name AS phonebanker_name,
        CAST(DATETIME(callers.created_at, 'America/Los_Angeles') AS DATE) AS call_date,
        DATETIME(callers.created_at, 'America/Los_Angeles') AS login_time,
        GREATEST(
          DATETIME(callers.created_at, 'America/Los_Angeles'),
          CASE
            WHEN callers.ended_at IS NOT NULL THEN DATETIME(callers.ended_at, 'America/Los_Angeles')
            WHEN DATE(callers.created_at, 'America/Los_Angeles') = CURRENT_DATE('America/Los_Angeles')
              THEN CURRENT_DATETIME('America/Los_Angeles')
            WHEN ca.last_call_end_time IS NOT NULL THEN ca.last_call_end_time
            ELSE DATETIME_ADD(
              DATETIME(callers.created_at, 'America/Los_Angeles'),
              INTERVAL GREATEST(COALESCE(callers.seconds_in_calls, 0), 1) SECOND
            )
          END
        ) AS logout_time,
        callers.seconds_in_calls
      FROM \`${P}.${D}.callers\` AS callers
      LEFT JOIN caller_activity AS ca ON callers.id = ca.caller_id
      WHERE callers.campaign_id = '${campaignId}'
    ),
    daily_summary AS (
      SELECT
        phonebanker_name,
        call_date,
        SUM(seconds_in_calls) AS total_call_seconds,
        SUM(GREATEST(0, DATETIME_DIFF(logout_time, login_time, SECOND))) AS total_dialer_seconds,
        MIN(login_time) AS earliest_login,
        MAX(logout_time) AS latest_logout
      FROM caller_data
      GROUP BY phonebanker_name, call_date
    ),
    call_counts AS (
      SELECT
        callers.name AS phonebanker_name,
        CAST(DATETIME(callers.created_at, 'America/Los_Angeles') AS DATE) AS call_date,
        COUNT(DISTINCT calls.id) AS num_dials
      FROM \`${P}.${D}.callers\` AS callers
      LEFT JOIN \`${P}.${D}.calls\` AS calls ON callers.id = calls.caller_id
      WHERE callers.campaign_id = '${campaignId}'
      GROUP BY callers.name, CAST(DATETIME(callers.created_at, 'America/Los_Angeles') AS DATE)
    )

    SELECT
      ds.call_date,
      ds.phonebanker_name,
      COALESCE(cc.num_dials, 0)  AS num_dials,
      ds.total_call_seconds,
      ds.total_dialer_seconds,
      ds.earliest_login,
      ds.latest_logout
    FROM daily_summary ds
    LEFT JOIN call_counts cc
      ON ds.call_date = cc.call_date
      AND ds.phonebanker_name = cc.phonebanker_name
    ORDER BY ds.call_date DESC, ds.phonebanker_name
  `;

  const dailyRows = await runQuery<Record<string, unknown>>(dailySql);

  const dailyMap = new Map<string, PhonebankerDailyStat>();
  for (const r of dailyRows) {
    const callSec = toNum(r.total_call_seconds);
    const dialSec = toNum(r.total_dialer_seconds);
    const callDate = toDateString(r.call_date) ?? "";
    const phonebankerName = canonicalizePhonebankerName(toStr(r.phonebanker_name));
    const key = `${callDate}::${phonebankerName}`;
    if (!dailyMap.has(key)) {
      dailyMap.set(key, {
        campaignName: campaign.campaignName,
        callDate,
        phonebankerName,
        numDials: 0,
        totalCallSeconds: 0,
        totalDialerSeconds: 0,
        totalCallHours: 0,
        totalDialerHours: 0,
        earliestLogin: toStr(r.earliest_login).slice(11, 19),
        latestLogout: toStr(r.latest_logout).slice(11, 19),
      });
    }
    const stat = dailyMap.get(key)!;
    stat.numDials += toNum(r.num_dials);
    stat.totalCallSeconds += callSec;
    stat.totalDialerSeconds += dialSec;
    const earliest = toStr(r.earliest_login).slice(11, 19);
    const latest = toStr(r.latest_logout).slice(11, 19);
    if (!stat.earliestLogin || (earliest && earliest < stat.earliestLogin)) stat.earliestLogin = earliest;
    if (!stat.latestLogout || (latest && latest > stat.latestLogout)) stat.latestLogout = latest;
  }
  const dailyStats: PhonebankerDailyStat[] = Array.from(dailyMap.values()).map((d) => ({
    ...d,
    totalCallHours: Math.round((d.totalCallSeconds / 3600) * 100) / 100,
    totalDialerHours: Math.round((d.totalDialerSeconds / 3600) * 100) / 100,
  }));

  // Roll up per-phonebanker aggregates
  const aggMap = new Map<string, PhonebankerAggregateStat>();
  for (const d of dailyStats) {
    if (!aggMap.has(d.phonebankerName)) {
      aggMap.set(d.phonebankerName, {
        phonebankerName: d.phonebankerName,
        totalDials: 0,
        totalCallHours: 0,
        totalDialerHours: 0,
        daysWorked: 0,
        campaigns: [campaign.campaignName],
      });
    }
    const agg = aggMap.get(d.phonebankerName)!;
    agg.totalDials += d.numDials;
    agg.totalCallHours =
      Math.round((agg.totalCallHours + d.totalCallHours) * 100) / 100;
    agg.totalDialerHours =
      Math.round((agg.totalDialerHours + d.totalDialerHours) * 100) / 100;
    agg.daysWorked += 1;
  }

  const phonebankerAggregates = Array.from(aggMap.values()).sort(
    (a, b) => b.totalDials - a.totalDials
  );

  const availableDates = [
    ...new Set(dailyStats.map((d) => d.callDate).filter(Boolean)),
  ].sort((a, b) => b.localeCompare(a));

  return { campaign, dailyStats, phonebankerAggregates, availableDates };
}

// ─── Per-phonebanker stats across ALL campaigns for a tag ────────────────────

export async function fetchPhonebankersByTag(
  tagId: string,
  filterDate?: string
): Promise<PhonebankerAggregateStat[]> {
  requireDashboardDataAccess();
  const tag = getTagById(tagId);
  if (!tag) return [];

  const whereClause = buildTagWhereClause(tag);
  const dateFilter = filterDate
    ? `AND CAST(DATETIME(callers.created_at, 'America/Los_Angeles') AS DATE) = '${filterDate}'`
    : "";

  const sql = `
    WITH session_seconds AS (
      SELECT
        callers.name AS phonebanker_name,
        campaigns.name AS campaign_name,
        SUM(callers.seconds_in_calls) AS total_call_seconds
      FROM \`${P}.${D}.callers\` AS callers
      JOIN \`${P}.${D}.campaigns\` AS campaigns
        ON callers.campaign_id = campaigns.id
      WHERE ${whereClause}
        AND DATE(callers.created_at, 'America/Los_Angeles') >= '2025-12-01'
        ${dateFilter}
      GROUP BY callers.name, campaigns.name
    ),
    dial_counts AS (
      SELECT
        callers.name AS phonebanker_name,
        campaigns.name AS campaign_name,
        COUNT(DISTINCT calls.id) AS num_dials
      FROM \`${P}.${D}.callers\` AS callers
      JOIN \`${P}.${D}.campaigns\` AS campaigns
        ON callers.campaign_id = campaigns.id
      LEFT JOIN \`${P}.${D}.calls\` AS calls
        ON callers.id = calls.caller_id
      WHERE ${whereClause}
        AND DATE(callers.created_at, 'America/Los_Angeles') >= '2025-12-01'
        ${dateFilter}
      GROUP BY callers.name, campaigns.name
    ),
    call_counts AS (
      SELECT
        s.phonebanker_name,
        s.campaign_name,
        s.total_call_seconds,
        COALESCE(d.num_dials, 0) AS num_dials
      FROM session_seconds s
      LEFT JOIN dial_counts d
        ON s.phonebanker_name = d.phonebanker_name
        AND s.campaign_name = d.campaign_name
    )
    SELECT
      phonebanker_name,
      STRING_AGG(DISTINCT campaign_name ORDER BY campaign_name) AS campaign_list,
      SUM(num_dials) AS total_dials,
      ROUND(SUM(total_call_seconds) / 3600, 2) AS total_call_hours,
      COUNT(DISTINCT campaign_name) AS campaign_count
    FROM call_counts
    GROUP BY phonebanker_name
    ORDER BY total_dials DESC
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);

  const byName = new Map<string, PhonebankerAggregateStat>();
  for (const r of rows) {
    const canonical = canonicalizePhonebankerName(toStr(r.phonebanker_name));
    if (!byName.has(canonical)) {
      byName.set(canonical, {
        phonebankerName: canonical,
        totalDials: 0,
        totalCallHours: 0,
        totalDialerHours: 0,
        daysWorked: 0,
        campaigns: [],
      });
    }
    const agg = byName.get(canonical)!;
    agg.totalDials += toNum(r.total_dials);
    agg.totalCallHours = Math.round((agg.totalCallHours + toNum(r.total_call_hours)) * 100) / 100;
    const campaigns = toStr(r.campaign_list)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    agg.campaigns = [...new Set([...agg.campaigns, ...campaigns])];
  }
  return Array.from(byName.values()).sort((a, b) => b.totalDials - a.totalDials);
}

function sortTagDailyCallerStats(a: TagDailyCallerStat, b: TagDailyCallerStat): number {
  if (a.callDate !== b.callDate) return b.callDate.localeCompare(a.callDate);
  if (a.campaignName !== b.campaignName) return a.campaignName.localeCompare(b.campaignName);
  return a.phonebankerName.localeCompare(b.phonebankerName);
}

export async function fetchTagDailyCallerStats(
  tagId: string,
  options?: { snapshotFullRebuild?: boolean }
): Promise<TagDailyCallerStat[]> {
  requireDashboardDataAccess();
  if (snapshotsDisabled()) {
    const full = await fetchTagDailyCallerStatsUncached(tagId);
    return full.filter(tagDailyCallerHasWorkBeyondLoggedHours).sort(sortTagDailyCallerStats);
  }

  if (options?.snapshotFullRebuild) {
    const full = await fetchTagDailyCallerStatsUncached(tagId);
    const rows = full.filter(tagDailyCallerHasWorkBeyondLoggedHours).sort(sortTagDailyCallerStats);
    saveDailyCallerSnapshot(tagId, rows, { touchEvenIfUnchanged: true });
    return rows;
  }

  const snap = loadDailyCallerSnapshot(tagId);
  if (snap) {
    if (!snap.rows.length) return [];
    return snap.rows.filter(tagDailyCallerHasWorkBeyondLoggedHours).sort(sortTagDailyCallerStats);
  }
  const full = await fetchTagDailyCallerStatsUncached(tagId);
  const rows = full.filter(tagDailyCallerHasWorkBeyondLoggedHours).sort(sortTagDailyCallerStats);
  saveDailyCallerSnapshot(tagId, rows);
  return rows;
}

async function fetchTagDailyCallerStatsUncached(tagId: string): Promise<TagDailyCallerStat[]> {
  const tag = getTagById(tagId);
  if (!tag) return [];

  const whereClause = buildTagWhereClause(tag);

  // STW often stores each disposition as its own question_name, e.g.
  // "Canvass Result - Talking to Correct Person", not one "Canvass Result" + answer_value.
  // We must aggregate ALL canvass-style question names — picking a single "primary" row
  // by MIN(survey_result_id) matched the wrong column and skewed counts vs crosstab exports.
  //
  // Date grain MUST match `pdi_local_app/scripts/stw_phonebanker_survey_export.py`: that script
  // buckets survey rows by DATE(callers.created_at) in America/Los_Angeles (dialer session /
  // login day), not by calls.connected_at. Using connected_at here shifts counts across days
  // and disagrees with the crosstab CSV. Also exclude soft-deleted survey_results like the script.
  //
  // Surveyed: per call_id, the first survey row (by survey_result id) that is NOT canvass or
  // disclaimer and has a structured lettered answer (matches stw_phonebanker_survey_export.py
  // is_structured_option: leading letter + . ) - : etc.). Only calls that also qualify as
  // talking-to-correct-person (same rules as correct_person_counts) — so surveyed <= correct person.
  //
  // Rows with only logged-in time (wrong phonebank, no dials / no call time / no survey funnel) are
  // dropped after merge — see tagDailyCallerHasWorkBeyondLoggedHours.
  //
  // Time in calls + logged-in: both columns come from the same `caller_data` rows (export script
  // `daily_summary`): SUM(seconds_in_calls) and SUM(GREATEST(0, DATETIME_DIFF(logout, login))) —
  // not merged-session windows, so they stay aligned.
  const answerNormI18nSql = buildPhraseNormalizedExpr("s.answer_value_norm");
  const questionNameNormSql = buildPhraseNormalizedExpr("LOWER(TRIM(s.question_name))");
  const disclaimerHintsSql = buildDisclaimerHintsPattern();

  const sql = `
    WITH caller_activity AS (
      SELECT
        calls.caller_id,
        MAX(
          DATETIME(
            TIMESTAMP_ADD(
              calls.connected_at,
              INTERVAL CAST(COALESCE(calls.duration, 0) AS INT64) SECOND
            ),
            'America/Los_Angeles'
          )
        ) AS last_call_end_time
      FROM \`${P}.${D}.calls\` calls
      GROUP BY calls.caller_id
    ),
    caller_data AS (
      SELECT
        campaigns.id AS campaign_id,
        campaigns.name AS campaign_name,
        callers.name AS phonebanker_name,
        CAST(DATETIME(callers.created_at, 'America/Los_Angeles') AS DATE) AS call_date,
        DATETIME(callers.created_at, 'America/Los_Angeles') AS login_time,
        GREATEST(
          DATETIME(callers.created_at, 'America/Los_Angeles'),
          CASE
            WHEN callers.ended_at IS NOT NULL THEN DATETIME(callers.ended_at, 'America/Los_Angeles')
            WHEN DATE(callers.created_at, 'America/Los_Angeles') = CURRENT_DATE('America/Los_Angeles')
              THEN CURRENT_DATETIME('America/Los_Angeles')
            WHEN ca.last_call_end_time IS NOT NULL THEN ca.last_call_end_time
            ELSE DATETIME_ADD(
              DATETIME(callers.created_at, 'America/Los_Angeles'),
              INTERVAL GREATEST(COALESCE(callers.seconds_in_calls, 0), 1) SECOND
            )
          END
        ) AS logout_time,
        callers.seconds_in_calls,
        callers.id AS caller_id
      FROM \`${P}.${D}.callers\` callers
      JOIN \`${P}.${D}.campaigns\` campaigns
        ON callers.campaign_id = campaigns.id
      LEFT JOIN caller_activity ca ON callers.id = ca.caller_id
      WHERE ${whereClause}
        AND DATE(callers.created_at, 'America/Los_Angeles') >= '2025-12-01'
    ),
    survey_base_staging AS (
      SELECT
        campaigns.id AS campaign_id,
        campaigns.name AS campaign_name,
        callers.name AS phonebanker_name,
        CAST(DATETIME(callers.created_at, 'America/Los_Angeles') AS DATE) AS call_date,
        calls.id AS call_id,
        survey.id AS survey_result_id,
        COALESCE(TRIM(survey.question_name), '') AS question_name,
        TRIM(COALESCE(survey.answer_value, '')) AS answer_raw,
        LOWER(TRIM(COALESCE(survey.answer_value, ''))) AS answer_value_norm
      FROM \`${P}.${D}.survey_results\` survey
      JOIN \`${P}.${D}.calls\` calls
        ON survey.call_id = calls.id
      JOIN \`${P}.${D}.callers\` callers
        ON calls.caller_id = callers.id
      JOIN \`${P}.${D}.campaigns\` campaigns
        ON calls.campaign_id = campaigns.id
      WHERE ${whereClause}
        AND DATE(callers.created_at, 'America/Los_Angeles') >= '2025-12-01'
        AND survey.deleted_at IS NULL
        AND survey.question_name IS NOT NULL
    ),
    survey_base AS (
      SELECT
        s.*,
        ${answerNormI18nSql} AS answer_value_norm_i18n,
        ${questionNameNormSql} AS question_name_norm
      FROM survey_base_staging s
    ),
    question_classification AS (
      SELECT
        campaign_id,
        question_name,
        MIN(survey_result_id) AS first_seen_result_id,
        CASE
          WHEN REGEXP_CONTAINS(
            LOWER(question_name),
            r'${SCRIPT_BLOCK_EXCLUSION_REGEX_BODY}'
          ) THEN 0
          WHEN REGEXP_CONTAINS(LOWER(question_name), r'${TRACI_SCRIPT_EXCLUSION_REGEX_BODY}') THEN 0
          WHEN REGEXP_CONTAINS(
            LOWER(question_name),
            r'(contact\\s*quality|canvass\\s*result|canvass\\s*disposition|call\\s*disposition|contact\\s*disposition)'
          ) THEN 1
          ELSE 0
        END AS is_canvass_result_question
      FROM survey_base
      GROUP BY campaign_id, question_name
    ),
    correct_person_calls AS (
      SELECT DISTINCT
        sb.campaign_id,
        sb.campaign_name,
        sb.phonebanker_name,
        sb.call_date,
        sb.call_id
      FROM survey_base sb
      JOIN question_classification qc
        ON sb.campaign_id = qc.campaign_id
        AND sb.question_name = qc.question_name
      WHERE qc.is_canvass_result_question = 1
        AND (
          (
            sb.answer_value_norm_i18n != ''
            AND REGEXP_CONTAINS(
              sb.answer_value_norm_i18n,
              r'(correct\\s*person|talking\\s+to\\s+correct|correct\\s+pers\\b|right\\s*person|reached\\s+correct)'
            )
            AND NOT REGEXP_CONTAINS(
              sb.answer_value_norm_i18n,
              r'(\\bnot\\s+the\\s+correct|\\bnot\\s+correct\\s+person|\\bnot\\s+the\\s+right|\\bnot\\s+right\\s*person|\\bincorrect\\b|\\bwrong\\s*(#|number|person|\\b)|\\bnever\\s+(the\\s+)?(correct|right)|unable\\s+to\\s+(reach|contact)|refused|declined|hang\\s*up|voice\\s*mail|\\bvm\\b|n\\s*/\\s*a\\b)'
            )
          )
          OR REGEXP_CONTAINS(
            sb.question_name_norm,
            r'canvass\\s*result\\s*-\\s*.*(talking\\s+to\\s+correct|correct\\s*person|correct\\s+pers(\\.|$)|right\\s*person|reached\\s+correct)'
          )
        )
    ),
    first_structured_answer_per_call AS (
      SELECT
        campaign_id,
        campaign_name,
        phonebanker_name,
        call_date,
        call_id
      FROM (
        SELECT
          sb.campaign_id,
          sb.campaign_name,
          sb.phonebanker_name,
          sb.call_date,
          sb.call_id,
          ROW_NUMBER() OVER (
            PARTITION BY sb.call_id
            ORDER BY sb.survey_result_id
          ) AS rn
        FROM survey_base sb
        JOIN question_classification qc
          ON sb.campaign_id = qc.campaign_id
          AND sb.question_name = qc.question_name
        INNER JOIN correct_person_calls cp
          ON sb.call_id = cp.call_id
          AND sb.campaign_id = cp.campaign_id
          AND sb.phonebanker_name = cp.phonebanker_name
          AND sb.call_date = cp.call_date
        WHERE qc.is_canvass_result_question = 0
          AND NOT REGEXP_CONTAINS(LOWER(TRIM(sb.question_name)), r'${disclaimerHintsSql}')
          AND sb.answer_raw != ''
          AND REGEXP_CONTAINS(
            sb.answer_raw,
            r'^\\s*[0-9A-Za-z][\\.\\)\\-:\\s]'
          )
      )
      WHERE rn = 1
    ),
    canvass_counts AS (
      SELECT
        sb.campaign_id,
        sb.campaign_name,
        sb.phonebanker_name,
        sb.call_date,
        COUNT(DISTINCT sb.call_id) AS calls_answered
      FROM survey_base sb
      JOIN question_classification qc
        ON sb.campaign_id = qc.campaign_id
        AND sb.question_name = qc.question_name
      WHERE qc.is_canvass_result_question = 1
        AND (
          sb.answer_value_norm != ''
          OR REGEXP_CONTAINS(LOWER(TRIM(sb.question_name)), r'canvass\\s*result\\s*-')
        )
      GROUP BY sb.campaign_id, sb.campaign_name, sb.phonebanker_name, sb.call_date
    ),
    correct_person_counts AS (
      SELECT
        campaign_id,
        campaign_name,
        phonebanker_name,
        call_date,
        COUNT(DISTINCT call_id) AS talking_to_correct_person
      FROM correct_person_calls
      GROUP BY campaign_id, campaign_name, phonebanker_name, call_date
    ),
    surveyed_counts AS (
      SELECT
        campaign_id,
        campaign_name,
        phonebanker_name,
        call_date,
        COUNT(DISTINCT call_id) AS surveyed
      FROM first_structured_answer_per_call
      GROUP BY campaign_id, campaign_name, phonebanker_name, call_date
    ),
    daily_summary AS (
      SELECT
        campaign_id,
        campaign_name,
        phonebanker_name,
        call_date,
        SUM(seconds_in_calls) AS total_call_seconds,
        SUM(GREATEST(0, DATETIME_DIFF(logout_time, login_time, SECOND))) AS total_dialer_seconds
      FROM caller_data
      GROUP BY campaign_id, campaign_name, phonebanker_name, call_date
    ),
    call_counts AS (
      SELECT
        campaigns.id AS campaign_id,
        campaigns.name AS campaign_name,
        callers.name AS phonebanker_name,
        CAST(DATETIME(callers.created_at, 'America/Los_Angeles') AS DATE) AS call_date,
        COUNT(DISTINCT calls.id) AS num_dials
      FROM \`${P}.${D}.callers\` callers
      JOIN \`${P}.${D}.campaigns\` campaigns
        ON callers.campaign_id = campaigns.id
      LEFT JOIN \`${P}.${D}.calls\` calls
        ON callers.id = calls.caller_id
      WHERE ${whereClause}
        AND DATE(callers.created_at, 'America/Los_Angeles') >= '2025-12-01'
      GROUP BY campaigns.id, campaigns.name, callers.name, CAST(DATETIME(callers.created_at, 'America/Los_Angeles') AS DATE)
    ),
    metric_grain AS (
      SELECT campaign_id, campaign_name, phonebanker_name, call_date FROM daily_summary
      UNION DISTINCT
      SELECT campaign_id, campaign_name, phonebanker_name, call_date FROM canvass_counts
      UNION DISTINCT
      SELECT campaign_id, campaign_name, phonebanker_name, call_date FROM correct_person_counts
      UNION DISTINCT
      SELECT campaign_id, campaign_name, phonebanker_name, call_date FROM surveyed_counts
    )
    SELECT
      mg.campaign_id,
      mg.campaign_name,
      mg.call_date,
      mg.phonebanker_name,
      COALESCE(cc.calls_answered, 0) AS calls_answered,
      COALESCE(cp.talking_to_correct_person, 0) AS talking_to_correct_person,
      COALESCE(sc.surveyed, 0) AS surveyed,
      COALESCE(ds.total_call_seconds, 0) AS total_call_seconds,
      COALESCE(ds.total_dialer_seconds, 0) AS total_dialer_seconds,
      COALESCE(dc.num_dials, 0) AS num_dials
    FROM metric_grain mg
    LEFT JOIN daily_summary ds
      ON mg.campaign_id = ds.campaign_id
      AND mg.phonebanker_name = ds.phonebanker_name
      AND mg.call_date = ds.call_date
    LEFT JOIN call_counts dc
      ON mg.campaign_id = dc.campaign_id
      AND mg.phonebanker_name = dc.phonebanker_name
      AND mg.call_date = dc.call_date
    LEFT JOIN canvass_counts cc
      ON mg.campaign_id = cc.campaign_id
      AND mg.phonebanker_name = cc.phonebanker_name
      AND mg.call_date = cc.call_date
    LEFT JOIN correct_person_counts cp
      ON mg.campaign_id = cp.campaign_id
      AND mg.phonebanker_name = cp.phonebanker_name
      AND mg.call_date = cp.call_date
    LEFT JOIN surveyed_counts sc
      ON mg.campaign_id = sc.campaign_id
      AND mg.phonebanker_name = sc.phonebanker_name
      AND mg.call_date = sc.call_date
    ORDER BY mg.call_date DESC, mg.campaign_name, mg.phonebanker_name
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);
  const merged = new Map<string, TagDailyCallerStat>();
  for (const r of rows) {
    const campaignId = toStr(r.campaign_id);
    const campaignName = toStr(r.campaign_name);
    const callDate = toDateString(r.call_date) ?? "";
    const phonebankerName = canonicalizePhonebankerName(toStr(r.phonebanker_name));
    const key = `${campaignId}::${callDate}::${phonebankerName}`;
    if (!merged.has(key)) {
      merged.set(key, {
        campaignId,
        campaignName,
        callDate,
        phonebankerName,
        callsAnswered: 0,
        talkingToCorrectPerson: 0,
        surveyed: 0,
        numDials: 0,
        totalCallSeconds: 0,
        totalDialerSeconds: 0,
      });
    }
    const row = merged.get(key)!;
    row.callsAnswered += toNum(r.calls_answered);
    row.talkingToCorrectPerson += toNum(r.talking_to_correct_person);
    row.surveyed += toNum(r.surveyed);
    row.numDials += toNum(r.num_dials);
    row.totalCallSeconds += toNum(r.total_call_seconds);
    row.totalDialerSeconds += toNum(r.total_dialer_seconds);
  }
  const sorted = Array.from(merged.values()).sort(sortTagDailyCallerStats);
  return sorted;
}

/** True if this campaign/day/banker has any signal beyond idle logged-in time (wrong-bank sessions). */
export function tagDailyCallerHasWorkBeyondLoggedHours(row: TagDailyCallerStat): boolean {
  return (
    row.callsAnswered > 0 ||
    row.talkingToCorrectPerson > 0 ||
    row.surveyed > 0 ||
    row.totalCallSeconds > 0 ||
    row.numDials > 0
  );
}

function sortQuestionResponseStats(
  a: PhonebankerQuestionResponseStat,
  b: PhonebankerQuestionResponseStat
): number {
  if (a.callDate !== b.callDate) return b.callDate.localeCompare(a.callDate);
  if (a.campaignName !== b.campaignName) return a.campaignName.localeCompare(b.campaignName);
  if (a.phonebankerName !== b.phonebankerName) return a.phonebankerName.localeCompare(b.phonebankerName);
  if (a.questionName !== b.questionName) return a.questionName.localeCompare(b.questionName);
  return a.answerValue.localeCompare(b.answerValue);
}

export async function fetchTagPhonebankerQuestionStats(
  tagId: string,
  options?: { snapshotFullRebuild?: boolean }
): Promise<PhonebankerQuestionResponseStat[]> {
  requireDashboardDataAccess();
  if (snapshotsDisabled()) {
    const full = await fetchTagPhonebankerQuestionStatsUncached(tagId);
    return full.sort(sortQuestionResponseStats);
  }

  if (options?.snapshotFullRebuild) {
    const full = await fetchTagPhonebankerQuestionStatsUncached(tagId);
    const rows = full.sort(sortQuestionResponseStats);
    saveQuestionStatsSnapshot(tagId, rows, { touchEvenIfUnchanged: true });
    return rows;
  }

  const snap = loadQuestionStatsSnapshot(tagId);
  if (snap) {
    return snap.rows.sort(sortQuestionResponseStats);
  }
  const full = await fetchTagPhonebankerQuestionStatsUncached(tagId);
  const rows = full.sort(sortQuestionResponseStats);
  saveQuestionStatsSnapshot(tagId, rows);
  return rows;
}

async function fetchTagPhonebankerQuestionStatsUncached(
  tagId: string
): Promise<PhonebankerQuestionResponseStat[]> {
  const tag = getTagById(tagId);
  if (!tag) return [];

  const whereClause = buildTagWhereClause(tag);

  const sql = `
    WITH base AS (
      SELECT
        campaigns.id AS campaign_id,
        campaigns.name AS campaign_name,
        CAST(DATETIME(callers.created_at, 'America/Los_Angeles') AS DATE) AS call_date,
        callers.name AS phonebanker_name,
        COALESCE(survey.question_name, '[Unknown Question]') AS question_name,
        COALESCE(NULLIF(TRIM(survey.answer_value), ''), '[No Answer Recorded]') AS answer_value,
        calls.id AS call_id
      FROM \`${P}.${D}.survey_results\` survey
      JOIN \`${P}.${D}.calls\` calls
        ON survey.call_id = calls.id
      JOIN \`${P}.${D}.callers\` callers
        ON calls.caller_id = callers.id
      JOIN \`${P}.${D}.campaigns\` campaigns
        ON calls.campaign_id = campaigns.id
      WHERE ${whereClause}
        AND DATE(callers.created_at, 'America/Los_Angeles') >= '2025-12-01'
        AND survey.deleted_at IS NULL
        AND survey.question_name IS NOT NULL
    )
    SELECT
      campaign_id,
      campaign_name,
      call_date,
      phonebanker_name,
      question_name,
      answer_value,
      COUNT(DISTINCT call_id) AS response_count
    FROM base
    GROUP BY campaign_id, campaign_name, call_date, phonebanker_name, question_name, answer_value
    ORDER BY call_date DESC, campaign_name, phonebanker_name, question_name, answer_value
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);
  const merged = new Map<string, PhonebankerQuestionResponseStat>();
  for (const r of rows) {
    const campaignId = toStr(r.campaign_id);
    const campaignName = toStr(r.campaign_name);
    const callDate = toDateString(r.call_date) ?? "";
    const phonebankerName = canonicalizePhonebankerName(toStr(r.phonebanker_name));
    const questionName = toStr(r.question_name);
    const answerValue = toStr(r.answer_value);
    const key = `${campaignId}::${callDate}::${phonebankerName}::${questionName}::${answerValue}`;
    if (!merged.has(key)) {
      merged.set(key, {
        campaignId,
        campaignName,
        callDate,
        phonebankerName,
        questionName,
        answerValue,
        responseCount: 0,
      });
    }
    merged.get(key)!.responseCount += toNum(r.response_count);
  }
  return Array.from(merged.values()).sort(sortQuestionResponseStats);
}

function sortCallSurveyFill(a: CallSurveyRowForFill, b: CallSurveyRowForFill): number {
  if (a.callDate !== b.callDate) return b.callDate.localeCompare(a.callDate);
  if (a.campaignName !== b.campaignName) return a.campaignName.localeCompare(b.campaignName);
  const ca = Number(a.callId);
  const cb = Number(b.callId);
  if (ca !== cb && (Number.isFinite(ca) || Number.isFinite(cb))) {
    return (Number.isFinite(ca) ? ca : 0) - (Number.isFinite(cb) ? cb : 0);
  }
  if (a.callId !== b.callId) return a.callId.localeCompare(b.callId);
  return a.surveyResultId - b.surveyResultId;
}

/**
 * Raw survey rows per call (no aggregation) — used to synthesize Final Result counts when the script
 * has no question name matching “final result” / “resultado final” in the standard rollup.
 */
export async function fetchTagCallSurveyRowsForFinalFill(
  tagId: string,
  options?: { snapshotFullRebuild?: boolean }
): Promise<CallSurveyRowForFill[]> {
  requireDashboardDataAccess();
  if (snapshotsDisabled()) {
    const full = await fetchTagCallSurveyRowsForFinalFillUncached(tagId);
    return full.sort(sortCallSurveyFill);
  }

  if (options?.snapshotFullRebuild) {
    const full = await fetchTagCallSurveyRowsForFinalFillUncached(tagId);
    const rows = full.sort(sortCallSurveyFill);
    saveCallSurveyFillSnapshot(tagId, rows, { touchEvenIfUnchanged: true });
    return rows;
  }

  const snap = loadCallSurveyFillSnapshot(tagId);
  if (snap) {
    return snap.rows.sort(sortCallSurveyFill);
  }
  const full = await fetchTagCallSurveyRowsForFinalFillUncached(tagId);
  const rows = full.sort(sortCallSurveyFill);
  saveCallSurveyFillSnapshot(tagId, rows);
  return rows;
}

async function fetchTagCallSurveyRowsForFinalFillUncached(tagId: string): Promise<CallSurveyRowForFill[]> {
  const tag = getTagById(tagId);
  if (!tag) return [];

  const whereClause = buildTagWhereClause(tag);

  const sql = `
    SELECT
      CAST(calls.id AS STRING) AS call_id,
      campaigns.id AS campaign_id,
      campaigns.name AS campaign_name,
      CAST(DATETIME(callers.created_at, 'America/Los_Angeles') AS DATE) AS call_date,
      callers.name AS phonebanker_name,
      COALESCE(survey.question_name, '') AS question_name,
      TRIM(COALESCE(survey.answer_value, '')) AS answer_value,
      survey.id AS survey_result_id
    FROM \`${P}.${D}.survey_results\` survey
    JOIN \`${P}.${D}.calls\` calls
      ON survey.call_id = calls.id
    JOIN \`${P}.${D}.callers\` callers
      ON calls.caller_id = callers.id
    JOIN \`${P}.${D}.campaigns\` campaigns
      ON calls.campaign_id = campaigns.id
    WHERE ${whereClause}
      AND DATE(callers.created_at, 'America/Los_Angeles') >= '2025-12-01'
      AND survey.deleted_at IS NULL
      AND survey.question_name IS NOT NULL
    ORDER BY call_date DESC, campaign_name, call_id, survey_result_id
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);
  return rows.map((r) => ({
    callId: toStr(r.call_id),
    campaignId: toStr(r.campaign_id),
    campaignName: toStr(r.campaign_name),
    callDate: toDateString(r.call_date) ?? "",
    phonebankerName: canonicalizePhonebankerName(toStr(r.phonebanker_name)),
    questionName: toStr(r.question_name),
    answerValue: toStr(r.answer_value),
    surveyResultId: toNum(r.survey_result_id),
  }));
}

/**
 * Full BigQuery refresh for all snapshot-backed tag datasets; overwrites on-disk JSON for this tag.
 */
export async function rebuildTagBqSnapshotsFromBigQuery(tagId: string): Promise<void> {
  if (snapshotsDisabled()) return;
  await Promise.all([
    fetchTagDailyCallerStats(tagId, { snapshotFullRebuild: true }),
    fetchTagPhonebankerQuestionStats(tagId, { snapshotFullRebuild: true }),
    fetchTagCallSurveyRowsForFinalFill(tagId, { snapshotFullRebuild: true }),
  ]);
  const banks = await fetchPhoneBanksByTagUncached(tagId);
  savePhoneBanksSnapshot(tagId, banks, { touchEvenIfUnchanged: true });
}
