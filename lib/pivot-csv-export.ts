/** RFC 4180-style CSV cell escaping for pivot table exports. */

export function escapeCsvCell(v: string | number): string {
  const s = String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Tab-separated pivot grid → CSV line array. */
export function pivotTsvToCsvLines(tsv: string): string[] {
  const lines = tsv.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (line === "") {
      out.push("");
      continue;
    }
    const cells = line.split("\t");
    out.push(cells.map(escapeCsvCell).join(","));
  }
  return out;
}

export function pivotTsvToCsv(tsv: string): string {
  return pivotTsvToCsvLines(tsv).join("\r\n");
}

export type PivotCsvSection = {
  campaignName: string;
  callDate: string;
  pivotTsv: string;
};

/**
 * One CSV file: each slice as a labeled block (title row, header, data) in display order.
 */
export function buildCombinedPivotTablesCsv(sections: PivotCsvSection[]): string {
  const blocks: string[] = [];

  for (const section of sections) {
    const tableLines = pivotTsvToCsvLines(section.pivotTsv);
    if (!tableLines.length) continue;

    const title = escapeCsvCell(`=== ${section.campaignName} | ${section.callDate} ===`);
    blocks.push(title);
    blocks.push(...tableLines);
    blocks.push("");
  }

  while (blocks.length > 0 && blocks[blocks.length - 1] === "") {
    blocks.pop();
  }

  return blocks.join("\r\n");
}

export function pivotExportFilename(dateHint?: string, sections?: PivotCsvSection[]): string {
  if (dateHint && /^\d{4}-\d{2}-\d{2}$/.test(dateHint)) {
    return `phonebank-pivots-${dateHint}.csv`;
  }
  if (sections?.length) {
    const dates = [...new Set(sections.map((s) => s.callDate).filter(Boolean))];
    if (dates.length === 1) return `phonebank-pivots-${dates[0]}.csv`;
  }
  return `phonebank-pivots-${new Date().toISOString().slice(0, 10)}.csv`;
}

export function downloadCsvFile(csv: string, filename: string): void {
  const bom = "\ufeff";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
