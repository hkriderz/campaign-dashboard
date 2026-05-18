import * as fs from "fs";
import * as path from "path";
import type { MappingOutput } from "./types";
import {
  ensurePdiMappingsDir,
  migrateMappingFilesToMappingsDir,
  resolvePdiMappingsDir,
} from "./sync-working-dir";

export type MappingFileSource = "mappings";

export type MappingFileEntry = {
  id: string;
  fileName: string;
  source: MappingFileSource;
  absolutePath: string;
  modifiedAt: string;
  sizeBytes: number;
};

const MAPPING_GLOB_PREFIX = "stw_pdi_mapping";

function encodeId(fileName: string): string {
  return `mappings:${fileName}`;
}

/** Accepts `mappings:` and legacy `exports:` / `uploads:` / `working-dir:` ids. */
export function decodeMappingFileId(id: string): { fileName: string } | null {
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  const prefix = id.slice(0, idx);
  if (
    prefix !== "mappings" &&
    prefix !== "exports" &&
    prefix !== "uploads" &&
    prefix !== "working-dir"
  ) {
    return null;
  }
  const fileName = id.slice(idx + 1);
  if (!fileName || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    return null;
  }
  return { fileName };
}

function isMappingFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".json") && name.toLowerCase().includes(MAPPING_GLOB_PREFIX);
}

function scanDir(dir: string): MappingFileEntry[] {
  if (!fs.existsSync(dir)) return [];
  const entries: MappingFileEntry[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!isMappingFileName(name)) continue;
    const absolutePath = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    entries.push({
      id: encodeId(name),
      fileName: name,
      source: "mappings",
      absolutePath: path.resolve(absolutePath),
      modifiedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    });
  }
  return entries;
}

export function listMappingFiles(): {
  mappingsDir: string;
  /** @deprecated Use mappingsDir */
  exportsDir: string;
  workingDir: string;
  uploadsDir: string;
  files: MappingFileEntry[];
} {
  migrateMappingFilesToMappingsDir();
  const mappingsDir = ensurePdiMappingsDir();
  const files = scanDir(mappingsDir).sort(
    (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
  );

  return {
    mappingsDir,
    exportsDir: mappingsDir,
    workingDir: mappingsDir,
    uploadsDir: mappingsDir,
    files,
  };
}

export function resolveMappingFilePathById(id: string): string {
  const decoded = decodeMappingFileId(id);
  if (!decoded) {
    throw new Error("Invalid mapping file id.");
  }

  const baseDir = resolvePdiMappingsDir();
  const absolutePath = path.resolve(baseDir, decoded.fileName);
  const rel = path.relative(path.resolve(baseDir), absolutePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid mapping path.");
  }
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Mapping file not found: ${decoded.fileName}`);
  }
  return absolutePath;
}

export function assertValidMappingJsonContent(content: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Mapping file must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Mapping file must be a JSON object.");
  }
  const o = parsed as Record<string, unknown>;
  if (!Array.isArray(o.questionMappings) || !Array.isArray(o.answerMappings)) {
    throw new Error("Mapping file must include questionMappings and answerMappings arrays (schema v2).");
  }
}

function pickUniqueFileName(dir: string, preferredName: string): string {
  if (!fs.existsSync(path.join(dir, preferredName))) {
    return preferredName;
  }
  const base = preferredName.replace(/\.json$/i, "");
  let n = 2;
  while (fs.existsSync(path.join(dir, `${base}_${n}.json`))) {
    n += 1;
  }
  return `${base}_${n}.json`;
}

export function defaultMappingExportFileName(generatedIso?: string): string {
  const date = (generatedIso ?? new Date().toISOString()).slice(0, 10);
  return `stw_pdi_mapping_${date}.json`;
}

export function saveMappingExport(output: MappingOutput): MappingFileEntry {
  const content = JSON.stringify(output, null, 2);
  assertValidMappingJsonContent(content);

  const mappingsDir = ensurePdiMappingsDir();
  const preferred = defaultMappingExportFileName(output.generated);
  const fileName = pickUniqueFileName(mappingsDir, preferred);
  const absolutePath = path.join(mappingsDir, fileName);
  fs.writeFileSync(absolutePath, content, "utf-8");

  const stat = fs.statSync(absolutePath);
  return {
    id: encodeId(fileName),
    fileName,
    source: "mappings",
    absolutePath: path.resolve(absolutePath),
    modifiedAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
  };
}

export function saveUploadedMappingFile(originalName: string, content: string): MappingFileEntry {
  assertValidMappingJsonContent(content);

  const safeBase = path
    .basename(originalName)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+/, "");
  const preferred =
    safeBase && isMappingFileName(safeBase)
      ? safeBase
      : defaultMappingExportFileName();

  const mappingsDir = ensurePdiMappingsDir();
  const fileName = pickUniqueFileName(mappingsDir, preferred);
  const absolutePath = path.join(mappingsDir, fileName);
  fs.writeFileSync(absolutePath, content, "utf-8");

  const stat = fs.statSync(absolutePath);
  return {
    id: encodeId(fileName),
    fileName,
    source: "mappings",
    absolutePath: path.resolve(absolutePath),
    modifiedAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
  };
}
