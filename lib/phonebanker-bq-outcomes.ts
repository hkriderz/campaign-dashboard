import { isFinalResultQuestionName } from "./daily-aggregate-survey-rollup";
import { canonicalizePhonebankerName } from "./phonebanker-name";
import { classifySurveyAnswerDisplayLabel } from "./survey-answer-consolidation";
import { makeSliceKey } from "./slice-key";
import {
  isCanvassResultColumnQuestion,
  normalizeSurveyTextForMatching,
  normalizedQuestionIsCorrectPersonColumn,
} from "./survey-i18n/rules";
import type { PhoneBankCsvRow, PhonebankerQuestionResponseStat, SurveyScriptProfile } from "./types";

export type PhonebankerBqOutcomeAcc = {
  finalSS: number;
  finalWontVoteTraci: number;
  finalUndecided: number;
  finalSO: number;
  /** Non–correct-person canvass / pitch-hang / NTP-hang style dispositions (matches Decline column intent). */
  declineTotal: number;
};

function emptyAcc(): PhonebankerBqOutcomeAcc {
  return {
    finalSS: 0,
    finalWontVoteTraci: 0,
    finalUndecided: 0,
    finalSO: 0,
    declineTotal: 0,
  };
}

function rowKey(r: Pick<PhonebankerQuestionResponseStat, "campaignName" | "callDate" | "phonebankerName">): string {
  return `${makeSliceKey(r.campaignName, r.callDate)}|${canonicalizePhonebankerName(r.phonebankerName)}`;
}

/** Map labels that stayed “raw” after {@link classifySurveyAnswerDisplayLabel} into CSV buckets. */
function distributeUnclassifiedFinalAnswer(
  label: string,
  n: number,
  acc: PhonebankerBqOutcomeAcc,
  profile: SurveyScriptProfile
): void {
  const t = normalizeSurveyTextForMatching(label.trim().toLowerCase());
  if (profile === "eunissesTwoWay") {
    if (/eunisses|hernandez/.test(t) && !/oppose|traci\s+park\b/i.test(t)) {
      acc.finalSS += n;
      return;
    }
  } else if (profile === "genericChallenger") {
    if ((/\badam\b|\bada\b|support\s+ada|apoya.*ada/i.test(t)) && !/oppose/i.test(t)) {
      acc.finalSS += n;
      return;
    }
  } else {
    if (/eunisses|hernandez/.test(t) && !/oppose|traci\s+park\b/i.test(t)) {
      acc.finalSS += n;
      return;
    }
    if (/faizah|malik/.test(t) && !/oppose/i.test(t)) {
      acc.finalSS += n;
      return;
    }
    if (/\badam\b|\bada\b|support\s+ada/i.test(t)) {
      acc.finalSS += n;
      return;
    }
  }
  if (/undecided|not\s+sure|indeciso/.test(t)) {
    acc.finalUndecided += n;
    return;
  }
  if (/oppose|strong\s+oppose|support\s+traci|traci\s+park/.test(t)) {
    acc.finalSO += n;
    return;
  }
  if (/other\s+candidate|different\s+candidate|won'?t\s+vote\s+for\s+traci/.test(t)) {
    acc.finalWontVoteTraci += n;
    return;
  }
  acc.finalUndecided += n;
}

function addFinalResultCount(
  answerValue: string,
  n: number,
  acc: PhonebankerBqOutcomeAcc,
  profile: SurveyScriptProfile
): void {
  const bucket = classifySurveyAnswerDisplayLabel(answerValue, profile);
  switch (bucket) {
    case "Support Faizah":
    case "Support Ada":
    case "Support Eunisses":
      acc.finalSS += n;
      break;
    case "Support other candidate":
    case "Undecided — won't vote for Traci":
    case "Undecided — won't vote opponent":
      acc.finalWontVoteTraci += n;
      break;
    case "Undecided":
      acc.finalUndecided += n;
      break;
    case "Support Traci":
    case "Oppose current candidate":
      acc.finalSO += n;
      break;
    default:
      distributeUnclassifiedFinalAnswer(answerValue.trim(), n, acc, profile);
  }
}

/**
 * Canvass / disposition columns that are not “talking to correct person” — used for Decline-style totals.
 */
function countsTowardDeclineColumn(questionName: string): boolean {
  if (isCanvassResultColumnQuestion(questionName)) {
    const norm = normalizeSurveyTextForMatching(questionName.trim().toLowerCase());
    if (normalizedQuestionIsCorrectPersonColumn(norm)) return false;
    return true;
  }
  const n = normalizeSurveyTextForMatching(questionName.trim().toLowerCase());
  if (/\bpitch\b.*\bhang|hang\s*up\b.*\bpitch|pitch\s+hang/i.test(n)) return true;
  if (/\bntp\b.*\bhang|ntp\s+hang/i.test(n)) return true;
  return false;
}

/**
 * Aggregate Final Result + decline-style canvass counts per (campaign × day × phonebanker) from BQ survey stats.
 */
export function buildPhonebankerBqOutcomeMap(
  stats: readonly PhonebankerQuestionResponseStat[],
  profile: SurveyScriptProfile = "faizahTraci"
): Map<string, PhonebankerBqOutcomeAcc> {
  const map = new Map<string, PhonebankerBqOutcomeAcc>();
  for (const r of stats) {
    const k = rowKey(r);
    if (!map.has(k)) map.set(k, emptyAcc());
    const acc = map.get(k)!;

    if (isFinalResultQuestionName(r.questionName)) {
      addFinalResultCount(r.answerValue, r.responseCount, acc, profile);
    } else if (countsTowardDeclineColumn(r.questionName)) {
      acc.declineTotal += r.responseCount;
    }
  }
  return map;
}

/**
 * Fill CSV row fields from BQ where the sheet had gaps. Uses per-field max(CSV, BQ) to avoid double-counting
 * when both sources have the same sessions; bumps canvassDeclined when BQ decline total exceeds CSV decline sum.
 */
export function mergePhoneBankRowWithBqOutcomes(
  row: PhoneBankCsvRow,
  map: Map<string, PhonebankerBqOutcomeAcc>
): PhoneBankCsvRow {
  const k = `${makeSliceKey(row.phoneBankName, row.date)}|${canonicalizePhonebankerName(row.callerName)}`;
  const bq = map.get(k);
  if (!bq) return row;

  const csvDecl = row.canvassDeclined + row.pitchHangUp + row.ntpHangUp;
  const declMerged = Math.max(csvDecl, bq.declineTotal);
  const declDelta = declMerged - csvDecl;

  return {
    ...row,
    finalSS: Math.max(row.finalSS, bq.finalSS),
    finalWontVoteTraci: Math.max(row.finalWontVoteTraci, bq.finalWontVoteTraci),
    finalUndecided: Math.max(row.finalUndecided, bq.finalUndecided),
    finalSO: Math.max(row.finalSO, bq.finalSO),
    canvassDeclined: row.canvassDeclined + Math.max(0, declDelta),
  };
}
