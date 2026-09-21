import "server-only";

import { getCoreCampaignTags, resolveSurveyScriptProfile } from "../campaign-tags";
import { loadKnockIndex } from "../canvassing/knock-index-store";
import {
  loadPhoneUniqueIdEvents,
  loadTextUniqueIdEvents,
  resolveUniqueIdTag,
} from "../queries/unique-id-contacts";
import type { CampaignTag } from "../types";
import { collectKnockEvents } from "./collect";
import {
  emptyChangeSummary,
  emptyChannelCounts,
  emptyFamilyCounts,
  emptyTally,
  tallyUniqueIds,
  uniqueIdRowsToCsv,
} from "./tally";
import type { UniqueIdOverviewQuery } from "./query";
import type {
  UniqueIdCandidateSummary,
  UniqueIdContactEvent,
  UniqueIdOverviewPayload,
} from "./types";

function candidateOptions(): Array<{ id: string; label: string }> {
  return getCoreCampaignTags().map((tag) => ({ id: tag.id, label: tag.label }));
}

function mergeErrors(...parts: Array<string | undefined>): string | undefined {
  const messages = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return messages.length ? messages.join(" ") : undefined;
}

function laterStamp(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function earlierDay(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function laterDay(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

async function loadTagEvents(
  tag: CampaignTag,
  options: { buildIfMissing: boolean }
): Promise<{
  events: UniqueIdContactEvent[];
  phoneUpdatedAt: string;
  textUpdatedAt: string;
  phoneError?: string;
  textError?: string;
}> {
  const profile = resolveSurveyScriptProfile(tag);
  const [phone, text] = await Promise.all([
    loadPhoneUniqueIdEvents(tag, options),
    loadTextUniqueIdEvents(tag, options),
  ]);
  const knocks = collectKnockEvents(loadKnockIndex().rows, { tag, profile });
  return {
    events: [...phone.events, ...text.events, ...knocks],
    phoneUpdatedAt: phone.savedAt,
    textUpdatedAt: text.savedAt,
    phoneError: phone.error,
    textError: text.error,
  };
}

function summaryFromTally(
  tag: CampaignTag,
  tally: ReturnType<typeof tallyUniqueIds>
): UniqueIdCandidateSummary {
  return {
    id: tag.id,
    label: tag.label,
    combined: tally.combined,
    byChannel: tally.byChannel,
    changes: tally.changes,
  };
}

export async function buildUniqueIdOverviewPayload(
  query: UniqueIdOverviewQuery
): Promise<UniqueIdOverviewPayload> {
  const candidates = candidateOptions();
  const knockIndex = loadKnockIndex();
  const tallyOpts = {
    startDate: query.startDate,
    endDate: query.endDate,
    q: query.q,
    family: query.family,
    channel: query.channel,
    page: query.page,
    pageSize: query.pageSize,
  };

  const selected = query.tagId ? resolveUniqueIdTag(query.tagId) : undefined;
  if (query.tagId && !selected) {
    const empty = emptyTally(tallyOpts);
    return {
      meta: {
        phoneUpdatedAt: "",
        textUpdatedAt: "",
        knockUpdatedAt: knockIndex.updatedAt,
        eventCount: 0,
        uniqueIdCount: 0,
        minDate: "",
        maxDate: "",
        knockRowCount: knockIndex.rows.length,
        phoneError: "Unknown candidate tag.",
      },
      candidates,
      combined: empty.combined,
      byChannel: empty.byChannel,
      changes: empty.changes,
      candidateSummaries: [],
      ids: empty.ids,
    };
  }

  if (selected) {
    const loaded = await loadTagEvents(selected, { buildIfMissing: true });
    const tally = tallyUniqueIds(loaded.events, tallyOpts);
    return {
      meta: {
        phoneUpdatedAt: loaded.phoneUpdatedAt,
        textUpdatedAt: loaded.textUpdatedAt,
        knockUpdatedAt: knockIndex.updatedAt,
        eventCount: tally.eventCount,
        uniqueIdCount: tally.uniqueIdCount,
        minDate: tally.minDate,
        maxDate: tally.maxDate,
        knockRowCount: knockIndex.rows.length,
        phoneError: loaded.phoneError,
        textError: loaded.textError,
      },
      candidates,
      combined: tally.combined,
      byChannel: tally.byChannel,
      changes: tally.changes,
      candidateSummaries: [summaryFromTally(selected, tally)],
      ids: tally.ids,
    };
  }

  const tags = getCoreCampaignTags();
  const summaries: UniqueIdCandidateSummary[] = [];
  let phoneUpdatedAt = "";
  let textUpdatedAt = "";
  let phoneError: string | undefined;
  let textError: string | undefined;
  let missingPhone = false;
  let missingText = false;
  let minDate = "";
  let maxDate = "";
  let eventCount = 0;
  let uniqueIdCount = 0;

  for (const tag of tags) {
    const loaded = await loadTagEvents(tag, { buildIfMissing: false });
    const tally = tallyUniqueIds(loaded.events, {
      startDate: query.startDate,
      endDate: query.endDate,
      page: 1,
      pageSize: 1,
    });
    summaries.push({
      ...summaryFromTally(tag, tally),
      changes: { ...tally.changes, people: [] },
    });
    phoneUpdatedAt = laterStamp(phoneUpdatedAt, loaded.phoneUpdatedAt);
    textUpdatedAt = laterStamp(textUpdatedAt, loaded.textUpdatedAt);
    if (loaded.phoneError) {
      if (/snapshot is missing/i.test(loaded.phoneError)) missingPhone = true;
      else phoneError = mergeErrors(phoneError, `${tag.label}: ${loaded.phoneError}`);
    }
    if (loaded.textError) {
      if (/snapshot is missing/i.test(loaded.textError)) missingText = true;
      else textError = mergeErrors(textError, `${tag.label}: ${loaded.textError}`);
    }
    minDate = earlierDay(minDate, tally.minDate);
    maxDate = laterDay(maxDate, tally.maxDate);
    eventCount += tally.eventCount;
    uniqueIdCount += tally.uniqueIdCount;
  }

  if (missingPhone) {
    phoneError = mergeErrors(
      "Phone unique-ID snapshots are missing. Refresh phone & text to load them.",
      phoneError
    );
  }
  if (missingText) {
    textError = mergeErrors(
      "Text unique-ID snapshots are missing. Refresh phone & text to load them.",
      textError
    );
  }

  return {
    meta: {
      phoneUpdatedAt,
      textUpdatedAt,
      knockUpdatedAt: knockIndex.updatedAt,
      eventCount,
      uniqueIdCount,
      minDate,
      maxDate,
      knockRowCount: knockIndex.rows.length,
      phoneError,
      textError,
    },
    candidates,
    combined: emptyFamilyCounts(),
    byChannel: emptyChannelCounts(),
    changes: emptyChangeSummary(),
    candidateSummaries: summaries,
    ids: { total: 0, page: 1, pageSize: query.pageSize || 100, rows: [] },
  };
}

export async function buildUniqueIdOverviewCsv(query: UniqueIdOverviewQuery): Promise<{
  filename: string;
  csv: string;
  error?: string;
}> {
  const tag = resolveUniqueIdTag(query.tagId);
  if (!tag) {
    return { filename: "unique-ids.csv", csv: "", error: "Select a candidate to export unique IDs." };
  }
  const loaded = await loadTagEvents(tag, { buildIfMissing: true });
  const tally = tallyUniqueIds(loaded.events, {
    startDate: query.startDate,
    endDate: query.endDate,
    q: query.q,
    family: query.family,
    channel: query.channel,
    page: 1,
    pageSize: 500,
  });
  const slug = tag.id.replace(/[^a-z0-9_-]/gi, "") || "candidate";
  return {
    filename: `unique-ids-${slug}.csv`,
    csv: uniqueIdRowsToCsv(tally.matchedRows),
    error: mergeErrors(loaded.phoneError, loaded.textError),
  };
}
