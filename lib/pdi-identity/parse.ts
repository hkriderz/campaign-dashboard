import { normalizeRecontactPersonId } from "@/lib/qc-recontact/ids";
import type { PdiIdentityUpsertInput } from "./types";

/**
 * Parse pasted lines: `PDI ID`, optional name, optional address.
 * Accepts tab, comma, or `|` separators. Skips a header row when the first cell looks like "pdi".
 */
export function parsePdiIdentityPaste(raw: string): {
  entries: PdiIdentityUpsertInput[];
  skippedLines: number;
} {
  const entries: PdiIdentityUpsertInput[] = [];
  let skippedLines = 0;
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const cells = splitIdentityLine(line);
    if (!cells.length) {
      skippedLines += 1;
      continue;
    }

    if (i === 0 && looksLikeHeader(cells[0] ?? "")) continue;

    const pdiId = normalizeRecontactPersonId(cells[0] ?? "");
    if (!pdiId) {
      skippedLines += 1;
      continue;
    }

    entries.push({
      pdiId,
      voterName: (cells[1] ?? "").trim(),
      voterAddress: (cells[2] ?? "").trim(),
      note: (cells[3] ?? "").trim() || undefined,
    });
  }

  return { entries, skippedLines };
}

function splitIdentityLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  if (line.includes("|")) return line.split("|").map((c) => c.trim());
  // CSV with simple quotes
  if (line.includes(",")) {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  }
  return [line.trim()];
}

function looksLikeHeader(firstCell: string): boolean {
  const n = firstCell.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return n === "pdi" || n === "pdiid" || n === "primaryid" || n === "id";
}
