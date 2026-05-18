import type { PhoneBankCsvRow } from "./types";

// ─── Name Normalization ───────────────────────────────────────────────────────
// Handles the many name variations found in the Google Sheets exports.
// Keys are lowercase — matched after lowercasing + trimming the raw name.

const NAME_ALIASES: Record<string, string> = {
  "walter": "Walter Stone",
  "walter stone": "Walter Stone",
  "andrew": "Andrew Marshall",
  "andrew marshall": "Andrew Marshall",
  "ed k": "Ed Keenan",
  "ed keenan": "Ed Keenan",
  "mady": "Mady Hogan",
  "mady hogan": "Mady Hogan",
  "eve": "Eve Harrison",
  "eve harrison": "Eve Harrison",
  "eric": "Eric Giancoli",
  "eric giancoli": "Eric Giancoli",
  "tina": "Tina M.",
  "tina m": "Tina M.",
  "traci": "Traci Henderson",
  "traci henderson": "Traci Henderson",
  "mosa": "Mosa Alzabey",
  "mosa alzabey": "Mosa Alzabey",
  "carmen": "Carmen Acosta",
  "carmen acosta": "Carmen Acosta",
  "grace bush": "Grace Bush",
  "vikas bandhu": "Vikas Bandhu",
  "vikas": "Vikas Bandhu",
};

export function normalizeName(raw: string): string {
  if (!raw || raw.toUpperCase() === "TOTAL") return raw;
  const key = raw.trim().toLowerCase();
  if (NAME_ALIASES[key]) return NAME_ALIASES[key];
  // Title-case anything else
  return raw
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── CSV Tokenizer ────────────────────────────────────────────────────────────
// Handles RFC 4180 CSV: quoted fields, commas inside quotes, "" for literal "

/** RFC 4180-style line split (used by Sheets PB parser and STW raw conversion). */
export function tokenizeCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        cur += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        fields.push(cur);
        cur = "";
        i++;
      } else {
        cur += ch;
        i++;
      }
    }
  }
  fields.push(cur);
  return fields;
}

// ─── Value Helpers ────────────────────────────────────────────────────────────

function n(val: string | undefined): number {
  if (!val) return 0;
  const s = val.trim();
  if (s === "" || s === "#DIV/0!" || s.endsWith("%")) return 0;
  const v = parseInt(s, 10);
  return isNaN(v) ? 0 : v;
}

function s(val: string | undefined): string {
  return val?.trim() ?? "";
}

// ─── Main Parser ──────────────────────────────────────────────────────────────

/**
 * Parse the Google Sheets "Faizah PBs" CSV export.
 *
 * Row 0: column headers (skipped by index)
 * Row 1: TOTAL row (skipped — it's a pre-aggregated summary row with no date)
 * Row 2+: individual phonebanker session rows
 *
 * Columns are parsed by fixed index — header names are ignored because
 * some headers are blank (col 8 = survey rate, col 25 = spare Final Result slot).
 */
export function parsePhoneBankCsv(csvText: string): PhoneBankCsvRow[] {
  // Normalize Windows/Mac line endings
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows: PhoneBankCsvRow[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].trim();
    if (!line) continue;

    const cols = tokenizeCsvLine(line);

    // Skip the header row
    if (lineIdx === 0 && cols[0]?.trim().toLowerCase() === "date") continue;

    // Skip the TOTAL row (col 2 is "TOTAL" with no date)
    const callerRaw = s(cols[2]);
    if (callerRaw.toUpperCase() === "TOTAL") continue;

    // Skip rows with no caller name and no date
    const dateRaw = s(cols[0]);
    if (!dateRaw && !callerRaw) continue;

    // Skip blank/summary rows where all numeric fields are empty
    if (!callerRaw) continue;

    rows.push({
      date: dateRaw,
      phoneBankName: s(cols[1]),
      callerName: normalizeName(callerRaw),
      callerNameRaw: callerRaw,
      hoursLoggedIn: s(cols[3]),
      timeInCalls: s(cols[4]),
      callsAnswered: n(cols[5]),
      correctPerson: n(cols[6]),
      surveyed: n(cols[7]),
      surveyRateRaw: s(cols[8]),
      // Polling (cols 9–12)
      pollingFaizah: n(cols[9]),
      pollingUndecidedB: n(cols[10]),
      pollingUndecided: n(cols[11]),
      pollingTraci: n(cols[12]),
      // Faizah Pitch (cols 13–17)
      pitchSS: n(cols[13]),
      pitchUndecidedB: n(cols[14]),
      pitchUndecided: n(cols[15]),
      pitchSO: n(cols[16]),
      pitchHangUp: n(cols[17]),
      // Not Traci Park (cols 18–22)
      ntpFaizah: n(cols[18]),
      ntpCommits: n(cols[19]),
      ntpUndecided: n(cols[20]),
      ntpTraciSupporter: n(cols[21]),
      ntpHangUp: n(cols[22]),
      // Final Result (cols 23–27, col 25 is spare/blank in source)
      finalSS: n(cols[23]),
      finalWontVoteTraci: n(cols[24]),
      finalUndecided: n(cols[26]),
      finalSO: n(cols[27]),
      // Donate (cols 28–31)
      donateNow: n(cols[28]),
      donateLater: n(cols[29]),
      donateUndecided: n(cols[30]),
      donateWont: n(cols[31]),
      // Disclaimer (cols 32–33)
      disclaimerNo: n(cols[32]),
      disclaimerYes: n(cols[33]),
      // Canvass non-contact (cols 34–41)
      canvassAMNA: n(cols[34]),
      canvassCallBack: n(cols[35]),
      canvassDeclined: n(cols[36]),
      canvassDNC: n(cols[37]),
      canvassLangOther: n(cols[38]),
      canvassLangSpanish: n(cols[39]),
      canvassMoved: n(cols[40]),
      canvassWrongNumber: n(cols[41]),
      canvassAnsweringMachine: cols.length > 55 ? n(cols[55]) : 0,
      canvassVoicemail: cols.length > 56 ? n(cols[56]) : 0,
      // Flyer (cols 42–44)
      flyerYes: n(cols[42]),
      flyerUnsure: n(cols[43]),
      flyerNo: n(cols[44]),
      // Traci Violations Rap (cols 45–47) — present in PBs 017+
      violationsYes: n(cols[45]),
      violationsUnsure: n(cols[46]),
      violationsNo: n(cols[47]),
      // Vote Plan (cols 48–54) — present in PB 019
      votePlanA: n(cols[48]),
      votePlanB: n(cols[49]),
      votePlanC: n(cols[50]),
      votePlanD: n(cols[51]),
      votePlanE: n(cols[52]),
      votePlanF: n(cols[53]),
      votePlanG: n(cols[54]),
    });
  }

  return rows;
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

/** Sum all numeric fields across a set of rows. Non-numeric fields taken from first row. */
export function sumRows(
  rows: PhoneBankCsvRow[],
  overrides: Partial<PhoneBankCsvRow> = {}
): PhoneBankCsvRow {
  if (!rows.length) {
    return {
      date: "", phoneBankName: "", callerName: "", callerNameRaw: "",
      hoursLoggedIn: "0:00:00", timeInCalls: "0:00:00", surveyRateRaw: "",
      callsAnswered: 0, correctPerson: 0, surveyed: 0,
      pollingFaizah: 0, pollingUndecidedB: 0, pollingUndecided: 0, pollingTraci: 0,
      pitchSS: 0, pitchUndecidedB: 0, pitchUndecided: 0, pitchSO: 0, pitchHangUp: 0,
      ntpFaizah: 0, ntpCommits: 0, ntpUndecided: 0, ntpTraciSupporter: 0, ntpHangUp: 0,
      finalSS: 0, finalWontVoteTraci: 0, finalUndecided: 0, finalSO: 0,
      donateNow: 0, donateLater: 0, donateUndecided: 0, donateWont: 0,
      disclaimerNo: 0, disclaimerYes: 0,
      canvassAMNA: 0, canvassCallBack: 0, canvassDeclined: 0, canvassDNC: 0,
      canvassLangOther: 0, canvassLangSpanish: 0, canvassMoved: 0, canvassWrongNumber: 0,
      canvassAnsweringMachine: 0, canvassVoicemail: 0,
      flyerYes: 0, flyerUnsure: 0, flyerNo: 0,
      violationsYes: 0, violationsUnsure: 0, violationsNo: 0,
      votePlanA: 0, votePlanB: 0, votePlanC: 0, votePlanD: 0, votePlanE: 0, votePlanF: 0, votePlanG: 0,
      ...overrides,
    };
  }

  const NUM_KEYS: (keyof PhoneBankCsvRow)[] = [
    "callsAnswered", "correctPerson", "surveyed",
    "pollingFaizah", "pollingUndecidedB", "pollingUndecided", "pollingTraci",
    "pitchSS", "pitchUndecidedB", "pitchUndecided", "pitchSO", "pitchHangUp",
    "ntpFaizah", "ntpCommits", "ntpUndecided", "ntpTraciSupporter", "ntpHangUp",
    "finalSS", "finalWontVoteTraci", "finalUndecided", "finalSO",
    "donateNow", "donateLater", "donateUndecided", "donateWont",
    "disclaimerNo", "disclaimerYes",
    "canvassAMNA", "canvassCallBack", "canvassDeclined", "canvassDNC",
    "canvassLangOther", "canvassLangSpanish", "canvassMoved", "canvassWrongNumber",
    "canvassAnsweringMachine", "canvassVoicemail",
    "flyerYes", "flyerUnsure", "flyerNo",
    "violationsYes", "violationsUnsure", "violationsNo",
    "votePlanA", "votePlanB", "votePlanC", "votePlanD", "votePlanE", "votePlanF", "votePlanG",
  ];

  // Sum time strings (HH:MM:SS → seconds → back)
  const totalLoggedSec = rows.reduce((s, r) => s + parseTimeToSec(r.hoursLoggedIn), 0);
  const totalCallSec = rows.reduce((s, r) => s + parseTimeToSec(r.timeInCalls), 0);

  const base: PhoneBankCsvRow = { ...rows[0] };
  for (const key of NUM_KEYS) {
    (base as Record<string, unknown>)[key] = rows.reduce((s, r) => s + ((r[key] as number) ?? 0), 0);
  }
  base.hoursLoggedIn = secToTime(totalLoggedSec);
  base.timeInCalls = secToTime(totalCallSec);

  const mergedExtra: Record<string, number> = {};
  for (const r of rows) {
    const e = r.extraWideColumns;
    if (!e) continue;
    for (const [k, v] of Object.entries(e)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      mergedExtra[k] = (mergedExtra[k] ?? 0) + v;
    }
  }
  if (Object.keys(mergedExtra).length) base.extraWideColumns = mergedExtra;
  else delete base.extraWideColumns;

  const ssTotal = base.finalSS;
  const surveyedTotal = base.surveyed;
  base.surveyRateRaw = surveyedTotal > 0
    ? `${((ssTotal / surveyedTotal) * 100).toFixed(1)}%`
    : "";

  return { ...base, ...overrides };
}

export function parseTimeToSec(t: string): number {
  if (!t) return 0;
  const parts = t.trim().split(":").map(Number);
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  if (parts.length === 2) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60;
  return 0;
}

export function secToTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Compute SS rate as a formatted percentage string */
export function ssRate(row: PhoneBankCsvRow): string {
  if (!row.surveyed) return "—";
  return `${((row.finalSS / row.surveyed) * 100).toFixed(1)}%`;
}
