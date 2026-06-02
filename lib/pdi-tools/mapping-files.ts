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

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function questionKey(surveyName: string, stwQuestionName: string): string {
  return `${surveyName.trim()}\0${stwQuestionName.trim()}`;
}

function answerKey(surveyName: string, stwQuestionName: string, stwAnswerValue: string): string {
  return `${questionKey(surveyName, stwQuestionName)}\0${stwAnswerValue.trim()}`;
}

export function validateMappingOutput(mapping: MappingOutput): string[] {
  const errors: string[] = [];
  const questionByKey = new Map<string, { pdiQuestionId: string; index: number }>();
  const answerByKey = new Map<
    string,
    { pdiQuestionId: string; pdiFlagId: string; pdiFlagCode: string; index: number }
  >();

  if (!Array.isArray(mapping.questionMappings)) {
    errors.push("questionMappings must be an array.");
  }
  if (!Array.isArray(mapping.answerMappings)) {
    errors.push("answerMappings must be an array.");
  }
  if (!Array.isArray(mapping.flagRegistry)) {
    errors.push("flagRegistry must be an array.");
  }
  if (errors.length > 0) return errors;

  mapping.questionMappings.forEach((entry, index) => {
    const context = `questionMappings[${index}]`;
    if (!nonEmptyString(entry.surveyName)) errors.push(`${context}.surveyName is required.`);
    if (!nonEmptyString(entry.stwQuestionName)) errors.push(`${context}.stwQuestionName is required.`);
    if (!nonEmptyString(entry.pdiQuestionId)) errors.push(`${context}.pdiQuestionId is required.`);
    if (!nonEmptyString(entry.surveyName) || !nonEmptyString(entry.stwQuestionName) || !nonEmptyString(entry.pdiQuestionId)) {
      return;
    }
    const key = questionKey(entry.surveyName, entry.stwQuestionName);
    const existing = questionByKey.get(key);
    if (existing && existing.pdiQuestionId !== entry.pdiQuestionId.trim()) {
      errors.push(
        `${context} conflicts with questionMappings[${existing.index}] for the same STW question (${existing.pdiQuestionId} vs ${entry.pdiQuestionId}).`
      );
      return;
    }
    questionByKey.set(key, { pdiQuestionId: entry.pdiQuestionId.trim(), index });
  });

  mapping.answerMappings.forEach((entry, index) => {
    const context = `answerMappings[${index}]`;
    if (!nonEmptyString(entry.surveyName)) errors.push(`${context}.surveyName is required.`);
    if (!nonEmptyString(entry.stwQuestionName)) errors.push(`${context}.stwQuestionName is required.`);
    if (!nonEmptyString(entry.stwAnswerValue)) errors.push(`${context}.stwAnswerValue is required.`);
    if (!nonEmptyString(entry.pdiQuestionId)) errors.push(`${context}.pdiQuestionId is required.`);
    if (!nonEmptyString(entry.pdiAnswerOptionId)) errors.push(`${context}.pdiAnswerOptionId is required.`);
    if (!nonEmptyString(entry.pdiFlagId)) errors.push(`${context}.pdiFlagId is required.`);
    if (!nonEmptyString(entry.pdiFlagCode)) errors.push(`${context}.pdiFlagCode is required.`);
    if (
      !nonEmptyString(entry.surveyName) ||
      !nonEmptyString(entry.stwQuestionName) ||
      !nonEmptyString(entry.stwAnswerValue) ||
      !nonEmptyString(entry.pdiQuestionId) ||
      !nonEmptyString(entry.pdiFlagId) ||
      !nonEmptyString(entry.pdiFlagCode)
    ) {
      return;
    }

    const qKey = questionKey(entry.surveyName, entry.stwQuestionName);
    const questionMapping = questionByKey.get(qKey);
    if (!questionMapping) {
      errors.push(`${context} has no matching question mapping for "${entry.surveyName}" / "${entry.stwQuestionName}".`);
    } else if (questionMapping.pdiQuestionId !== entry.pdiQuestionId.trim()) {
      errors.push(
        `${context} is stale: answer maps to PDI question ${entry.pdiQuestionId}, but the question maps to ${questionMapping.pdiQuestionId}.`
      );
    }

    const key = answerKey(entry.surveyName, entry.stwQuestionName, entry.stwAnswerValue);
    const existing = answerByKey.get(key);
    if (
      existing &&
      (existing.pdiQuestionId !== entry.pdiQuestionId.trim() ||
        existing.pdiFlagId !== entry.pdiFlagId.trim() ||
        existing.pdiFlagCode !== entry.pdiFlagCode.trim().toUpperCase())
    ) {
      errors.push(`${context} conflicts with answerMappings[${existing.index}] for the same STW answer.`);
      return;
    }
    answerByKey.set(key, {
      pdiQuestionId: entry.pdiQuestionId.trim(),
      pdiFlagId: entry.pdiFlagId.trim(),
      pdiFlagCode: entry.pdiFlagCode.trim().toUpperCase(),
      index,
    });
  });

  return errors;
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
  const errors = validateMappingOutput(o as unknown as MappingOutput);
  if (errors.length > 0) {
    throw new Error(`Mapping file failed validation:\n${errors.slice(0, 12).join("\n")}`);
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
