import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { resolveMappingFilePathById } from "@/lib/pdi-tools/mapping-files";
import { pdiToolsProcessEnv } from "@/lib/pdi-tools/resolve-pdi-credentials";
import {
  ensurePdiSyncExportsDir,
  resolveStwToPdiScriptDir,
} from "@/lib/pdi-tools/sync-working-dir";
import { computeDryRunCounts, type DryRunCounts } from "./dry-run-pipeline";
import type { SyncRunOptions } from "./types";

export type PythonDryRunCounts = {
  bqRowsRaw: number | null;
  bqRowsAfterFill: number | null;
  syntheticFinalRows: number | null;
  payloadCount: number | null;
  rowsSkipped: number | null;
  rowsDeduped: number | null;
  rowsDedupedSameBatch: number | null;
};

export type ParityField = keyof Omit<DryRunCounts, "mappingFile" | "dateRange">;

export type ParityRow = {
  field: ParityField;
  label: string;
  typescript: number;
  python: number | null;
  match: boolean;
};

export type ParityReport = {
  ok: boolean;
  mappingFile: string;
  dateRange: { start: string; end: string };
  typescript: DryRunCounts;
  python: PythonDryRunCounts;
  rows: ParityRow[];
  pythonStdout?: string;
  pythonStderr?: string;
  pythonError?: string;
};

function parseIntOrNull(re: RegExp, text: string): number | null {
  const m = text.match(re);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function parsePythonDryRunStdout(stdout: string): PythonDryRunCounts {
  return {
    bqRowsRaw: parseIntOrNull(/Retrieved (\d+) rows from BigQuery/, stdout),
    syntheticFinalRows: parseIntOrNull(/Synthesized (\d+) missing Final Result/, stdout),
    bqRowsAfterFill: parseIntOrNull(/After Final Result fill: (\d+) rows total/, stdout),
    payloadCount: parseIntOrNull(/Transformed (\d+) rows to PDI payload/, stdout),
    rowsSkipped: parseIntOrNull(/skipped (\d+) unmapped/, stdout),
    rowsDeduped: parseIntOrNull(/skipped \d+ unmapped, (\d+) duplicates/, stdout),
    rowsDedupedSameBatch: parseIntOrNull(
      /incl\. (\d+) duplicate rows in same batch/,
      stdout
    ),
  };
}

async function runPythonDryRun(options: SyncRunOptions): Promise<{
  counts: PythonDryRunCounts;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  const python = process.env.PYTHON_EXECUTABLE ?? (process.platform === "win32" ? "python" : "python3");
  const scriptDir = resolveStwToPdiScriptDir();
  const cwd = ensurePdiSyncExportsDir();
  const scriptPath = process.env.PDI_STW_TO_PDI_SCRIPT
    ? path.resolve(process.env.PDI_STW_TO_PDI_SCRIPT)
    : path.join(scriptDir, "stw_to_pdi.py");

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`stw_to_pdi.py not found at ${scriptPath}`);
  }

  const args = [scriptPath, "--non-interactive", "--dry-run"];
  if (options.mappingFileId && options.mappingFileId !== "auto") {
    args.push("--mapping-file", resolveMappingFilePathById(options.mappingFileId));
  }
  const mode = options.mode === "range" ? "range" : "incremental";
  args.push("--mode", mode);
  if (mode === "range") {
    args.push("--start", options.start!.trim());
    if (options.end?.trim()) args.push("--end", options.end.trim());
  }

  const mergedEnv = pdiToolsProcessEnv();

  const result = await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(python, args, { cwd, env: mergedEnv, shell: false });
      child.stdout?.on("data", (c: Buffer) => {
        stdout += c.toString("utf-8");
      });
      child.stderr?.on("data", (c: Buffer) => {
        stderr += c.toString("utf-8");
      });
      child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
      child.on("error", (err) =>
        resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${err.message}` })
      );
    }
  );

  return {
    ...result,
    counts: parsePythonDryRunStdout(result.stdout),
  };
}

const FIELD_LABELS: Record<ParityField, string> = {
  bqRowsRaw: "BQ rows (raw)",
  bqRowsAfterFill: "BQ rows (after fill)",
  syntheticFinalRows: "Synthetic final rows",
  payloadCount: "Payload count",
  rowsSkipped: "Rows skipped (unmapped)",
  rowsDeduped: "Rows deduped",
  rowsDedupedSameBatch: "Deduped (same batch)",
  ledgerSize: "Ledger size",
};

export async function compareSyncParity(options: SyncRunOptions): Promise<ParityReport> {
  const dryOptions: SyncRunOptions = { ...options, dryRun: true };
  const ts = await computeDryRunCounts(dryOptions);

  let python: PythonDryRunCounts;
  let pythonStdout: string | undefined;
  let pythonStderr: string | undefined;
  let pythonError: string | undefined;

  try {
    const py = await runPythonDryRun(dryOptions);
    python = py.counts;
    pythonStdout = py.stdout;
    pythonStderr = py.stderr;
    if (py.exitCode !== 0 && py.exitCode !== null) {
      pythonError = `Python exited with code ${py.exitCode}`;
    }
  } catch (e) {
    python = {
      bqRowsRaw: null,
      bqRowsAfterFill: null,
      syntheticFinalRows: null,
      payloadCount: null,
      rowsSkipped: null,
      rowsDeduped: null,
      rowsDedupedSameBatch: null,
    };
    pythonError = e instanceof Error ? e.message : String(e);
  }

  const compareFields = [
    "bqRowsRaw",
    "bqRowsAfterFill",
    "syntheticFinalRows",
    "payloadCount",
    "rowsSkipped",
    "rowsDeduped",
    "rowsDedupedSameBatch",
  ] as const satisfies readonly ParityField[];

  const rows: ParityRow[] = compareFields.map((field) => {
    const typescript = ts[field];
    const pyVal = python[field as keyof PythonDryRunCounts];
    const match =
      pyVal !== null
        ? pyVal === typescript
        : field === "rowsDedupedSameBatch" && typescript === 0;
    return { field, label: FIELD_LABELS[field], typescript, python: pyVal, match };
  });

  const ok = rows.every((r) => r.match) && !pythonError;

  return {
    ok,
    mappingFile: ts.mappingFile,
    dateRange: ts.dateRange,
    typescript: ts,
    python,
    rows,
    pythonStdout,
    pythonStderr,
    pythonError,
  };
}
