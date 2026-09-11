import {
  classifyTextContactTag,
  TEXT_QUESTION_ORDER,
  TEXT_SUPPORT_ANSWER_ORDER,
  type TextTagKind,
} from "./texting-tag-labels";
import type { TextContactTagStat } from "./types";

export type TextTagAnswerLine = {
  label: string;
  count: number;
  uniqueContacts: number;
};

export type TextTagQuestionBlock = {
  question: string;
  kind: TextTagKind;
  lines: TextTagAnswerLine[];
  /** Unique contacts in this question group (sum of per-tag uniques; support tags are exclusive). */
  taggedContacts: number;
};

function questionSortRank(question: string): number {
  const i = TEXT_QUESTION_ORDER.indexOf(question);
  return i === -1 ? TEXT_QUESTION_ORDER.length : i;
}

function answerSortRank(kind: TextTagKind, label: string): number {
  if (kind === "support") {
    const i = TEXT_SUPPORT_ANSWER_ORDER.indexOf(label);
    return i === -1 ? TEXT_SUPPORT_ANSWER_ORDER.length : i;
  }
  return 0;
}

export function buildTextTagRollup(
  stats: TextContactTagStat[],
  candidateTagId: string
): TextTagQuestionBlock[] {
  const byQuestion = new Map<
    string,
    { kind: TextTagKind; lines: Map<string, TextTagAnswerLine> }
  >();

  for (const row of stats) {
    const classified = classifyTextContactTag(row.tagName, candidateTagId);
    if (!byQuestion.has(classified.question)) {
      byQuestion.set(classified.question, { kind: classified.kind, lines: new Map() });
    }
    const bucket = byQuestion.get(classified.question)!;
    const existing = bucket.lines.get(classified.answer);
    if (existing) {
      existing.count += row.tagCount;
      existing.uniqueContacts += row.uniqueContacts;
    } else {
      bucket.lines.set(classified.answer, {
        label: classified.answer,
        count: row.tagCount,
        uniqueContacts: row.uniqueContacts,
      });
    }
  }

  return Array.from(byQuestion.entries())
    .map(([question, bucket]) => {
      const lines = Array.from(bucket.lines.values()).sort((a, b) => {
        const ra = answerSortRank(bucket.kind, a.label);
        const rb = answerSortRank(bucket.kind, b.label);
        if (ra !== rb) return ra - rb;
        return a.label.localeCompare(b.label);
      });
      return {
        question,
        kind: bucket.kind,
        lines,
        taggedContacts: lines.reduce((sum, line) => sum + line.uniqueContacts, 0),
      };
    })
    .sort((a, b) => {
      const ra = questionSortRank(a.question);
      const rb = questionSortRank(b.question);
      if (ra !== rb) return ra - rb;
      return a.question.localeCompare(b.question);
    });
}
