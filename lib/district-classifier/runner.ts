import "server-only";

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import {
  getDistrictJob,
  refreshDistrictJobExports,
  updateDistrictJob,
} from "./store";
import type { DistrictLayerId } from "./types";

const MAX_CAPTURE_CHARS = 512 * 1024;
const runningJobs = new Set<string>();
const DATA_ROOT = path.join(process.cwd(), "data", "district-classifier");
const RUN_LOCK_PATH = path.join(DATA_ROOT, "district-engine.lock.json");
const STARTING_LOCK_TTL_MS = 2 * 60 * 1000;
const RUN_LOCK_MAX_MS = 2 * 60 * 60 * 1000;

export function isDistrictClassificationRunning(): boolean {
  return runningJobs.size > 0 || activeRunLock() !== null;
}

type RunLock = {
  jobId: string;
  pid: number | null;
  startedAt: string;
};

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readRunLock(): RunLock | null {
  try {
    if (!fs.existsSync(RUN_LOCK_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(RUN_LOCK_PATH, "utf-8")) as Partial<RunLock>;
    if (!parsed.jobId || typeof parsed.jobId !== "string") return null;
    return {
      jobId: parsed.jobId,
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function writeRunLock(jobId: string, pid: number | null = null): void {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const existing = readRunLock();
  const startedAt = existing?.jobId === jobId ? existing.startedAt : new Date().toISOString();
  fs.writeFileSync(
    RUN_LOCK_PATH,
    JSON.stringify(
      {
        jobId,
        pid,
        startedAt,
      } satisfies RunLock,
      null,
      2
    ),
    "utf-8"
  );
}

function removeRunLock(jobId?: string): void {
  const existing = readRunLock();
  if (jobId && existing && existing.jobId !== jobId) return;
  try {
    fs.rmSync(RUN_LOCK_PATH, { force: true });
  } catch {
    return;
  }
}

function activeRunLock(): RunLock | null {
  const lock = readRunLock();
  if (!lock) return null;

  const startedAt = Date.parse(lock.startedAt);
  if (Number.isFinite(startedAt) && Date.now() - startedAt > RUN_LOCK_MAX_MS) {
    removeRunLock(lock.jobId);
    return null;
  }

  const job = getDistrictJob(lock.jobId);
  if (job && (job.status === "completed" || job.status === "failed")) {
    removeRunLock(lock.jobId);
    return null;
  }

  if (lock.pid && processExists(lock.pid)) {
    return lock;
  }

  if (!lock.pid) {
    if (Number.isFinite(startedAt) && Date.now() - startedAt < STARTING_LOCK_TTL_MS) {
      return lock;
    }
  }

  removeRunLock(lock.jobId);
  return null;
}

const REQUIRED_GEODATA: Record<DistrictLayerId, { filePath: string; label: string }> = {
  "la-city-council": {
    filePath: path.join(process.cwd(), "geodata", "la-city-council.geojson"),
    label: "LA City Council",
  },
  "ca-state-assembly": {
    filePath: path.join(process.cwd(), "geodata", "ca-state-assembly.geojson"),
    label: "CA Assembly",
  },
};

function appendCapturedText(previous: string, chunk: Buffer): string {
  const next = previous + chunk.toString("utf-8");
  if (next.length <= MAX_CAPTURE_CHARS) return next;
  return next.slice(next.length - MAX_CAPTURE_CHARS);
}

function resolvePythonExecutable(): string {
  return process.env.PYTHON_EXECUTABLE ?? (process.platform === "win32" ? "python" : "python3");
}

function resolveEngineCli(): string {
  if (process.env.DISTRICT_ENGINE_CLI?.trim()) {
    return path.resolve(process.env.DISTRICT_ENGINE_CLI.trim());
  }
  return path.join(process.cwd(), "district-engine", "cli.py");
}

function assertRequiredGeodata(layers: DistrictLayerId[]): void {
  const missing = layers
    .map((layer) => REQUIRED_GEODATA[layer])
    .filter((entry) => !fs.existsSync(entry.filePath));

  if (!missing.length) return;

  throw new Error(
    [
      "District boundary data is not installed.",
      `Missing: ${missing.map((entry) => `${entry.label} (${entry.filePath})`).join(", ")}`,
      "Add the GeoJSON files under geodata/ before running classification.",
    ].join(" ")
  );
}

export function validateDistrictClassificationEnvironment(layers: DistrictLayerId[]): void {
  const scriptPath = resolveEngineCli();
  if (!fs.existsSync(scriptPath)) {
    throw new Error(
      `District engine CLI not found at ${scriptPath}. Set DISTRICT_ENGINE_CLI if it lives elsewhere.`
    );
  }
  assertRequiredGeodata(layers);
}

export function cancelDistrictClassificationJob(jobId: string): void {
  runningJobs.delete(jobId);

  const lock = readRunLock();
  if (lock?.jobId === jobId) {
    if (lock.pid && processExists(lock.pid)) {
      try {
        process.kill(lock.pid);
      } catch {
        // The process may have exited between the liveness check and kill.
      }
    }
    removeRunLock(jobId);
  }

  updateDistrictJob(jobId, {
    status: "failed",
    progressMessage: "Classification cancelled.",
    errorMessage: "This job was manually cancelled before it completed.",
    completedAt: new Date().toISOString(),
  });
}

function buildArgs(scriptPath: string, jobId: string): string[] {
  const job = getDistrictJob(jobId);
  if (!job) throw new Error("District classification job not found.");

  return [
    scriptPath,
    "process",
    "--job-id",
    job.id,
    "--input",
    job.inputPath,
    "--output-dir",
    job.outputDir,
    "--db",
    job.dbPath,
    "--layers",
    job.layers.join(","),
    "--columns-json",
    JSON.stringify(job.columnMapping),
    "--targets-json",
    JSON.stringify(job.targetSelection),
  ];
}

function progressMessage(status: string, processedRows?: number, totalRows?: number | null): string {
  if (status === "completed") return "Classification complete.";
  if (status === "failed") return "Classification failed.";
  if (typeof processedRows === "number" && typeof totalRows === "number" && totalRows > 0) {
    return `Processing rows ${processedRows.toLocaleString()} of ${totalRows.toLocaleString()}.`;
  }
  return "Classifier is processing rows and writing outputs.";
}

function handleEventLine(jobId: string, line: string): void {
  if (!line.startsWith("EVENT ")) return;
  const job = getDistrictJob(jobId);
  if (!job) return;
  try {
    const event = JSON.parse(line.slice("EVENT ".length)) as {
      status?: "queued" | "processing" | "completed" | "failed";
      progress?: number;
      processedRows?: number;
      totalRows?: number;
      error?: string;
    };
    const latestExports = event.status === "completed" ? refreshDistrictJobExports(job) : job.exports;
    updateDistrictJob(jobId, {
      status: event.status ?? job.status,
      progress: typeof event.progress === "number" ? event.progress : job.progress,
      processedRows: typeof event.processedRows === "number" ? event.processedRows : job.processedRows,
      totalRows: typeof event.totalRows === "number" ? event.totalRows : job.totalRows,
      progressMessage: progressMessage(event.status ?? job.status, event.processedRows, event.totalRows),
      errorMessage: event.error ?? job.errorMessage,
      exports: latestExports,
      completedAt: event.status === "completed" || event.status === "failed" ? new Date().toISOString() : job.completedAt,
    });
  } catch {
    return;
  }
}

export function runDistrictClassificationJob(jobId: string): void {
  if (runningJobs.size > 0) {
    updateDistrictJob(jobId, {
      status: "failed",
      progressMessage: "Classification was not started.",
      errorMessage: "Another district classification job is already running.",
      completedAt: new Date().toISOString(),
    });
    return;
  }
  if (activeRunLock()) {
    updateDistrictJob(jobId, {
      status: "failed",
      progressMessage: "Classification was not started.",
      errorMessage: "Another district classification worker is still running. Wait for it to finish before starting a new one.",
      completedAt: new Date().toISOString(),
    });
    return;
  }
  runningJobs.add(jobId);
  writeRunLock(jobId);

  void (async () => {
    const startedAt = new Date().toISOString();

    try {
      const job = getDistrictJob(jobId);
      if (!job) throw new Error("District classification job not found.");
      if (job.status !== "queued") {
        removeRunLock(jobId);
        return;
      }

      validateDistrictClassificationEnvironment(job.layers);
      const scriptPath = resolveEngineCli();

      fs.mkdirSync(job.outputDir, { recursive: true });
      updateDistrictJob(jobId, {
        status: "processing",
        progressMessage: "Python district classifier started.",
        progress: 0,
        startedAt,
        errorMessage: null,
      });

      const python = resolvePythonExecutable();
      const args = buildArgs(scriptPath, jobId);

      const result = await new Promise<{
        exitCode: number | null;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        let stdout = "";
        let stderr = "";

        const child = spawn(python, args, {
          cwd: process.cwd(),
          env: process.env,
          shell: false,
        });
        if (child.pid) {
          writeRunLock(jobId, child.pid);
        }

        child.stdout?.on("data", (chunk: Buffer) => {
          stdout = appendCapturedText(stdout, chunk);
          for (const line of chunk.toString("utf-8").split(/\r?\n/)) {
            handleEventLine(jobId, line.trim());
          }
          updateDistrictJob(jobId, {
            stdout,
          });
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          stderr = appendCapturedText(stderr, chunk);
          updateDistrictJob(jobId, { stderr });
        });

        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
        child.on("error", (err) =>
          resolve({
            exitCode: 1,
            stdout,
            stderr: appendCapturedText(stderr, Buffer.from(`\n[spawn error] ${err.message}`)),
          })
        );
      });

      const latest = getDistrictJob(jobId);
      if (!latest) throw new Error("District classification job disappeared while running.");

      if (result.exitCode === 0) {
        const exports = refreshDistrictJobExports(latest);
        updateDistrictJob(jobId, {
          status: "completed",
          progress: 100,
          progressMessage: `Classification complete. ${exports.length} export file${exports.length === 1 ? "" : "s"} ready.`,
          stdout: result.stdout,
          stderr: result.stderr,
          exports,
          completedAt: new Date().toISOString(),
        });
        return;
      }

      updateDistrictJob(jobId, {
        status: "failed",
        progressMessage: "Classification failed.",
        errorMessage:
          latest.errorMessage ||
          result.stderr.trim() ||
          result.stdout.trim() ||
          `Python classifier exited with code ${result.exitCode ?? "unknown"}.`,
        stdout: result.stdout,
        stderr: result.stderr,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateDistrictJob(jobId, {
        status: "failed",
        progressMessage: "Classification failed before the worker completed.",
        errorMessage: message,
        completedAt: new Date().toISOString(),
      });
    } finally {
      runningJobs.delete(jobId);
      removeRunLock(jobId);
    }
  })();
}
