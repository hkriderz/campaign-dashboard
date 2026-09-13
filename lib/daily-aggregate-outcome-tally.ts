import {
  campaignHasFinalResultTab,
  isCandidateIdSupportQuestion,
} from "@/lib/strong-support-from-survey";
import {
  effectiveFinalResultAnswerLabelForRollup,
  isFinalResultQuestionName,
  isPollingQuestionName,
  type AggregateAnswerLine,
} from "@/lib/daily-aggregate-survey-rollup";
import { dailyCallerSliceKey } from "@/lib/slice-key";
import {
  sumFinalResultFamilies,
  type FinalResultFamilyCounts,
} from "@/lib/survey-answer-consolidation";
import type { SurveyScriptProfile } from "@/lib/types";

export type SupportOutcomeRow = {
  campaignId?: string;
  campaignName: string;
  callDate: string;
  questionName: string;
  answerValue: string;
  responseCount: number;
  synthesizedCount?: number;
};

function campaignGroupKey(row: SupportOutcomeRow): string {
  const id = row.campaignId?.trim() ?? "";
  return id ? `id:${id}` : `name:${row.campaignName.trim().toLowerCase()}`;
}

function isRecordedAnswer(answerValue: string): boolean {
  const t = answerValue.trim();
  return Boolean(t) && t.toLowerCase() !== "[no answer recorded]";
}

function rowToLine(row: SupportOutcomeRow, label: string): AggregateAnswerLine {
  return {
    label,
    count: row.responseCount,
    synthesized: row.synthesizedCount && row.synthesizedCount > 0 ? row.synthesizedCount : undefined,
  };
}

function answersByQuestion(rows: readonly SupportOutcomeRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.questionName) ?? [];
    list.push(row.answerValue);
    map.set(row.questionName, list);
  }
  return map;
}

/**
 * One support source per campaign in the selected slices:
 * Final Result when that bank has an FR tab, otherwise polling, otherwise the candidate ID question.
 * Prevents a QC FR question from hiding ID-only banks in the same tag.
 */
export function collectPerCampaignSupportLines(
  rows: readonly SupportOutcomeRow[],
  opts: {
    sliceKeys: ReadonlySet<string>;
    profile: SurveyScriptProfile;
    terms: readonly string[];
  }
): AggregateAnswerLine[] {
  const scoped = rows.filter((row) => opts.sliceKeys.has(dailyCallerSliceKey(row)));
  const byCampaign = new Map<string, SupportOutcomeRow[]>();
  for (const row of scoped) {
    const key = campaignGroupKey(row);
    const list = byCampaign.get(key) ?? [];
    list.push(row);
    byCampaign.set(key, list);
  }

  const lines: AggregateAnswerLine[] = [];
  for (const campaignRows of byCampaign.values()) {
    if (campaignHasFinalResultTab(campaignRows)) {
      for (const row of campaignRows) {
        const label = effectiveFinalResultAnswerLabelForRollup(row.questionName, row.answerValue);
        if (!label) continue;
        if (!isFinalResultQuestionName(row.questionName) && !isRecordedAnswer(row.answerValue)) {
          continue;
        }
        lines.push(rowToLine(row, label));
      }
      continue;
    }

    const byQuestion = answersByQuestion(campaignRows);
    const pollingRows = campaignRows.filter(
      (row) => isPollingQuestionName(row.questionName, opts.profile) && isRecordedAnswer(row.answerValue)
    );
    const idRows = campaignRows.filter(
      (row) =>
        isRecordedAnswer(row.answerValue) &&
        isCandidateIdSupportQuestion(
          row.questionName,
          opts.terms,
          opts.profile,
          byQuestion.get(row.questionName)
        )
    );
    const source = pollingRows.length > 0 ? pollingRows : idRows;
    for (const row of source) {
      lines.push(rowToLine(row, row.answerValue.trim()));
    }
  }
  return lines;
}

export function addOutcomeTallies(
  a: FinalResultFamilyCounts,
  b: FinalResultFamilyCounts
): FinalResultFamilyCounts {
  return {
    strongSupport: a.strongSupport + b.strongSupport,
    undecided: a.undecided + b.undecided,
    strongOppose: a.strongOppose + b.strongOppose,
  };
}

export function tallySupportOutcomesByCampaign(
  rows: readonly SupportOutcomeRow[],
  opts: {
    sliceKeys: ReadonlySet<string>;
    profile: SurveyScriptProfile;
    terms: readonly string[];
    extraLines?: readonly AggregateAnswerLine[];
  }
): FinalResultFamilyCounts {
  const lines = [...collectPerCampaignSupportLines(rows, opts), ...(opts.extraLines ?? [])];
  return sumFinalResultFamilies(lines, opts.profile);
}
