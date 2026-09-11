import { isFinalResultQuestionName, isPollingQuestionName } from "./daily-aggregate-survey-rollup";
import { canonicalizePhonebankerName } from "./phonebanker-name";
import {
  classifiedAnswerIsFinalResultBucket,
  classifiedAnswerIsStrongSupport,
  isSplitStrongSupportQuestionName,
  isStrongSupportSurveyHit,
} from "./survey-answer-consolidation";
import {
  SCRIPT_BLOCK_EXCLUSION_REGEX_BODY,
  TRACI_SCRIPT_EXCLUSION_REGEX_BODY,
  isCanvassResultColumnQuestion,
  isTraciViolationQuestionName,
  normalizeSurveyTextForMatching,
  questionLooksLikeDisclaimer,
} from "./survey-i18n/rules";
import type {
  CallSurveyRowForFill,
  CampaignTag,
  SurveyScriptProfile,
  TagDailyCallerStat,
} from "./types";

const scriptBlockRe = new RegExp(SCRIPT_BLOCK_EXCLUSION_REGEX_BODY, "i");
const traciScriptRe = new RegExp(TRACI_SCRIPT_EXCLUSION_REGEX_BODY, "i");

const CANVASS_DISPOSITION_NAME_RE =
  /(contact\s*quality|canvass\s*result|canvass\s*disposition|call\s*disposition|contact\s*disposition)/i;

const CANDIDATE_TERM_ALIASES: Record<string, readonly string[]> = {
  nithya: ["raman"],
  faizah: ["malik"],
  eunisses: ["hernandez"],
};

export type CandidateTermSource = Pick<CampaignTag, "id"> &
  Partial<Pick<CampaignTag, "label" | "searchTerms" | "campaignCodes">>;

function escapeRegex(raw: string): string {
  return raw.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function primaryTagId(tagId: string): string {
  return tagId.startsWith("qc-") ? tagId.slice(3) : tagId;
}

/** Candidate tokens used to decide whether a question “ties” to this tag. */
export function candidateTermsForTag(tag: CandidateTermSource): string[] {
  const id = primaryTagId(tag.id);
  const terms = new Set<string>();
  if (id) terms.add(id.toLowerCase());
  for (const t of tag.searchTerms ?? []) {
    const v = t.trim().toLowerCase();
    if (v) terms.add(v);
  }
  for (const c of tag.campaignCodes ?? []) {
    const v = c.trim().toLowerCase();
    if (v) terms.add(v);
  }
  for (const w of (tag.label ?? "").split(/\s+/)) {
    const v = w.trim().toLowerCase();
    if (v.length > 2 && !/^(for|the|and)$/i.test(v)) terms.add(v);
  }
  for (const extra of CANDIDATE_TERM_ALIASES[id] ?? []) terms.add(extra);
  return [...terms];
}

export function questionTiesToCandidate(questionName: string, terms: readonly string[]): boolean {
  const n = normalizeSurveyTextForMatching(questionName.toLowerCase());
  return terms.some((term) => {
    const t = term.trim().toLowerCase();
    if (t.length < 2) return false;
    const re = new RegExp(`\\b${escapeRegex(t)}\\b`, "i");
    return re.test(n);
  });
}

function isCanvassDispositionQuestion(questionName: string): boolean {
  if (isCanvassResultColumnQuestion(questionName)) return true;
  const q = questionName.trim().toLowerCase();
  if (scriptBlockRe.test(q) || traciScriptRe.test(q)) return false;
  return CANVASS_DISPOSITION_NAME_RE.test(questionName.trim());
}

function isScriptOrTraciBlockQuestion(questionName: string): boolean {
  const q = questionName.trim().toLowerCase();
  return scriptBlockRe.test(q) || traciScriptRe.test(q);
}

export function isExcludedSupportSourceQuestion(
  questionName: string,
  profile: SurveyScriptProfile = "faizahTraci"
): boolean {
  if (questionLooksLikeDisclaimer(questionName)) return true;
  if (isTraciViolationQuestionName(questionName)) return true;
  if (isCanvassDispositionQuestion(questionName)) return true;
  // Polling / numbered ID / “count on your vote” are the initial survey — not script chrome.
  if (looksLikeIdOrVoteQuestion(questionName, profile)) return false;
  if (isScriptOrTraciBlockQuestion(questionName)) return true;
  return false;
}

export function campaignHasFinalResultTab(
  questions: readonly { questionName: string }[]
): boolean {
  return questions.some(
    (q) =>
      isFinalResultQuestionName(q.questionName) || isSplitStrongSupportQuestionName(q.questionName)
  );
}

function looksLikeIdOrVoteQuestion(
  questionName: string,
  profile: SurveyScriptProfile
): boolean {
  if (isPollingQuestionName(questionName, profile)) return true;
  const t = questionName.trim().toLowerCase();
  if (/count\s+on\s+your\s+vote|can\s+we\s+count/.test(t)) return true;
  if (/\b0?1\s*[-–—.:)]/.test(t) && /vote|support|count/.test(t)) return true;
  return false;
}

/**
 * ID / horse-race tab used when the campaign has no Final Result question.
 * Requires the question text to mention the candidate.
 */
export function isCandidateIdSupportQuestion(
  questionName: string,
  terms: readonly string[],
  profile: SurveyScriptProfile = "faizahTraci",
  campaignAnswersForQuestion?: readonly string[]
): boolean {
  if (isExcludedSupportSourceQuestion(questionName, profile)) return false;
  if (isFinalResultQuestionName(questionName) || isSplitStrongSupportQuestionName(questionName)) {
    return false;
  }
  if (!questionTiesToCandidate(questionName, terms)) return false;
  if (looksLikeIdOrVoteQuestion(questionName, profile)) return true;
  if (campaignAnswersForQuestion?.some((a) => classifiedAnswerIsStrongSupport(a, profile))) {
    return true;
  }
  return false;
}

function isSubstantiveAnswer(answerValue: string): boolean {
  const t = answerValue.trim();
  if (!t) return false;
  return t.toLowerCase() !== "[no answer recorded]";
}

function latestRowPerQuestion<T extends { questionName: string; surveyResultId: number }>(
  rows: readonly T[]
): T[] {
  const m = new Map<string, T>();
  for (const r of rows) {
    const prev = m.get(r.questionName);
    if (!prev || r.surveyResultId > prev.surveyResultId) m.set(r.questionName, r);
  }
  return [...m.values()];
}

function isEligibleSynthesisSource(
  questionName: string,
  terms: readonly string[],
  profile: SurveyScriptProfile
): boolean {
  if (isExcludedSupportSourceQuestion(questionName, profile)) return false;
  if (isFinalResultQuestionName(questionName) || isSplitStrongSupportQuestionName(questionName)) {
    return false;
  }
  return (
    looksLikeIdOrVoteQuestion(questionName, profile) || questionTiesToCandidate(questionName, terms)
  );
}

function isSplitFinalOrPitchColumn(questionName: string): boolean {
  const t = questionName.trim().toLowerCase();
  return /\bfinal\s*result\b|resultado\s*final|\bpitch\b/.test(t);
}

function isAffirmativeSurveyAnswer(answerValue: string): boolean {
  const t = answerValue.trim().toLowerCase();
  if (!t || t === "[no answer recorded]") return false;
  return !/^(no|false|0|n)$/i.test(t);
}

function callHasSubstantiveFinalResult(
  rows: readonly { questionName: string; answerValue: string }[]
): boolean {
  return rows.some((r) => {
    if (isSplitStrongSupportQuestionName(r.questionName) && isAffirmativeSurveyAnswer(r.answerValue)) {
      return true;
    }
    if (isFinalResultQuestionName(r.questionName) && isSubstantiveAnswer(r.answerValue)) return true;
    if (isSplitFinalOrPitchColumn(r.questionName) && isAffirmativeSurveyAnswer(r.answerValue)) {
      return true;
    }
    return false;
  });
}

function synthesizedSupportAnswer(
  rows: readonly { questionName: string; answerValue: string }[],
  profile: SurveyScriptProfile,
  terms: readonly string[]
): string | null {
  const eligible = rows.filter(
    (r) => isEligibleSynthesisSource(r.questionName, terms, profile) && isSubstantiveAnswer(r.answerValue)
  );
  const initial = eligible
    .filter((r) => looksLikeIdOrVoteQuestion(r.questionName, profile) || questionTiesToCandidate(r.questionName, terms))
    .sort((a, b) => a.questionName.localeCompare(b.questionName, undefined, { sensitivity: "base" }));
  for (const r of initial) {
    if (classifiedAnswerIsFinalResultBucket(r.answerValue, profile)) return r.answerValue.trim();
  }
  const rest = [...eligible].sort((a, b) =>
    a.questionName.localeCompare(b.questionName, undefined, { sensitivity: "base" })
  );
  for (let i = rest.length - 1; i >= 0; i--) {
    const r = rest[i]!;
    if (classifiedAnswerIsFinalResultBucket(r.answerValue, profile)) return r.answerValue.trim();
  }
  return null;
}

export type StrongSupportCallHit = {
  hit: 0 | 1;
  synthesized: boolean;
};

const SS_MISS: StrongSupportCallHit = { hit: 0, synthesized: false };

/**
 * 1 if this call is a strong support (explicit FR, synthesized FR, or candidate ID tab).
 * Explicit Final Result wins; a call is never counted twice.
 * `synthesized` is true only when FR was missing and SS came from the initial survey fill.
 */
export function strongSupportForCall(
  rows: readonly Pick<CallSurveyRowForFill, "questionName" | "answerValue" | "surveyResultId">[],
  profile: SurveyScriptProfile,
  terms: readonly string[],
  hasFinalResultTab: boolean
): StrongSupportCallHit {
  if (rows.length === 0) return SS_MISS;
  const collapsed = latestRowPerQuestion(rows);

  if (hasFinalResultTab) {
    if (collapsed.some((r) => isStrongSupportSurveyHit(r.questionName, r.answerValue, profile))) {
      return { hit: 1, synthesized: false };
    }
    if (callHasSubstantiveFinalResult(collapsed)) return SS_MISS;
    const filled = synthesizedSupportAnswer(collapsed, profile, terms);
    if (filled && classifiedAnswerIsStrongSupport(filled, profile)) {
      return { hit: 1, synthesized: true };
    }
    return SS_MISS;
  }

  const idHit = collapsed.some(
    (r) =>
      isCandidateIdSupportQuestion(r.questionName, terms, profile, [r.answerValue]) &&
      classifiedAnswerIsStrongSupport(r.answerValue, profile)
  );
  return idHit ? { hit: 1, synthesized: false } : SS_MISS;
}

export function sessionStrongSupportKey(
  campaignId: string,
  callDate: string,
  phonebankerName: string
): string {
  return `${campaignId}::${callDate}::${canonicalizePhonebankerName(phonebankerName)}`;
}

export type SessionStrongSupportCounts = {
  total: Map<string, number>;
  synthesized: Map<string, number>;
};

/** Distinct-call SS counts keyed by `campaignId::callDate::canonicalPhonebanker`. */
export function countStrongSupportBySession(
  rows: readonly CallSurveyRowForFill[],
  profile: SurveyScriptProfile,
  terms: readonly string[]
): SessionStrongSupportCounts {
  const byCampaign = new Map<string, CallSurveyRowForFill[]>();
  for (const r of rows) {
    const list = byCampaign.get(r.campaignId) ?? [];
    list.push(r);
    byCampaign.set(r.campaignId, list);
  }

  const total = new Map<string, number>();
  const synthesized = new Map<string, number>();
  for (const [, campaignRows] of byCampaign) {
    const hasFr = campaignHasFinalResultTab(campaignRows);
    const byCall = new Map<string, CallSurveyRowForFill[]>();
    for (const r of campaignRows) {
      const list = byCall.get(r.callId) ?? [];
      list.push(r);
      byCall.set(r.callId, list);
    }
    for (const [, callRows] of byCall) {
      const result = strongSupportForCall(callRows, profile, terms, hasFr);
      if (result.hit !== 1) continue;
      const head = callRows[0]!;
      const k = sessionStrongSupportKey(head.campaignId, head.callDate, head.phonebankerName);
      total.set(k, (total.get(k) ?? 0) + 1);
      if (result.synthesized) synthesized.set(k, (synthesized.get(k) ?? 0) + 1);
    }
  }
  return { total, synthesized };
}

export function applyCallLevelStrongSupportToDailyCaller(
  dailyRows: readonly TagDailyCallerStat[],
  fillRows: readonly CallSurveyRowForFill[],
  profile: SurveyScriptProfile,
  terms: readonly string[]
): TagDailyCallerStat[] {
  const counts = countStrongSupportBySession(fillRows, profile, terms);
  return dailyRows.map((r) => {
    const k = sessionStrongSupportKey(r.campaignId, r.callDate, r.phonebankerName);
    return {
      ...r,
      strongSupport: counts.total.get(k) ?? 0,
      strongSupportSynthesized: counts.synthesized.get(k) ?? 0,
    };
  });
}

export function formatStrongSupportCell(total: number, synthesized = 0): string {
  const main = total.toLocaleString();
  if (synthesized <= 0) return main;
  return `${main} (${synthesized.toLocaleString()} Synthesized)`;
}

/** Aggregated question-stats overlay: FR path when the campaign has that tab, else candidate ID. */
export function overlayStrongSupportCountsFromQuestionStats(
  questions: readonly {
    campaignId: string;
    campaignName: string;
    callDate: string;
    phonebankerName: string;
    questionName: string;
    answerValue: string;
    responseCount: number;
  }[],
  campaignId: string,
  profile: SurveyScriptProfile,
  terms: readonly string[]
): Map<string, number> {
  const scoped = questions.filter((r) => r.campaignId === campaignId);
  const bySession = new Map<string, number>();
  const hasFr = campaignHasFinalResultTab(scoped);
  const answersByQuestion = new Map<string, string[]>();
  for (const r of scoped) {
    const list = answersByQuestion.get(r.questionName) ?? [];
    list.push(r.answerValue);
    answersByQuestion.set(r.questionName, list);
  }

  for (const r of scoped) {
    const hit = hasFr
      ? isStrongSupportSurveyHit(r.questionName, r.answerValue, profile)
      : isCandidateIdSupportQuestion(
          r.questionName,
          terms,
          profile,
          answersByQuestion.get(r.questionName)
        ) && classifiedAnswerIsStrongSupport(r.answerValue, profile);
    if (!hit) continue;
    const k = `${r.callDate}::${canonicalizePhonebankerName(r.phonebankerName)}`;
    bySession.set(k, (bySession.get(k) ?? 0) + r.responseCount);
  }
  return bySession;
}
