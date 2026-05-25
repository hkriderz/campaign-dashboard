import "server-only";

import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  DEFAULT_DISTRICT_COLUMN_MAPPING,
  type DistrictClassifierJob,
  type DistrictColumnMapping,
  type DistrictExportFile,
  type DistrictJobStatus,
  type DistrictLayerId,
  type DistrictReviewRow,
  type DistrictTargetSelection,
} from "./types";

const DATA_ROOT = path.join(process.cwd(), "data", "district-classifier");
const JOBS_DIR = path.join(DATA_ROOT, "jobs");
const UPLOADS_DIR = path.join(DATA_ROOT, "uploads");
const EXPORTS_DIR = path.join(DATA_ROOT, "exports");
const DB_PATH = process.env.DISTRICT_ENGINE_DB_PATH
  ? path.resolve(process.env.DISTRICT_ENGINE_DB_PATH)
  : path.join(DATA_ROOT, "district-engine-v2.sqlite");
const STALE_PROCESSING_MS = 5 * 60 * 1000;
const STALE_QUEUED_MS = 90 * 1000;

type CreateDistrictJobInput = {
  originalFileName: string;
  fileBuffer: Buffer;
  layers: DistrictLayerId[];
  targetSelection: DistrictTargetSelection;
  compareHistorical: boolean;
  columnMapping: Partial<DistrictColumnMapping>;
};

type DistrictJobPatch = Partial<
  Pick<
    DistrictClassifierJob,
    | "status"
    | "progressMessage"
    | "errorMessage"
    | "stdout"
    | "stderr"
    | "exports"
    | "progress"
    | "processedRows"
    | "totalRows"
    | "startedAt"
    | "completedAt"
  >
>;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureStoreDirs(): void {
  ensureDir(JOBS_DIR);
  ensureDir(UPLOADS_DIR);
  ensureDir(EXPORTS_DIR);
}

function safeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[^a-z0-9._-]+/gi, "-");
  return base || "upload.csv";
}

function jobPath(jobId: string): string {
  const safe = jobId.replace(/[^a-z0-9_-]/gi, "");
  return path.join(JOBS_DIR, `${safe}.json`);
}

function normalizeColumnMapping(mapping: Partial<DistrictColumnMapping>): DistrictColumnMapping {
  return {
    addressCol: mapping.addressCol?.trim() || DEFAULT_DISTRICT_COLUMN_MAPPING.addressCol,
    cityCol: mapping.cityCol?.trim() || DEFAULT_DISTRICT_COLUMN_MAPPING.cityCol,
    stateCol: mapping.stateCol?.trim() || DEFAULT_DISTRICT_COLUMN_MAPPING.stateCol,
    zipCol: mapping.zipCol?.trim() || DEFAULT_DISTRICT_COLUMN_MAPPING.zipCol,
    streetNumCol: mapping.streetNumCol?.trim() || DEFAULT_DISTRICT_COLUMN_MAPPING.streetNumCol,
    streetNameCol: mapping.streetNameCol?.trim() || DEFAULT_DISTRICT_COLUMN_MAPPING.streetNameCol,
    aptCol: mapping.aptCol?.trim() || DEFAULT_DISTRICT_COLUMN_MAPPING.aptCol,
  };
}

function writeJob(job: DistrictClassifierJob): DistrictClassifierJob {
  ensureStoreDirs();
  fs.writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2), "utf-8");
  return job;
}

function countCsvRows(filePath: string): number | null {
  try {
    const text = fs.readFileSync(filePath, "utf-8");
    if (!text.trim()) return 0;

    let records = 0;
    let inQuotes = false;
    let sawContent = false;

    for (let index = 0; index < text.length; index++) {
      const ch = text[index];
      sawContent = sawContent || !/\s/.test(ch);

      if (ch === "\"") {
        if (inQuotes && text[index + 1] === "\"") {
          index++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && (ch === "\n" || ch === "\r")) {
        records++;
        sawContent = false;
        if (ch === "\r" && text[index + 1] === "\n") {
          index++;
        }
      }
    }

    if (sawContent) records++;
    return Math.max(0, records - 1);
  } catch {
    return null;
  }
}

function classifyExportKind(fileName: string): DistrictExportFile["kind"] {
  if (fileName.includes("inferred_districts")) return "inferred_districts";
  if (fileName.includes("inferred-districts")) return "inferred_districts";
  if (fileName.includes("other_districts")) return "other_districts";
  if (fileName.includes("other-districts")) return "other_districts";
  if (fileName.includes("outside_layer")) return "outside_layer";
  if (fileName.includes("outside-layer")) return "outside_layer";
  if (fileName.includes("outside-target")) return "outside_target";
  if (fileName.includes("outside_target")) return "outside_target";
  if (fileName.includes("geocode-failed")) return "geocode_failed";
  if (fileName.includes("geocode_failed")) return "geocode_failed";
  if (fileName.includes("manual_review")) return "manual_review";
  if (/matched_(cd|ad)\d+\.csv$/i.test(fileName) || /-(cd|ad)\d+\.csv$/i.test(fileName)) return "matched";
  return "other";
}

function safeLayerIds(layers: DistrictLayerId[]): DistrictLayerId[] {
  const valid = new Set<DistrictLayerId>(["la-city-council", "ca-state-assembly"]);
  const out = (layers ?? []).filter((layer): layer is DistrictLayerId => valid.has(layer));
  return out.length ? out : ["la-city-council"];
}

function hydrateDistrictJob(raw: Partial<DistrictClassifierJob>): DistrictClassifierJob {
  const id = raw.id ?? "unknown";
  const outputDir = raw.outputDir ?? path.join(EXPORTS_DIR, id);
  const legacyPresets = (raw as Partial<DistrictClassifierJob> & { presets?: string[] }).presets ?? [];
  const legacyLayers = legacyPresets.map((preset) =>
    preset === "ca-state-assembly-67" ? "ca-state-assembly" : preset
  ) as DistrictLayerId[];

  return {
    id,
    status: raw.status ?? "failed",
    originalFileName: raw.originalFileName ?? "Unknown upload",
    inputPath: raw.inputPath ?? "",
    outputDir,
    dbPath: raw.dbPath ?? DB_PATH,
    layers: safeLayerIds(raw.layers ?? legacyLayers),
    targetSelection: raw.targetSelection ?? {},
    compareHistorical: raw.compareHistorical ?? true,
    columnMapping: normalizeColumnMapping(raw.columnMapping ?? {}),
    progress: raw.progress ?? (raw.status === "completed" ? 100 : 0),
    processedRows: raw.processedRows ?? 0,
    totalRows: raw.totalRows ?? null,
    progressMessage: raw.progressMessage ?? "Legacy district classifier job.",
    errorMessage: raw.errorMessage ?? null,
    stdout: raw.stdout ?? "",
    stderr: raw.stderr ?? "",
    exports: raw.exports ?? [],
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString(),
    startedAt: raw.startedAt ?? null,
    completedAt: raw.completedAt ?? null,
  };
}

export function listDistrictJobs(): DistrictClassifierJob[] {
  ensureStoreDirs();
  return fs
    .readdirSync(JOBS_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      try {
        return hydrateDistrictJob(JSON.parse(
          fs.readFileSync(path.join(JOBS_DIR, fileName), "utf-8")
        ) as Partial<DistrictClassifierJob>);
      } catch {
        return null;
      }
    })
    .filter((job): job is DistrictClassifierJob => job !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getDistrictJob(jobId: string): DistrictClassifierJob | null {
  ensureStoreDirs();
  const filePath = jobPath(jobId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return hydrateDistrictJob(JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<DistrictClassifierJob>);
  } catch {
    return null;
  }
}

export function createDistrictJob(input: CreateDistrictJobInput): DistrictClassifierJob {
  ensureStoreDirs();

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const uploadDir = path.join(UPLOADS_DIR, id);
  const outputDir = path.join(EXPORTS_DIR, id);
  ensureDir(uploadDir);
  ensureDir(outputDir);

  const fileName = safeFileName(input.originalFileName);
  const inputPath = path.join(uploadDir, fileName);
  fs.writeFileSync(inputPath, input.fileBuffer);

  const job: DistrictClassifierJob = {
    id,
    status: "queued",
    originalFileName: input.originalFileName,
    inputPath,
    outputDir,
    dbPath: DB_PATH,
    layers: safeLayerIds(input.layers),
    targetSelection: input.targetSelection,
    compareHistorical: input.compareHistorical,
    columnMapping: normalizeColumnMapping(input.columnMapping),
    progress: 0,
    processedRows: 0,
    totalRows: null,
    progressMessage: "Upload saved. Waiting for classifier to start.",
    errorMessage: null,
    stdout: "",
    stderr: "",
    exports: [],
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  };

  return writeJob(job);
}

export function updateDistrictJob(jobId: string, patch: DistrictJobPatch): DistrictClassifierJob | null {
  const current = getDistrictJob(jobId);
  if (!current) return null;
  return writeJob({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

export function markStaleDistrictJobsFailed(now = Date.now()): DistrictClassifierJob[] {
  const staleJobs = listDistrictJobs().filter((job) => {
    if (job.status !== "queued" && job.status !== "processing") return false;
    const updatedAt = Date.parse(job.updatedAt);
    if (!Number.isFinite(updatedAt)) return false;
    const staleAfter = job.status === "queued" ? STALE_QUEUED_MS : STALE_PROCESSING_MS;
    return now - updatedAt > staleAfter;
  });

  return staleJobs
    .map((job) =>
      updateDistrictJob(job.id, {
        status: "failed",
        progressMessage:
          job.status === "queued"
            ? "Classification never started."
            : "Classification worker stopped before reporting progress.",
        errorMessage:
          job.status === "queued"
            ? "This queued job became stale before the worker started. This can happen if the server reloads or prerequisites fail during startup. Start a new job to rerun it."
            : "The classifier worker became stale. This can happen during local dev reloads or a stalled geocoder request. Start a new job to rerun it.",
        completedAt: new Date(now).toISOString(),
      })
    )
    .filter((job): job is DistrictClassifierJob => job !== null);
}

export function setDistrictJobStatus(
  jobId: string,
  status: DistrictJobStatus,
  progressMessage: string
): DistrictClassifierJob | null {
  return updateDistrictJob(jobId, { status, progressMessage });
}

export function refreshDistrictJobExports(job: DistrictClassifierJob): DistrictExportFile[] {
  ensureDir(job.outputDir);
  return fs
    .readdirSync(job.outputDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".csv"))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => {
      const filePath = path.join(job.outputDir, fileName);
      return {
        fileName,
        downloadUrl: `/api/district-classifier/jobs/${encodeURIComponent(job.id)}/exports/${encodeURIComponent(
          fileName
        )}`,
        rowCount: countCsvRows(filePath),
        kind: classifyExportKind(fileName),
      };
    });
}

export function resolveDistrictExportPath(jobId: string, fileName: string): string | null {
  const job = getDistrictJob(jobId);
  if (!job) return null;
  const safe = path.basename(fileName);
  const resolved = path.resolve(job.outputDir, safe);
  const outputRoot = path.resolve(job.outputDir);
  if (!resolved.startsWith(outputRoot + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (line[i + 1] === "\"") {
          current += "\"";
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === "\"") {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function listDistrictReviewRows(jobId: string, limit = 200): DistrictReviewRow[] {
  const filePath = resolveDistrictExportPath(jobId, "manual_review.csv");
  if (!filePath) return [];
  const text = fs.readFileSync(filePath, "utf-8").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0] ?? "");
  return lines.slice(1, limit + 1).map((line, index) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });
    return {
      rowNumber: index + 1,
      name: row.Name || row.name || row["First Name"] || row["Full Name"],
      address: row.Address || row.address || row._normalized_address,
      zip: row.Zip || row.zip || row._zip,
      district: row._district_label || row._district,
      confidence: row._confidence,
      method: row._match_method,
      reason: row._review_reason,
    };
  });
}
