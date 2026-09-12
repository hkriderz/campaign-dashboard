import { dailyCallerSliceKey } from "./slice-key";
import { canonicalizePhonebankerName } from "./phonebanker-name";
import {
  isFinalResultQuestionName,
  type AggregateAnswerLine,
} from "./daily-aggregate-survey-rollup";
import { sortAggregateAnswerLines } from "./aggregate-answer-sort";
import {
  classifySurveyAnswerDisplayLabel,
  csvAnswerForFinalResultFamily,
  finalResultFamilyForDisplayLabel,
  isSplitStrongOpposeQuestionName,
  isSplitStrongSupportQuestionName,
  isSplitUndecidedQuestionName,
  type FinalResultFamily,
} from "./survey-answer-consolidation";
import type { SynthesizedFinalResultHit } from "./strong-support-from-survey";
import type { CallSurveyRowForFill, SurveyScriptProfile } from "./types";

export type OverlayQuestionRow = {
  phonebankerName: string;
  questionName: string;
  answerValue: string;
  responseCount: number;
  synthesizedCount?: number;
};

type FrColumn = {
  questionName: string;
  answerValue: string;
};

const CSV_SYNTHETIC_FR_QUESTION = "Final result";

export function isFinalResultPivotQuestion(questionName: string): boolean {
  return (
    isFinalResultQuestionName(questionName) ||
    isSplitStrongSupportQuestionName(questionName) ||
    isSplitStrongOpposeQuestionName(questionName) ||
    isSplitUndecidedQuestionName(questionName)
  );
}

export function preferredFinalResultQuestionByCampaign(
  fillRows: readonly CallSurveyRowForFill[]
): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of fillRows) {
    if (!isFinalResultQuestionName(r.questionName)) continue;
    if (r.questionName.trim() === CSV_SYNTHETIC_FR_QUESTION) continue;
    if (!m.has(r.campaignId)) m.set(r.campaignId, r.questionName);
  }
  return m;
}

function familyForSplitColumn(questionName: string): FinalResultFamily | null {
  if (isSplitStrongSupportQuestionName(questionName)) return "strongSupport";
  if (isSplitStrongOpposeQuestionName(questionName)) return "strongOppose";
  if (isSplitUndecidedQuestionName(questionName)) return "undecided";
  return null;
}

function collectFrColumns(rows: readonly OverlayQuestionRow[]): FrColumn[] {
  const seen = new Set<string>();
  const cols: FrColumn[] = [];
  for (const r of rows) {
    if (!isFinalResultPivotQuestion(r.questionName)) continue;
    const key = `${r.questionName}::${r.answerValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cols.push({ questionName: r.questionName, answerValue: r.answerValue });
  }
  return cols;
}

function pickFrQuestionName(
  rows: readonly OverlayQuestionRow[],
  preferredByCampaign: Map<string, string> | undefined,
  campaignId: string
): string | null {
  for (const r of rows) {
    if (!isFinalResultQuestionName(r.questionName)) continue;
    if (r.questionName.trim() === CSV_SYNTHETIC_FR_QUESTION) continue;
    return r.questionName;
  }
  const preferred = preferredByCampaign?.get(campaignId);
  if (preferred) return preferred;
  for (const r of rows) {
    if (isFinalResultQuestionName(r.questionName)) return r.questionName;
  }
  return null;
}

function sliceLooksLikeBqSplitScript(rows: readonly OverlayQuestionRow[]): boolean {
  return rows.some((r) => /^\d{1,2}\s/.test(r.questionName.trim()));
}

function matchHitToColumn(
  hit: SynthesizedFinalResultHit,
  columns: readonly FrColumn[],
  profile: SurveyScriptProfile
): FrColumn | null {
  const family = finalResultFamilyForDisplayLabel(hit.displayLabel);
  const csvName = csvAnswerForFinalResultFamily(family);

  for (const col of columns) {
    if (col.answerValue.trim().toLowerCase() === hit.rawAnswer.trim().toLowerCase()) {
      return col;
    }
  }

  for (const col of columns) {
    const splitFamily = familyForSplitColumn(col.questionName);
    if (splitFamily && splitFamily === family) return col;
  }

  for (const col of columns) {
    const label = classifySurveyAnswerDisplayLabel(
      col.answerValue.trim() || col.questionName,
      profile
    );
    if (label === hit.displayLabel) return col;
  }

  if (csvName) {
    for (const col of columns) {
      if (col.answerValue.trim().toLowerCase() === csvName.toLowerCase()) return col;
    }
  }

  return null;
}

function fallbackAnswer(
  hit: SynthesizedFinalResultHit,
  columns: readonly FrColumn[],
  profile: SurveyScriptProfile
): string {
  const family = finalResultFamilyForDisplayLabel(hit.displayLabel);
  for (const col of columns) {
    if (!col.answerValue.trim()) continue;
    if (classifySurveyAnswerDisplayLabel(col.answerValue, profile) === hit.displayLabel) {
      return col.answerValue;
    }
  }
  return csvAnswerForFinalResultFamily(family) ?? hit.rawAnswer;
}

/**
 * Increment existing Final Result pivot cells for synthesized fills.
 * Creates a matching FR column when the slice has none for that answer.
 */
export function applySynthesizedFinalResultsToQuestionRows(
  questionRowsBySlice: Record<string, OverlayQuestionRow[]>,
  hits: readonly SynthesizedFinalResultHit[],
  profile: SurveyScriptProfile,
  preferredFrQuestionByCampaign?: Map<string, string>
): void {
  const bySlice = new Map<string, SynthesizedFinalResultHit[]>();
  for (const hit of hits) {
    const sk = dailyCallerSliceKey(hit);
    const list = bySlice.get(sk) ?? [];
    list.push(hit);
    bySlice.set(sk, list);
  }

  for (const [sliceKey, sliceHits] of bySlice) {
    const rows = questionRowsBySlice[sliceKey] ?? [];
    const columns = collectFrColumns(rows);
    const looksBq = sliceLooksLikeBqSplitScript(rows);

    for (const hit of sliceHits) {
      const matched = matchHitToColumn(hit, columns, profile);
      let questionName = matched?.questionName ?? null;
      let answerValue = matched?.answerValue ?? null;

      if (!questionName) {
        const preferred = pickFrQuestionName(rows, preferredFrQuestionByCampaign, hit.campaignId);
        if (looksBq && (!preferred || preferred === CSV_SYNTHETIC_FR_QUESTION)) {
          continue;
        }
        questionName = preferred ?? CSV_SYNTHETIC_FR_QUESTION;
        answerValue = fallbackAnswer(hit, columns, profile);
      }

      const banker = canonicalizePhonebankerName(hit.phonebankerName);
      const existing = rows.find(
        (r) =>
          canonicalizePhonebankerName(r.phonebankerName) === banker &&
          r.questionName === questionName &&
          r.answerValue === answerValue
      );
      if (existing) {
        existing.responseCount += 1;
        existing.synthesizedCount = (existing.synthesizedCount ?? 0) + 1;
      } else {
        rows.push({
          phonebankerName: banker,
          questionName,
          answerValue: answerValue ?? hit.rawAnswer,
          responseCount: 1,
          synthesizedCount: 1,
        });
      }

      const colKey = `${questionName}::${answerValue}`;
      if (!columns.some((c) => `${c.questionName}::${c.answerValue}` === colKey)) {
        columns.push({ questionName, answerValue: answerValue ?? hit.rawAnswer });
      }
    }

    questionRowsBySlice[sliceKey] = rows;
  }
}

/**
 * Merge synthesized FR hits into Daily Aggregate / bucket lines.
 * When `addCounts` is false, only annotate existing lines (fill-aggregate already includes totals).
 */
export function applySynthesizedHitsToAnswerLines(
  lines: readonly AggregateAnswerLine[],
  hits: readonly SynthesizedFinalResultHit[],
  opts: { addCounts: boolean; verbatim: boolean; profile: SurveyScriptProfile }
): AggregateAnswerLine[] {
  const map = new Map<string, { count: number; synthesized: number }>();
  for (const line of lines) {
    const label = line.label.trim();
    if (!label) continue;
    const prev = map.get(label) ?? { count: 0, synthesized: 0 };
    prev.count += line.count;
    prev.synthesized += line.synthesized ?? 0;
    map.set(label, prev);
  }

  for (const hit of hits) {
    const label = (opts.verbatim ? hit.rawAnswer : hit.displayLabel).trim();
    if (!label) continue;
    const prev = map.get(label) ?? { count: 0, synthesized: 0 };
    if (opts.addCounts) prev.count += 1;
    prev.synthesized += 1;
    map.set(label, prev);
  }

  const out = [...map.entries()]
    .filter(([, acc]) => acc.count > 0)
    .map(([label, acc]) => ({
      label,
      count: acc.count,
      synthesized: acc.synthesized > 0 ? acc.synthesized : undefined,
    }));
  return sortAggregateAnswerLines(out);
}
