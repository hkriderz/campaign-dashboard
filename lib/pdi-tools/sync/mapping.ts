import * as fs from "fs";
import * as path from "path";
import type { MappingOutput } from "@/lib/pdi-tools/types";
import { listMappingFiles, resolveMappingFilePathById } from "@/lib/pdi-tools/mapping-files";
import { resolvePdiMappingsDir } from "@/lib/pdi-tools/sync-working-dir";

export type MappingMaps = {
  mapping: MappingOutput;
  mappingFilePath: string;
  questionMap: Map<string, string>;
  answerMap: Map<string, string>;
  codeMap: Map<string, string>;
  flagIdToCode: Map<string, string>;
};

function mapKey(parts: string[]): string {
  return parts.join("\0");
}

export function buildMappingMaps(mapping: MappingOutput, mappingFilePath: string): MappingMaps {
  const questionMap = new Map<string, string>();
  for (const q of mapping.questionMappings) {
    questionMap.set(mapKey([q.surveyName.trim(), q.stwQuestionName.trim()]), q.pdiQuestionId);
  }

  const answerMap = new Map<string, string>();
  for (const a of mapping.answerMappings) {
    answerMap.set(
      mapKey([a.surveyName.trim(), a.stwQuestionName.trim(), a.stwAnswerValue.trim()]),
      a.pdiFlagId
    );
  }

  const codeMap = new Map<string, string>();
  const flagIdToCode = new Map<string, string>();
  for (const f of mapping.flagRegistry) {
    codeMap.set(f.code.trim().toUpperCase(), f.flagId);
    flagIdToCode.set(f.flagId, f.code.trim().toUpperCase());
  }
  for (const a of mapping.answerMappings) {
    flagIdToCode.set(a.pdiFlagId, a.pdiFlagCode.trim().toUpperCase());
  }

  return { mapping, mappingFilePath, questionMap, answerMap, codeMap, flagIdToCode };
}

export function resolveAutoMappingPath(): string {
  const mappingsDir = resolvePdiMappingsDir();
  if (!fs.existsSync(mappingsDir)) {
    throw new Error(
      `No mapping file in pdi-mappings (${mappingsDir}). Export from the Mapper or upload a file in the Syncer.`
    );
  }

  const candidates = fs
    .readdirSync(mappingsDir)
    .filter((n) => n.toLowerCase().endsWith(".json") && n.toLowerCase().includes("stw_pdi_mapping"))
    .map((name) => {
      const absolutePath = path.join(mappingsDir, name);
      const stat = fs.statSync(absolutePath);
      return { absolutePath, mtime: stat.mtimeMs };
    })
    .filter((c) => fs.statSync(c.absolutePath).isFile());

  if (candidates.length === 0) {
    throw new Error(
      "No mapping files found matching stw_pdi_mapping_*.json in pdi-mappings."
    );
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]!.absolutePath;
}

export function loadMappingForSync(mappingFileId: string): MappingMaps {
  let mappingPath: string;
  if (!mappingFileId || mappingFileId === "auto") {
    mappingPath = resolveAutoMappingPath();
  } else {
    mappingPath = resolveMappingFilePathById(mappingFileId);
  }

  const raw = fs.readFileSync(mappingPath, "utf-8");
  const mapping = JSON.parse(raw) as MappingOutput;
  if (!mapping.questionMappings?.length || !mapping.answerMappings?.length) {
    throw new Error("Mapping file must include questionMappings and answerMappings.");
  }

  return buildMappingMaps(mapping, mappingPath);
}

/** Newest mapping anywhere (working dir + uploads) — for UI hints only. */
export function newestMappingFromCatalog(): string | null {
  const { files } = listMappingFiles();
  return files[0]?.absolutePath ?? null;
}

export function getFlag(
  maps: MappingMaps,
  survey: string,
  question: string,
  answer: string
): string | undefined {
  const fromAnswer = maps.answerMap.get(mapKey([survey, question, answer]));
  if (fromAnswer) return fromAnswer;
  return maps.codeMap.get(answer.toUpperCase());
}

export function getFlagStrict(
  maps: MappingMaps,
  survey: string,
  question: string,
  answer: string
): string | undefined {
  return maps.answerMap.get(mapKey([survey, question, answer]));
}

export function getQuestionId(maps: MappingMaps, survey: string, question: string): string | undefined {
  return maps.questionMap.get(mapKey([survey, question]));
}
