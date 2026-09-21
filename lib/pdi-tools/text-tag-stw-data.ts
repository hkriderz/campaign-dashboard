import { classifyTextContactTag, TEXT_SUPPORT_ANSWER_ORDER } from "@/lib/texting-tag-labels";
import type { StwData } from "@/lib/pdi-tools/types";
import type { SurveyResultRow } from "@/lib/pdi-tools/sync/types";
import { TEXT_CANDIDATE_TAG_ID, TEXT_MAPPING_SURVEY_NAME } from "@/lib/pdi-tools/channel";

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

function supportStatusRank(answer: string): number {
  const i = TEXT_SUPPORT_ANSWER_ORDER.indexOf(answer);
  return i === -1 ? TEXT_SUPPORT_ANSWER_ORDER.length : i;
}

export type TextTagCatalogRow = {
  campaignName: string;
  tagName: string;
};

function questionsFromTagNames(tagNames: string[]): Record<string, string[]> {
  const support = new Set<string>();
  const moved = new Set<string>();

  for (const raw of uniqueTrimmed(tagNames)) {
    const classified = classifyTextContactTag(raw, TEXT_CANDIDATE_TAG_ID);
    if (classified.kind === "support") support.add(classified.answer);
    else if (classified.kind === "moved") moved.add(classified.answer);
  }

  const supportList = [...support].sort((a, b) => {
    const ra = supportStatusRank(a);
    const rb = supportStatusRank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
  const movedList = [...moved].sort((a, b) => a.localeCompare(b));

  const questions: Record<string, string[]> = {};
  if (supportList.length > 0) questions.Support = supportList;
  if (movedList.length > 0) questions.Moved = movedList;
  return questions;
}

/** Distinct Nithya Support/Moved statuses as one synthetic survey (mapping identity). */
export function buildNithyaTextStwData(tagNames: string[]): StwData {
  const questions = questionsFromTagNames(tagNames);
  return { [TEXT_MAPPING_SURVEY_NAME]: questions };
}

export function hasMappableTextQuestions(questions: Record<string, string[]> | undefined): boolean {
  return Object.keys(questions ?? {}).length > 0;
}

/** One sidebar entry per text campaign; mapping keys still use the synthetic survey. */
export function buildNithyaTextCampaignStwData(rows: TextTagCatalogRow[]): StwData {
  const tagsByCampaign = new Map<string, string[]>();
  for (const row of rows) {
    const campaignName = row.campaignName.trim();
    if (!campaignName) continue;
    const list = tagsByCampaign.get(campaignName) ?? [];
    const tagName = row.tagName.trim();
    if (tagName) list.push(tagName);
    tagsByCampaign.set(campaignName, list);
  }

  const data: StwData = {};
  for (const [campaignName, tagNames] of tagsByCampaign) {
    data[campaignName] = questionsFromTagNames(tagNames);
  }
  return data;
}

export function collectAnswersAcrossSurveys(stwData: StwData, questionName: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const questions of Object.values(stwData)) {
    for (const answer of questions[questionName] ?? []) {
      if (seen.has(answer)) continue;
      seen.add(answer);
      out.push(answer);
    }
  }
  return out;
}

export function normalizeTextSyncRow(row: {
  answer_value?: string;
  pdi_id?: string;
  call_time?: SurveyResultRow["call_time"];
  campaign_name?: string;
}): SurveyResultRow | null {
  const raw = String(row.answer_value ?? "").trim();
  const pdiId = String(row.pdi_id ?? "").trim();
  if (!raw || !pdiId) return null;

  const classified = classifyTextContactTag(raw, TEXT_CANDIDATE_TAG_ID);
  if (classified.kind === "other") return null;

  const campaignName = String(row.campaign_name ?? "").trim() || TEXT_MAPPING_SURVEY_NAME;

  return {
    campaign_name: campaignName,
    question_name: classified.question,
    answer_value: classified.answer,
    pdi_id: pdiId,
    call_time: row.call_time,
    _source_answer: raw,
  };
}
