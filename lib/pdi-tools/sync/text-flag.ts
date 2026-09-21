import { classifyTextContactTag } from "@/lib/texting-tag-labels";
import { TEXT_CANDIDATE_TAG_ID } from "@/lib/pdi-tools/channel";
import {
  getFlagStrict,
  getFlagStrictAny,
  listMappedAnswers,
  type MappingMaps,
} from "./mapping";
import type { SurveyResultRow } from "./types";

function uniqueTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Look up a text-sync flag the way phonebank looks up a support status:
 * classified answer, then the raw STW tag, then any mapped tag with the same status.
 */
export function resolveTextMappedFlagId(
  maps: MappingMaps,
  survey: string,
  question: string,
  classifiedAnswer: string,
  rawTag: string,
  fallbackSurvey?: string
): string | undefined {
  const classified = classifiedAnswer.trim();
  const direct = getFlagStrictAny(maps, survey, question, [classified, rawTag], fallbackSurvey);
  if (direct) return direct;
  if (!classified) return undefined;

  const surveys = uniqueTrimmed([survey, fallbackSurvey ?? ""]);
  for (const mappedSurvey of surveys) {
    for (const mapped of listMappedAnswers(maps, mappedSurvey, question)) {
      if (mapped.answer === classified) return mapped.flagId;
      const mappedClassified = classifyTextContactTag(mapped.answer, TEXT_CANDIDATE_TAG_ID);
      if (
        mappedClassified.kind !== "other" &&
        mappedClassified.question === question &&
        mappedClassified.answer === classified
      ) {
        return mapped.flagId;
      }
    }
  }
  return undefined;
}

export function resolveSyncFlagId(
  maps: MappingMaps,
  row: SurveyResultRow,
  survey: string,
  question: string,
  answer: string,
  fallbackSurvey?: string
): string | undefined {
  if (row._source_answer !== undefined) {
    return resolveTextMappedFlagId(maps, survey, question, answer, row._source_answer, fallbackSurvey);
  }
  return getFlagStrict(maps, survey, question, answer, fallbackSurvey);
}
