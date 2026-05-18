/**
 * Derive calls-answered and surveyed counts for CSV / wide-import rows when Scale-to-Win headers
 * did not map onto {@link PhoneBankCsvRow.callsAnswered} / {@link PhoneBankCsvRow.surveyed}.
 *
 * **Calls answered (wide / imported PB report)** — product definition requested for the Data tab:
 * sum of every **canvass / disposition option column** (each `extraWideColumns` header that is a canvass-result style
 * bucket or maps to `correctPerson` / `canvass*`), so the total matches “add the canvass results options together.”
 * When no such columns exist in extras, fall back to an explicit “Calls answered” cell, then to BQ-style heuristics.
 *
 * BigQuery warehouse metric (see `fetchTagDailyCallerStatsUncached` in `lib/queries/phonebanking.ts`) remains
 * `COUNT(DISTINCT call_id)` over canvass-disposition survey questions — a different grain; the wide sheet sum is
 * what we mirror for imports.
 */
import { buildWideImportPreview, normalizeWideHeaderKey } from "./pb-wide-report-to-sheet-rows";
import {
  SCRIPT_BLOCK_EXCLUSION_REGEX_BODY,
  TRACI_SCRIPT_EXCLUSION_REGEX_BODY,
} from "./survey-i18n/rules";
import type { PhoneBankCsvRow } from "./types";

/** Memo: header → whether wide import maps this title onto any numeric sheet field (counts live on `row`, not extras). */
const wideHeaderMapsToSheetFieldCache = new Map<string, boolean>();

function wideExtraHeaderMapsToNumericSheetField(headerTrimmed: string): boolean {
  if (!headerTrimmed) return false;
  const hit = wideHeaderMapsToSheetFieldCache.get(headerTrimmed);
  if (hit !== undefined) return hit;
  const { items } = buildWideImportPreview([headerTrimmed], undefined, undefined);
  const sf = items[0]?.sheetField;
  const maps = Boolean(sf);
  wideHeaderMapsToSheetFieldCache.set(headerTrimmed, maps);
  return maps;
}

const scriptBlockExclusionRe = new RegExp(SCRIPT_BLOCK_EXCLUSION_REGEX_BODY, "i");
const traciScriptExclusionRe = new RegExp(TRACI_SCRIPT_EXCLUSION_REGEX_BODY, "i");
const bqCanvassDispositionQuestionRe =
  /contact\s*quality|canvass(?:ing)?\s+results?\b|canvass\s*result|canvass\s*disposition|call\s*disposition|contact\s*disposition/i;

const bqCanvassDispositionHeaderCache = new Map<string, boolean>();

function wideHeaderTreatedAsBqCanvassDispositionQuestion(headerTrimmed: string): boolean {
  if (!headerTrimmed) return false;
  const hit = bqCanvassDispositionHeaderCache.get(headerTrimmed);
  if (hit !== undefined) return hit;
  const lower = headerTrimmed.toLowerCase();
  let ok = false;
  if (!scriptBlockExclusionRe.test(lower) && !traciScriptExclusionRe.test(lower)) {
    ok = bqCanvassDispositionQuestionRe.test(lower);
  }
  bqCanvassDispositionHeaderCache.set(headerTrimmed, ok);
  return ok;
}

function isCanvassDispositionSheetField(sf: keyof PhoneBankCsvRow | undefined): sf is keyof PhoneBankCsvRow {
  if (!sf) return false;
  if (sf === "correctPerson") return true;
  return String(sf).startsWith("canvass");
}

/**
 * Sum of wide-report **option columns** that are canvass / contact dispositions (each header counted once;
 * duplicate normalized titles use max to avoid double-counting the same column label).
 */
function sumCanvassResultOptionColumns(row: PhoneBankCsvRow): number {
  const extra = row.extraWideColumns;
  if (!extra) return 0;

  const byNormalizedHeader = new Map<string, number>();
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    const kt = k.trim();
    if (/^\d+\s/.test(kt)) continue;

    const { items } = buildWideImportPreview([kt], undefined, undefined);
    const sf = items[0]?.sheetField;
    if (sf === "callsAnswered" || sf === "surveyed") continue;

    /** Numbered script lines sometimes sit under a canvass-result block; they are not dial dispositions. */
    if (/^canvass\s+result\s*:\s*\d/i.test(kt)) continue;

    let include = false;
    if (isCanvassDispositionSheetField(sf)) include = true;
    else if (/^canvass\s+result\s*:/i.test(kt) || /^canvass(?:ing)?\s+results?\s*[-–—:]/i.test(kt)) include = true;
    else if (wideHeaderTreatedAsBqCanvassDispositionQuestion(kt)) include = true;

    if (!include) continue;

    const nk = normalizeWideHeaderKey(kt);
    byNormalizedHeader.set(nk, Math.max(byNormalizedHeader.get(nk) ?? 0, v));
  }

  let sum = 0;
  for (const v of byNormalizedHeader.values()) sum += v;
  return sum;
}

/** Explicit “Calls answered” / “# of …” totals column in extras (not summed into canvass options). */
function sumCallsAnsweredFromExtraWideColumns(row: PhoneBankCsvRow): number {
  const extra = row.extraWideColumns;
  if (!extra) return 0;
  let s = 0;
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    const kt = k.trim();
    const { items } = buildWideImportPreview([kt], undefined, undefined);
    if (items[0]?.sheetField === "callsAnswered") {
      s += v;
      continue;
    }
    if (
      /\bcalls?\s*answered\b|\banswered\s+calls?\b|\b(?:#|num(?:ber)?)\s+of\s+calls?\s*answered\b|\btotal\s+calls?\s*answered\b/i.test(
        kt
      )
    ) {
      s += v;
    }
  }
  return s;
}

function sumNonContactCanvass(row: PhoneBankCsvRow): number {
  return (
    row.canvassAMNA +
    row.canvassAnsweringMachine +
    row.canvassVoicemail +
    row.canvassCallBack +
    row.canvassDeclined +
    row.canvassDNC +
    row.canvassLangOther +
    row.canvassLangSpanish +
    row.canvassMoved +
    row.canvassWrongNumber
  );
}

/** Fallback when wide extras do not list per-option canvass columns (legacy narrow CSV). */
function inferCallsAnsweredFallback(row: PhoneBankCsvRow): number {
  if (row.callsAnswered > 0) return row.callsAnswered;

  const fromCallsCol = sumCallsAnsweredFromExtraWideColumns(row);
  if (fromCallsCol > 0) return fromCallsCol;

  let canvExtra = 0;
  const extra = row.extraWideColumns;
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
      const kt = k.trim();
      if (/^\d+\s/.test(kt)) continue;
      if (/^canvass\s+result\s*:/i.test(kt)) continue;
      if (/^canvass(?:ing)?\s+results?\s*[-–—:]/i.test(kt)) continue;
      if (wideExtraHeaderMapsToNumericSheetField(kt)) continue;
      if (!wideHeaderTreatedAsBqCanvassDispositionQuestion(kt)) continue;
      canvExtra += v;
    }
  }
  return row.correctPerson + sumNonContactCanvass(row) + canvExtra;
}

function computeCallsAnsweredForImport(row: PhoneBankCsvRow): number {
  const fromOptions = sumCanvassResultOptionColumns(row);
  if (fromOptions > 0) return fromOptions;
  return inferCallsAnsweredFallback(row);
}

function inferSurveyed(row: PhoneBankCsvRow): number {
  if (row.surveyed > 0) return row.surveyed;
  const cap = row.correctPerson;
  if (cap <= 0) return 0;

  const stages = [
    row.pollingFaizah + row.pollingUndecidedB + row.pollingUndecided + row.pollingTraci,
    row.pitchSS + row.pitchUndecidedB + row.pitchUndecided + row.pitchSO + row.pitchHangUp,
    row.ntpFaizah + row.ntpCommits + row.ntpUndecided + row.ntpTraciSupporter + row.ntpHangUp,
    row.finalSS + row.finalWontVoteTraci + row.finalUndecided + row.finalSO,
    row.donateNow + row.donateLater + row.donateUndecided + row.donateWont,
    row.disclaimerNo + row.disclaimerYes,
    row.flyerYes + row.flyerUnsure + row.flyerNo,
    row.violationsYes + row.violationsUnsure + row.violationsNo,
    row.votePlanA +
      row.votePlanB +
      row.votePlanC +
      row.votePlanD +
      row.votePlanE +
      row.votePlanF +
      row.votePlanG,
  ];

  for (const s of stages) {
    if (s > 0) return Math.min(cap, s);
  }

  const extra = row.extraWideColumns;
  if (extra) {
    let finalExtra = 0;
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
      if (/final\s*result/i.test(k)) finalExtra += v;
    }
    if (finalExtra > 0) return Math.min(cap, finalExtra);
  }

  return 0;
}

/**
 * Returns a shallow clone when inference changes metrics; otherwise the original row reference.
 */
export function withInferredContactMetrics(row: PhoneBankCsvRow): PhoneBankCsvRow {
  const inferredCalls = computeCallsAnsweredForImport(row);
  const inferredSurveyed = inferSurveyed(row);
  const callsAnswered = inferredCalls;
  const surveyed = Math.max(row.surveyed, inferredSurveyed);
  if (callsAnswered === row.callsAnswered && surveyed === row.surveyed) {
    return row;
  }
  const next: PhoneBankCsvRow = { ...row, callsAnswered, surveyed };
  if (surveyed > 0 && next.finalSS >= 0) {
    next.surveyRateRaw = `${((next.finalSS / surveyed) * 100).toFixed(1)}%`;
  }
  return next;
}
