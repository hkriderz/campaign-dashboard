import type { StwRow, StwData } from "./types";

export function parseNdjson<T>(text: string): T[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function buildStwData(rows: StwRow[]): StwData {
  const data: StwData = {};
  for (const row of rows) {
    if (!data[row.name]) data[row.name] = {};
    if (!data[row.name][row.question_name]) data[row.name][row.question_name] = [];
    if (!data[row.name][row.question_name].includes(row.answer_value)) {
      data[row.name][row.question_name].push(row.answer_value);
    }
  }
  return data;
}
