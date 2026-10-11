import fs from "fs";
import path from "path";
import { DateTime } from "luxon";

const LA = "America/Los_Angeles";
const TIB = 1024 ** 4;
const LOG_PATH = path.join(process.cwd(), "data", "bq-cost-log.jsonl");

/** A refresh that reads about as much as the callee or contact JSON column. */
export const JSON_SCAN_WARNING_BYTES = 2.2 * 1024 ** 3;

export type BqCostEntry = {
  at: string;
  label: string;
  bytesBilled: number;
  estimatedUsd: number;
};

export function bqUsdPerTib(): number {
  const raw = Number(process.env.BQ_USD_PER_TIB ?? "6.25");
  return Number.isFinite(raw) && raw > 0 ? raw : 6.25;
}

export function bqMonthlyBudgetUsd(): number | null {
  const raw = process.env.BQ_MONTHLY_BUDGET_USD;
  if (raw == null || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function estimateBqUsd(bytesBilled: number): number {
  if (!Number.isFinite(bytesBilled) || bytesBilled <= 0) return 0;
  return (bytesBilled / TIB) * bqUsdPerTib();
}

export function appendBqCostLog(entry: BqCostEntry): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch {
    // A log failure must not fail the query that already ran.
  }
}

export type BqMonthCost = {
  month: string;
  totalBytesBilled: number;
  totalEstimatedUsd: number;
  budgetUsd: number | null;
  usdPerTib: number;
  jobs: BqCostEntry[];
};

function currentLaMonth(): string {
  return DateTime.now().setZone(LA).toFormat("yyyy-MM");
}

function entryMonth(at: string): string | null {
  const parsed = DateTime.fromISO(at, { setZone: true });
  if (!parsed.isValid) return null;
  return parsed.setZone(LA).toFormat("yyyy-MM");
}

export function readBqMonthCost(limit = 25): BqMonthCost {
  const month = currentLaMonth();
  const inMonth: BqCostEntry[] = [];
  if (fs.existsSync(LOG_PATH)) {
    const text = fs.readFileSync(LOG_PATH, "utf-8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as BqCostEntry;
        if (!entry || typeof entry.at !== "string") continue;
        if (entryMonth(entry.at) !== month) continue;
        inMonth.push({
          at: entry.at,
          label: typeof entry.label === "string" ? entry.label : "query",
          bytesBilled: Number(entry.bytesBilled) || 0,
          estimatedUsd: Number(entry.estimatedUsd) || 0,
        });
      } catch {
        continue;
      }
    }
  }
  const totalBytesBilled = inMonth.reduce((sum, entry) => sum + entry.bytesBilled, 0);
  const totalEstimatedUsd = inMonth.reduce((sum, entry) => sum + entry.estimatedUsd, 0);
  return {
    month,
    totalBytesBilled,
    totalEstimatedUsd,
    budgetUsd: bqMonthlyBudgetUsd(),
    usdPerTib: bqUsdPerTib(),
    jobs: inMonth.slice(-limit).reverse(),
  };
}
