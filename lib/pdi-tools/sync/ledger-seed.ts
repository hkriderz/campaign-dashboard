import * as fs from "fs";
import * as path from "path";

import {
  ensurePdiSyncExportsDir,
  resolveStwToPdiScriptDir,
} from "@/lib/pdi-tools/sync-working-dir";
import { appendLedgerEntries, ledgerKey } from "./ledger";
import type { SyncLogger } from "./logger";

function shouldExcludeLedgerCsv(fileName: string): boolean {
  const n = fileName.toLowerCase();
  if (n === "pdi_mapping_report.csv" || n === "pdi_payload_preview.csv") return true;
  if (n.startsWith("final_result_synthesis_")) return true;
  if (n.startsWith("pdi_mapping_report_")) return true;
  if (n.startsWith("pdi_payload_preview_")) return true;
  return false;
}

function resolveLedgerSeedDirs(): string[] {
  const env = process.env.PDI_LEDGER_EXPORT_DIRS?.trim();
  const fromEnv = env
    ? env
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => path.resolve(s))
    : [];

  const defaults = [ensurePdiSyncExportsDir(), resolveStwToPdiScriptDir()];
  const merged = [...fromEnv, ...defaults];
  const uniq = [...new Set(merged.map((p) => path.resolve(p)))];
  return uniq.filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
}

/** Minimal CSV line splitter (handles quoted fields). */
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function readCsvRecords(filePath: string): Array<Record<string, string>> {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvRow(lines[0]!).map((h) => h.trim());
  const idx = (name: string) => header.findIndex((h) => h.toUpperCase() === name.toUpperCase());
  const iPdi = idx("PDIID");
  const iCode = idx("RESPONSECODE");
  const iDate = idx("FLAGENTRYDATE");
  if (iPdi === -1 || iCode === -1 || iDate === -1) return [];

  const rows: Array<Record<string, string>> = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvRow(lines[li]!);
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]!] = cols[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function iterJsonFlags(filePath: string): Array<Record<string, string>> {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  const arr: unknown =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) && "flags" in parsed
      ? (parsed as { flags: unknown }).flags
      : parsed;
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is Record<string, string> => x !== null && typeof x === "object");
}

function listExportFilesInDir(dir: string): { json: string[]; csv: string[] } {
  const json: string[] = [];
  const csv: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { json, csv };
  }
  const jsonRe = /^pdi_flags_all_export_.*\.json$/i;
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      if (!fs.statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    if (jsonRe.test(name)) json.push(full);
    else if (name.toLowerCase().endsWith(".csv") && !shouldExcludeLedgerCsv(name)) csv.push(full);
  }
  return { json, csv };
}

/**
 * Seed dedupe ledger from PDI export JSON/CSV files (parity with `stw_to_pdi.seed_ledger_from_exports`).
 */
export async function seedLedgerFromExports(
  ledger: Set<string>,
  runId: string,
  log: SyncLogger
): Promise<number> {
  const dirs = resolveLedgerSeedDirs();
  const exportFilesSet = new Set<string>();

  for (const dir of dirs) {
    const { json, csv } = listExportFilesInDir(dir);
    for (const p of json) exportFilesSet.add(p);
    for (const p of csv) exportFilesSet.add(p);
  }

  const exportFiles = [...exportFilesSet];
  if (exportFiles.length === 0) return 0;

  const newEntries: Array<{ pdi_id: string; flag_code: string; flag_date: string }> = [];

  for (const exportPath of exportFiles) {
    try {
      const base = path.basename(exportPath);
      let records: Array<Record<string, string>> = [];
      if (base.toLowerCase().endsWith(".json")) {
        records = iterJsonFlags(exportPath);
      } else {
        records = readCsvRecords(exportPath);
      }

      for (const flag of records) {
        const pdiId = String(flag.PDIID ?? flag.pdiid ?? "").trim();
        const code = String(flag.RESPONSECODE ?? flag.responsecode ?? "").trim().toUpperCase();
        const rawDate = String(flag.FLAGENTRYDATE ?? flag.flagentrydate ?? "").trim();
        const dateStr = rawDate.length >= 10 ? rawDate.slice(0, 10) : "";
        if (!pdiId || !code || !dateStr) continue;
        const key = ledgerKey(pdiId, code, dateStr);
        if (!ledger.has(key)) {
          ledger.add(key);
          newEntries.push({ pdi_id: pdiId, flag_code: code, flag_date: dateStr });
        }
      }
    } catch (e) {
      log.warn(
        `Failed to seed ledger from ${path.basename(exportPath)}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  if (newEntries.length > 0) {
    await appendLedgerEntries(newEntries, "csv_seed", runId, log);
  }
  log.info(`Seeded ${newEntries.length} ledger entries from ${exportFiles.length} export file(s)`);
  return newEntries.length;
}
