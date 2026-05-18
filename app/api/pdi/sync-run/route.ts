import { NextResponse } from "next/server";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { resolveMappingFilePathById } from "@/lib/pdi-tools/mapping-files";
import { pdiToolsProcessEnv } from "@/lib/pdi-tools/resolve-pdi-credentials";
import {
  ensurePdiSyncExportsDir,
  resolveStwToPdiScriptDir,
} from "@/lib/pdi-tools/sync-working-dir";
import { runPdiSyncEngine } from "@/lib/pdi-tools/sync/engine";
import { createSyncRun } from "@/lib/pdi-tools/sync/run-registry";
import { DEFAULT_MIN_RECORDS } from "@/lib/pdi-tools/sync/constants";

const MAX_CAPTURE_BYTES = 512 * 1024;

type SyncBody = {
  mode?: "incremental" | "range";
  start?: string;
  end?: string;
  dryRun?: boolean;
  minRecords?: number;
  rollbackRun?: string;
  mappingFileId?: string;
};

/**
 * Escape hatch for debugging parity with `stw_to_pdi.py`.
 * The TypeScript engine supports rollback, BQ lock, run log, ledger seed, and flag-instance tracking.
 */
function usePythonEngine(): boolean {
  return process.env.PDI_SYNC_ENGINE === "python";
}

function appendCapText(prev: string, chunk: Buffer, maxChars: number): string {
  const next = prev + chunk.toString("utf-8");
  if (next.length <= maxChars) return next;
  return next.slice(next.length - maxChars);
}

async function runPythonSync(body: SyncBody) {
  const python = process.env.PYTHON_EXECUTABLE ?? (process.platform === "win32" ? "python" : "python3");
  const scriptDir = resolveStwToPdiScriptDir();
  const cwd = ensurePdiSyncExportsDir();
  const scriptPath = process.env.PDI_STW_TO_PDI_SCRIPT
    ? path.resolve(process.env.PDI_STW_TO_PDI_SCRIPT)
    : path.join(scriptDir, "stw_to_pdi.py");

  if (!fs.existsSync(scriptPath)) {
    return NextResponse.json(
      {
        error: `stw_to_pdi.py not found at ${scriptPath}. Clone the repo with pdiv3 or set PDI_STW_TO_PDI_SCRIPT.`,
        code: 400,
        engine: "python",
      },
      { status: 400 }
    );
  }

  const args: string[] = [scriptPath, "--non-interactive"];
  let mappingPathUsed: string | null = null;

  if (body.mappingFileId?.trim() && body.mappingFileId.trim() !== "auto") {
    mappingPathUsed = resolveMappingFilePathById(body.mappingFileId.trim());
    args.push("--mapping-file", mappingPathUsed);
  }

  if (body.rollbackRun?.trim()) {
    args.push("--rollback-run", body.rollbackRun.trim());
  } else {
    const mode = body.mode === "range" ? "range" : "incremental";
    args.push("--mode", mode);
    if (mode === "range") {
      if (!body.start?.trim()) {
        return NextResponse.json(
          { error: "For range mode, start date (YYYY-MM-DD) is required.", code: 400, engine: "python" },
          { status: 400 }
        );
      }
      args.push("--start", body.start.trim());
      if (body.end?.trim()) {
        args.push("--end", body.end.trim());
      }
    }
    if (body.dryRun) {
      args.push("--dry-run");
    }
    if (typeof body.minRecords === "number" && Number.isFinite(body.minRecords)) {
      args.push("--min-records", String(Math.floor(body.minRecords)));
    }
  }

  const mergedEnv = pdiToolsProcessEnv();

  const result = await new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(python, args, {
      cwd,
      env: mergedEnv,
      shell: false,
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendCapText(stdout, chunk, MAX_CAPTURE_BYTES);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCapText(stderr, chunk, MAX_CAPTURE_BYTES);
    });

    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });

    child.on("error", (err) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n[spawn error] ${err.message}`,
      });
    });
  });

  return NextResponse.json({
    engine: "python",
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    command: `${python} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`,
    cwd,
    mappingFile: mappingPathUsed,
  });
}

export async function POST(req: Request) {
  let body: SyncBody;
  try {
    body = (await req.json()) as SyncBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: 400 }, { status: 400 });
  }

  if (usePythonEngine()) {
    return runPythonSync(body);
  }

  if (body.mode === "range" && !body.rollbackRun?.trim() && !body.start?.trim()) {
    return NextResponse.json(
      { error: "For range mode, start date (YYYY-MM-DD) is required.", code: 400, engine: "typescript" },
      { status: 400 }
    );
  }

  const runId = new Date().toISOString();
  createSyncRun(runId);

  const options = {
    mode: body.mode === "range" ? "range" as const : "incremental" as const,
    start: body.start,
    end: body.end,
    dryRun: Boolean(body.dryRun),
    minRecords:
      typeof body.minRecords === "number" && Number.isFinite(body.minRecords)
        ? Math.floor(body.minRecords)
        : DEFAULT_MIN_RECORDS,
    mappingFileId: body.mappingFileId?.trim() || "auto",
    rollbackRun: body.rollbackRun?.trim(),
  };

  void runPdiSyncEngine(runId, options);

  return NextResponse.json({
    engine: "typescript",
    runId,
    streamUrl: `/api/pdi/sync-run/${encodeURIComponent(runId)}/stream`,
  });
}
