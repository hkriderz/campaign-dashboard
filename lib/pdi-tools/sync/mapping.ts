import * as fs from "fs";
import * as path from "path";
import type { MappingOutput } from "@/lib/pdi-tools/types";
import { listMappingFiles, resolveMappingFilePathById, validateMappingOutput } from "@/lib/pdi-tools/mapping-files";
import { resolvePdiMappingsDir } from "@/lib/pdi-tools/sync-working-dir";
import { isMappingFileForChannel, mappingFilePrefix, type PdiSyncChannel } from "@/lib/pdi-tools/channel";

export type MappingMaps = {
  mapping: MappingOutput;
  mappingFilePath: string;
  questionMap: Map<string, string>;
  answerMap: Map<string, string>;
  codeMap: Map<string, string>;
  flagIdToCode: Map<string, string>;
  /** Uppercased flag code or flag id → PDI question ids that post that flag. */
  flagQuestionIds: Map<string, string[]>;
  /** Uppercased flag code or flag id → PDI catalog question count. */
  flagCatalogCounts: Map<string, number>;
  /** PDI question id → STW question labels. */
  questionLabels: Map<string, string[]>;
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

  const flagQuestionSets = new Map<string, Set<string>>();
  const flagCatalogCounts = new Map<string, number>();
  const questionLabelSets = new Map<string, Set<string>>();
  for (const flag of mapping.flagRegistry) {
    const count = flag.usedInNQuestions ?? 0;
    const code = flag.code.trim().toUpperCase();
    const flagId = flag.flagId.trim().toUpperCase();
    if (code) flagCatalogCounts.set(code, Math.max(flagCatalogCounts.get(code) ?? 0, count));
    if (flagId) flagCatalogCounts.set(flagId, Math.max(flagCatalogCounts.get(flagId) ?? 0, count));
  }
  const addFlagQuestion = (flagKey: string, questionId: string) => {
    const key = flagKey.trim().toUpperCase();
    const qid = questionId.trim();
    if (!key || !qid) return;
    const set = flagQuestionSets.get(key) ?? new Set<string>();
    set.add(qid);
    flagQuestionSets.set(key, set);
  };
  const addLabel = (questionId: string, label: string) => {
    const qid = questionId.trim();
    const text = label.trim();
    if (!qid || !text) return;
    const set = questionLabelSets.get(qid) ?? new Set<string>();
    set.add(text);
    questionLabelSets.set(qid, set);
  };
  for (const q of mapping.questionMappings) addLabel(q.pdiQuestionId, q.stwQuestionName);
  for (const a of mapping.answerMappings) {
    addFlagQuestion(a.pdiFlagId, a.pdiQuestionId);
    addFlagQuestion(a.pdiFlagCode, a.pdiQuestionId);
    addLabel(a.pdiQuestionId, a.stwQuestionName);
  }
  const flagQuestionIds = new Map([...flagQuestionSets].map(([key, ids]) => [key, [...ids]]));
  const questionLabels = new Map([...questionLabelSets].map(([key, labels]) => [key, [...labels]]));

  return {
    mapping,
    mappingFilePath,
    questionMap,
    answerMap,
    codeMap,
    flagIdToCode,
    flagQuestionIds,
    flagCatalogCounts,
    questionLabels,
  };
}

export function resolveAutoMappingPath(channel: PdiSyncChannel = "dialer"): string {
  const mappingsDir = resolvePdiMappingsDir();
  if (!fs.existsSync(mappingsDir)) {
    throw new Error(
      `No mapping file in pdi-mappings (${mappingsDir}). Export from the Mapper or upload a file in the Syncer.`
    );
  }

  const prefix = mappingFilePrefix(channel);
  const candidates = fs
    .readdirSync(mappingsDir)
    .filter((n) => isMappingFileForChannel(n, channel))
    .map((name) => {
      const absolutePath = path.join(mappingsDir, name);
      const stat = fs.statSync(absolutePath);
      return { absolutePath, mtime: stat.mtimeMs };
    })
    .filter((c) => fs.statSync(c.absolutePath).isFile());

  if (candidates.length === 0) {
    throw new Error(`No mapping files found matching ${prefix}_*.json in pdi-mappings.`);
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]!.absolutePath;
}

export function loadMappingForSync(
  mappingFileId: string,
  channel: PdiSyncChannel = "dialer"
): MappingMaps {
  let mappingPath: string;
  if (!mappingFileId || mappingFileId === "auto") {
    mappingPath = resolveAutoMappingPath(channel);
  } else {
    mappingPath = resolveMappingFilePathById(mappingFileId, channel);
  }

  const raw = fs.readFileSync(mappingPath, "utf-8");
  const mapping = JSON.parse(raw) as MappingOutput;
  if (!mapping.questionMappings?.length || !mapping.answerMappings?.length) {
    throw new Error("Mapping file must include questionMappings and answerMappings.");
  }
  const validationErrors = validateMappingOutput(mapping);
  if (validationErrors.length > 0) {
    throw new Error(`Mapping file failed validation:\n${validationErrors.slice(0, 12).join("\n")}`);
  }

  return buildMappingMaps(mapping, mappingPath);
}

/** Newest mapping anywhere (working dir + uploads) — for UI hints only. */
export function newestMappingFromCatalog(channel: PdiSyncChannel = "dialer"): string | null {
  const { files } = listMappingFiles(channel);
  return files[0]?.absolutePath ?? null;
}

/** Diagnostic helper only: falls back to treating raw answer text as a flag code. Do not use for sync payloads. */
export function getFlagUnsafe(
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
  answer: string,
  fallbackSurvey?: string
): string | undefined {
  const hit = maps.answerMap.get(mapKey([survey, question, answer]));
  if (hit) return hit;
  const fallback = fallbackSurvey?.trim();
  if (!fallback || fallback === survey) return undefined;
  return maps.answerMap.get(mapKey([fallback, question, answer]));
}

/** First explicit answer mapping among `answers`, then the fallback survey. */
export function getFlagStrictAny(
  maps: MappingMaps,
  survey: string,
  question: string,
  answers: string[],
  fallbackSurvey?: string
): string | undefined {
  const seen = new Set<string>();
  for (const raw of answers) {
    const answer = raw.trim();
    if (!answer || seen.has(answer)) continue;
    seen.add(answer);
    const hit = getFlagStrict(maps, survey, question, answer, fallbackSurvey);
    if (hit) return hit;
  }
  return undefined;
}

export function listMappedAnswers(
  maps: MappingMaps,
  survey: string,
  question: string
): Array<{ answer: string; flagId: string }> {
  const prefix = mapKey([survey, question, ""]);
  const out: Array<{ answer: string; flagId: string }> = [];
  for (const [key, flagId] of maps.answerMap) {
    if (!key.startsWith(prefix)) continue;
    out.push({ answer: key.slice(prefix.length), flagId });
  }
  return out;
}

export function getQuestionId(
  maps: MappingMaps,
  survey: string,
  question: string,
  fallbackSurvey?: string
): string | undefined {
  const hit = maps.questionMap.get(mapKey([survey, question]));
  if (hit) return hit;
  const fallback = fallbackSurvey?.trim();
  if (!fallback || fallback === survey) return undefined;
  return maps.questionMap.get(mapKey([fallback, question]));
}
