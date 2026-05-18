/**
 * Map wide PB crosstab report columns → PhoneBankCsvRow numeric fields (best-effort),
 * plus optional per-row {@link PhoneBankCsvRow.extraWideColumns} for script-specific headers.
 */
import { parseRawCsvToMatrix } from "./stw-raw-to-pb-report";
import { normalizeName, parseTimeToSec, secToTime } from "./csv-parser";
import { formatShortUsDate } from "./slice-key";
import { EMPTY_CSV_ROW, type PhoneBankCsvRow } from "./types";
import { normalizeWideHeaderKey, stripWideQuestionPrefixes } from "./wide-header-utils";

export type WideColumnMatch = {
  header: string;
  matched: boolean;
  /** Dashboard field to add counts into when importing (sums if multiple headers map here). */
  sheetField?: keyof PhoneBankCsvRow;
  category: string;
};

type Rule = { re: RegExp; field: keyof PhoneBankCsvRow; category: string };

/**
 * Ordered rules: first match wins (put more specific patterns first).
 * Rules are tested on the raw header and on {@link stripWideQuestionPrefixes} (e.g. "Canvass Results - Voicemail").
 */
const WIDE_HEADER_RULES: Rule[] = [
  /** STW / Sheets variants; keep word-boundary so "not answered" does not match. */
  {
    re: /\bcalls?\s*answered\b|\banswered\s+calls?\b|^answered$|\b(?:#|num(?:ber)?)\s*of\s+calls?\s*answered\b|\btotal\s+calls?\s*answered\b/i,
    field: "callsAnswered",
    category: "Calls",
  },
  { re: /correct\s*person|right\s*person/i, field: "correctPerson", category: "Calls" },
  { re: /surveyed|survey\s*complete|completed\s*survey/i, field: "surveyed", category: "Survey" },
  { re: /polling.*faizah|faizah.*poll/i, field: "pollingFaizah", category: "Polling" },
  { re: /polling.*undecided.*b|undecided\s*b.*poll/i, field: "pollingUndecidedB", category: "Polling" },
  { re: /polling.*undecided(?!.*b)/i, field: "pollingUndecided", category: "Polling" },
  { re: /polling.*traci|traci.*poll/i, field: "pollingTraci", category: "Polling" },
  { re: /pitch.*strong\s*support|pitch.*\bss\b|faizah\s*pitch.*ss/i, field: "pitchSS", category: "Pitch" },
  { re: /pitch.*undecided.*b/i, field: "pitchUndecidedB", category: "Pitch" },
  { re: /pitch.*undecided(?!.*b)/i, field: "pitchUndecided", category: "Pitch" },
  { re: /pitch.*(soft\s*opp|so\b)|pitch.*oppose/i, field: "pitchSO", category: "Pitch" },
  { re: /pitch.*hang|hang\s*up.*pitch/i, field: "pitchHangUp", category: "Pitch" },
  { re: /not\s*traci|ntp.*faizah|ntp.*park.*faizah/i, field: "ntpFaizah", category: "NTP" },
  { re: /ntp.*commit/i, field: "ntpCommits", category: "NTP" },
  { re: /ntp.*undecided/i, field: "ntpUndecided", category: "NTP" },
  { re: /ntp.*traci\s*supp/i, field: "ntpTraciSupporter", category: "NTP" },
  { re: /ntp.*hang/i, field: "ntpHangUp", category: "NTP" },
  /**
   * STW wide export uses "05 Anti Traci" / "Anti Traci" for the Not-Traci-Park block. Those answers must map
   * to NTP fields — not Final. A loose `wont.*vote.*traci` rule (without `final`) also matched Anti Traci B and
   * merged counts into {@link PhoneBankCsvRow.finalWontVoteTraci}, inflating "06 Final Result" pivot columns.
   */
  { re: /anti\s*traci.*wont\s*vote|anti\s*traci.*won'?t\s*vote/i, field: "ntpCommits", category: "NTP" },
  { re: /anti\s*traci.*undecided/i, field: "ntpUndecided", category: "NTP" },
  { re: /anti\s*traci.*(traci\s*park|d\.\s*traci)/i, field: "ntpTraciSupporter", category: "NTP" },
  { re: /final.*strong\s*support|final.*\bss\b|strong\s*support.*final/i, field: "finalSS", category: "Final" },
  /** Require "final" so Anti Traci "won't vote Traci" rows do not match here. */
  { re: /final.*wont.*vote.*traci/i, field: "finalWontVoteTraci", category: "Final" },
  { re: /final.*undecided/i, field: "finalUndecided", category: "Final" },
  { re: /final.*(soft\s*opp|so\b)|final.*oppose/i, field: "finalSO", category: "Final" },
  { re: /donate\s*now|donation\s*now/i, field: "donateNow", category: "Donate" },
  { re: /donate\s*later/i, field: "donateLater", category: "Donate" },
  { re: /donate.*undecided/i, field: "donateUndecided", category: "Donate" },
  { re: /donate.*wont|won'?t\s*donate/i, field: "donateWont", category: "Donate" },
  { re: /disclaimer.*no/i, field: "disclaimerNo", category: "Disclaimer" },
  { re: /disclaimer.*yes/i, field: "disclaimerYes", category: "Disclaimer" },
  { re: /amna|a\.m\.?\s*n\.a\./i, field: "canvassAMNA", category: "Canvass" },
  { re: /answering\s*machine|answer(?:ed)?\s*machine|machine\s*pickup/i, field: "canvassAnsweringMachine", category: "Canvass" },
  { re: /voicemail|voice\s*mail|left\s*(?:a\s*)?vm\b|vm\s*drop/i, field: "canvassVoicemail", category: "Canvass" },
  { re: /call\s*back|callback/i, field: "canvassCallBack", category: "Canvass" },
  { re: /declin/i, field: "canvassDeclined", category: "Canvass" },
  { re: /\bdnc\b|do\s*not\s*call/i, field: "canvassDNC", category: "Canvass" },
  { re: /lang.*other|language.*other/i, field: "canvassLangOther", category: "Canvass" },
  { re: /lang.*span|spanish/i, field: "canvassLangSpanish", category: "Canvass" },
  { re: /moved/i, field: "canvassMoved", category: "Canvass" },
  { re: /wrong\s*number/i, field: "canvassWrongNumber", category: "Canvass" },
  { re: /flyer.*yes/i, field: "flyerYes", category: "Flyer" },
  { re: /flyer.*unsure/i, field: "flyerUnsure", category: "Flyer" },
  { re: /flyer.*no/i, field: "flyerNo", category: "Flyer" },
  { re: /violation.*yes/i, field: "violationsYes", category: "Violations" },
  { re: /violation.*unsure/i, field: "violationsUnsure", category: "Violations" },
  { re: /violation.*no/i, field: "violationsNo", category: "Violations" },
  { re: /vote\s*plan.*\ba\b(?![-z])/i, field: "votePlanA", category: "Vote plan" },
  { re: /vote\s*plan.*\bb\b/i, field: "votePlanB", category: "Vote plan" },
  { re: /vote\s*plan.*\bc\b/i, field: "votePlanC", category: "Vote plan" },
  { re: /vote\s*plan.*\bd\b/i, field: "votePlanD", category: "Vote plan" },
  { re: /vote\s*plan.*\be\b/i, field: "votePlanE", category: "Vote plan" },
  { re: /vote\s*plan.*\bf\b/i, field: "votePlanF", category: "Vote plan" },
  { re: /vote\s*plan.*\bg\b/i, field: "votePlanG", category: "Vote plan" },
];

/** Dashboard / BQ rollup column order for wide imports (subset of {@link PhoneBankCsvRow} numeric metrics). */
export const WIDE_NUMERIC_FIELD_ORDER = [
  "callsAnswered",
  "correctPerson",
  "surveyed",
  "pollingFaizah",
  "pollingUndecidedB",
  "pollingUndecided",
  "pollingTraci",
  "pitchSS",
  "pitchUndecidedB",
  "pitchUndecided",
  "pitchSO",
  "pitchHangUp",
  "ntpFaizah",
  "ntpCommits",
  "ntpUndecided",
  "ntpTraciSupporter",
  "ntpHangUp",
  "finalSS",
  "finalWontVoteTraci",
  "finalUndecided",
  "finalSO",
  "donateNow",
  "donateLater",
  "donateUndecided",
  "donateWont",
  "disclaimerNo",
  "disclaimerYes",
  "canvassAMNA",
  "canvassAnsweringMachine",
  "canvassVoicemail",
  "canvassCallBack",
  "canvassDeclined",
  "canvassDNC",
  "canvassLangOther",
  "canvassLangSpanish",
  "canvassMoved",
  "canvassWrongNumber",
  "flyerYes",
  "flyerUnsure",
  "flyerNo",
  "violationsYes",
  "violationsUnsure",
  "violationsNo",
  "votePlanA",
  "votePlanB",
  "votePlanC",
  "votePlanD",
  "votePlanE",
  "votePlanF",
  "votePlanG",
] as const satisfies readonly (keyof PhoneBankCsvRow)[];

type NumericCsvKey = (typeof WIDE_NUMERIC_FIELD_ORDER)[number];

function isNumericCsvKey(k: keyof PhoneBankCsvRow): k is NumericCsvKey {
  return (WIDE_NUMERIC_FIELD_ORDER as readonly string[]).includes(k);
}

/** Script-style wide headers start with a question index (e.g. `09 Voicemail: …`); they must not match generic canvass disposition rules. */
function looksLikeNumberedScriptWideHeader(header: string): boolean {
  return /^\d{1,2}\s/.test(header.trim());
}

function isCanvassSheetField(field: keyof PhoneBankCsvRow): boolean {
  return String(field).startsWith("canvass");
}

function matchRuleOnHeaderVariants(header: string): Rule | null {
  const variants = [header, stripWideQuestionPrefixes(header)];
  for (const text of variants) {
    if (!text) continue;
    for (const rule of WIDE_HEADER_RULES) {
      if (isCanvassSheetField(rule.field) && looksLikeNumberedScriptWideHeader(header)) continue;
      if (rule.re.test(text)) return rule;
    }
  }
  return null;
}

function wideHoursColumnIndex(headers: readonly string[]): number {
  return headers.findIndex((h) => {
    const t = h.trim().toLowerCase();
    return /^hours\s+logged\s+in$/i.test(t) || /^hrs\s+logged\s+in$/i.test(t) || /^hours\s+logged$/i.test(t);
  });
}

function wideTimeInCallsColumnIndex(headers: readonly string[]): number {
  return headers.findIndex((h) => {
    const t = h.trim().toLowerCase();
    return /^time\s+in\s+calls$/i.test(t) || /^call\s*time$/i.test(t);
  });
}

function isWideTimeMetaHeader(header: string): boolean {
  const t = header.trim();
  return wideHoursColumnIndex([t]) >= 0 || wideTimeInCallsColumnIndex([t]) >= 0;
}

export function classifyWideHeaders(
  headers: string[],
  referenceHeaders?: string[],
  savedHeaderFieldMap?: Record<string, keyof PhoneBankCsvRow> | null
): WideColumnMatch[] {
  const ref = referenceHeaders?.length ? new Set(referenceHeaders) : null;
  const out: WideColumnMatch[] = [];
  for (const header of headers) {
    const trimmed = header.trim();
    if (trimmed === "Caller Name" || trimmed === "Date") continue;
    if (isWideTimeMetaHeader(trimmed)) continue;
    let matched = false;
    let sheetField: keyof PhoneBankCsvRow | undefined;
    let category = "Unmapped";

    const nk = normalizeWideHeaderKey(header);
    const saved = savedHeaderFieldMap?.[nk];
    if (saved && isNumericCsvKey(saved)) {
      matched = true;
      sheetField = saved;
      category = "Saved mapping (prior import)";
    } else {
      const rule = matchRuleOnHeaderVariants(header);
      if (rule) {
        matched = true;
        sheetField = rule.field;
        category = rule.category;
      }
    }

    if (!matched && ref?.has(header)) {
      matched = true;
      category = "Seen in reference PB";
    }
    out.push({ header, matched, sheetField, category });
  }
  return out;
}

/** Column order for headers stored in {@link PhoneBankCsvRow.extraWideColumns} (file left-to-right). */
export function buildExtraWideColumnOrderFromClassification(
  headers: string[],
  items: WideColumnMatch[]
): string[] {
  const byHeader = new Map(items.map((i) => [i.header, i]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of headers) {
    const t = h.trim();
    if (t === "Caller Name" || t === "Date") continue;
    if (isWideTimeMetaHeader(t)) continue;
    const it = byHeader.get(h);
    if (it?.sheetField) continue;
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

function blankSheetRow(
  phoneBankName: string,
  dateDisplay: string,
  callerRaw: string
): PhoneBankCsvRow {
  return {
    date: dateDisplay,
    phoneBankName,
    callerName: normalizeName(callerRaw),
    callerNameRaw: callerRaw,
    hoursLoggedIn: "0:00:00",
    timeInCalls: "0:00:00",
    surveyRateRaw: "",
    ...structuredClone(EMPTY_CSV_ROW) as Omit<typeof EMPTY_CSV_ROW, never>,
  };
}

export type WidePbImportResult = {
  rows: PhoneBankCsvRow[];
  /** Headers (in file order) whose counts are kept in {@link PhoneBankCsvRow.extraWideColumns}. */
  extraWideColumnOrder: string[];
};

/**
 * Turn wide PB report CSV into rows compatible with {@link parsePhoneBankCsv} / merge pipeline.
 * Unmapped numeric columns are stored in {@link PhoneBankCsvRow.extraWideColumns} under the exact header string.
 */
export function widePbReportCsvToPhoneBankRows(
  wideCsvText: string,
  phoneBankName: string,
  options?: { savedHeaderFieldMap?: Record<string, keyof PhoneBankCsvRow> | null }
): WidePbImportResult {
  const { headers, rows } = parseRawCsvToMatrix(wideCsvText);
  if (!headers.length) return { rows: [], extraWideColumnOrder: [] };
  const iCaller = headers.findIndex((h) => h.trim() === "Caller Name");
  const iDate = headers.findIndex((h) => h.trim() === "Date");
  if (iCaller < 0 || iDate < 0) {
    throw new Error('Wide PB report must include "Caller Name" and "Date" columns.');
  }
  const iHours = wideHoursColumnIndex(headers);
  const iTime = wideTimeInCallsColumnIndex(headers);
  const preview = classifyWideHeaders(headers, undefined, options?.savedHeaderFieldMap ?? undefined);
  const byHeader = new Map(preview.map((p) => [p.header, p]));
  const extraWideColumnOrder = buildExtraWideColumnOrderFromClassification(headers, preview);

  const out: PhoneBankCsvRow[] = [];
  for (const r of rows) {
    const callerRaw = (r[iCaller] ?? "").trim();
    const dateRaw = (r[iDate] ?? "").trim();
    if (!callerRaw) continue;
    const dateDisplay = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
      ? formatShortUsDate(dateRaw)
      : dateRaw;
    const row = blankSheetRow(phoneBankName, dateDisplay, callerRaw);
    const extra: Record<string, number> = {};

    for (let c = 0; c < headers.length; c++) {
      if (c === iCaller || c === iDate) continue;
      if (iHours >= 0 && c === iHours) {
        const rawCell = (r[c] ?? "").trim();
        row.hoursLoggedIn = rawCell.includes(":") ? secToTime(parseTimeToSec(rawCell)) : rawCell || "0:00:00";
        continue;
      }
      if (iTime >= 0 && c === iTime) {
        const rawCell = (r[c] ?? "").trim();
        row.timeInCalls = rawCell.includes(":") ? secToTime(parseTimeToSec(rawCell)) : rawCell || "0:00:00";
        continue;
      }
      const header = headers[c]!;
      const m = byHeader.get(header);
      const rawCell = (r[c] ?? "").trim();
      const n = parseInt(rawCell, 10);
      if (Number.isNaN(n) || n === 0) continue;

      if (m?.sheetField) {
        const k = m.sheetField;
        if (!isNumericCsvKey(k)) continue;
        row[k] = row[k] + n;
        /** Per-header counts for Data-tab pivots (several wide columns can map to the same field). */
        extra[header] = (extra[header] ?? 0) + n;
      } else {
        extra[header] = (extra[header] ?? 0) + n;
      }
    }

    if (Object.keys(extra).length) row.extraWideColumns = extra;

    if (row.surveyed > 0 && row.finalSS >= 0) {
      row.surveyRateRaw = `${((row.finalSS / row.surveyed) * 100).toFixed(1)}%`;
    }
    out.push(row);
  }
  return { rows: out, extraWideColumnOrder };
}

export function buildWideImportPreview(
  headers: string[],
  referenceHeaders?: string[],
  savedHeaderFieldMap?: Record<string, keyof PhoneBankCsvRow> | null
) {
  const items = classifyWideHeaders(headers, referenceHeaders, savedHeaderFieldMap);
  const mappedToSheet = items.filter((i) => Boolean(i.sheetField));
  const storedAsExtra = items.filter((i) => !i.sheetField);
  const extraWideColumnOrder = buildExtraWideColumnOrderFromClassification(headers, items);
  return { items, mappedToSheet, storedAsExtra, extraWideColumnOrder };
}

export { normalizeWideHeaderKey } from "./wide-header-utils";
