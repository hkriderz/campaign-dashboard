import { normalizeRecontactPersonId } from "@/lib/qc-recontact/ids";
import type { PdiIdentityUpsertInput } from "./types";

export type PdiIdentityColumnMapping = {
  pdiIdCol: string;
  voterNameCol: string;
  voterAddressCol: string;
  noteCol: string;
};

export type PdiIdentityScanResult = {
  columns: string[];
  firstRow: Record<string, string>;
  rowCountEstimate: number;
  suggestedMapping: PdiIdentityColumnMapping;
};

const PDI_ALIASES = [
  "pdi id",
  "pdiid",
  "pdi",
  "primaryid",
  "primary id",
  "v1 pdiid",
  "v1_pdiid",
  "v1 primaryid",
  "voter id",
  "voterid",
];
const NAME_ALIASES = [
  "name",
  "voter name",
  "votername",
  "full name",
  "fullname",
  "voter",
];
const ADDRESS_ALIASES = [
  "address",
  "voter address",
  "voteraddress",
  "home address",
  "street address",
  "residence address",
  "addr",
];
const NOTE_ALIASES = ["note", "notes", "source", "comment"];

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

function canonical(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickAlias(columns: string[], aliases: readonly string[]): string {
  const byCanonical = new Map(columns.map((column) => [canonical(column), column]));
  for (const alias of aliases) {
    const match = byCanonical.get(canonical(alias));
    if (match) return match;
  }
  return "";
}

/** Prefer first+last name columns when a single name column is missing. */
function composeNameFromParts(row: Record<string, string>, columns: string[]): string {
  const byCanonical = new Map(columns.map((column) => [canonical(column), column]));
  const firstKeys = ["firstname", "fname", "first", "v1firstname", "givenname"];
  const lastKeys = ["lastname", "lname", "last", "v1lastname", "surname", "familyname"];
  let first = "";
  let last = "";
  for (const key of firstKeys) {
    const col = byCanonical.get(key);
    if (col && row[col]?.trim()) {
      first = row[col]!.trim();
      break;
    }
  }
  for (const key of lastKeys) {
    const col = byCanonical.get(key);
    if (col && row[col]?.trim()) {
      last = row[col]!.trim();
      break;
    }
  }
  return [first, last].filter(Boolean).join(" ");
}

export function suggestPdiIdentityMapping(columns: string[]): PdiIdentityColumnMapping {
  return {
    pdiIdCol: pickAlias(columns, PDI_ALIASES),
    voterNameCol: pickAlias(columns, NAME_ALIASES),
    voterAddressCol: pickAlias(columns, ADDRESS_ALIASES),
    noteCol: pickAlias(columns, NOTE_ALIASES),
  };
}

export function scanPdiIdentityCsv(text: string): PdiIdentityScanResult {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line) => line.trim());
  const columns = parseCsvLine(lines[0] ?? "");
  const firstValues = parseCsvLine(lines[1] ?? "");
  const firstRow: Record<string, string> = {};
  columns.forEach((column, index) => {
    firstRow[column] = firstValues[index] ?? "";
  });
  return {
    columns,
    firstRow,
    rowCountEstimate: Math.max(0, lines.length - 1),
    suggestedMapping: suggestPdiIdentityMapping(columns),
  };
}

export function entriesFromPdiIdentityCsv(
  text: string,
  mapping: PdiIdentityColumnMapping
): { entries: PdiIdentityUpsertInput[]; skippedNoPdiId: number; rowCount: number } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line) => line.trim());
  if (lines.length < 2) return { entries: [], skippedNoPdiId: 0, rowCount: 0 };

  const headers = parseCsvLine(lines[0] ?? "");
  const pdiCol = mapping.pdiIdCol.trim();
  if (!pdiCol || !headers.includes(pdiCol)) {
    throw new Error("Map a PDI ID column before importing.");
  }

  const entries: PdiIdentityUpsertInput[] = [];
  let skippedNoPdiId = 0;

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    const pdiId = normalizeRecontactPersonId(row[pdiCol] ?? "");
    if (!pdiId) {
      skippedNoPdiId += 1;
      continue;
    }

    const mappedName = mapping.voterNameCol ? (row[mapping.voterNameCol] ?? "").trim() : "";
    const voterName = mappedName || composeNameFromParts(row, headers);
    const voterAddress = mapping.voterAddressCol ? (row[mapping.voterAddressCol] ?? "").trim() : "";
    const note = mapping.noteCol ? (row[mapping.noteCol] ?? "").trim() : "";

    entries.push({
      pdiId,
      voterName,
      voterAddress,
      note: note || undefined,
    });
  }

  return { entries, skippedNoPdiId, rowCount: Math.max(0, lines.length - 1) };
}
