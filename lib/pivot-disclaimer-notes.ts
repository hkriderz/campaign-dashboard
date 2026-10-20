/**
 * Disclaimer/Notes is a free-text short answer. The phonebanker pivot must not
 * grow one column per note. Yes/No disclaimer headers stay separate.
 */
import { questionLooksLikeDisclaimerNotes } from "./survey-i18n/disclaimer-notes";
import { stripWideQuestionPrefixes, wideColumnCollapseLabel } from "./wide-header-utils";

export const PIVOT_NOTES_NA = "N/A";

export type PivotAnswerColumn = {
  key: string;
  questionName: string;
  answerValue: string;
  notesNa?: boolean;
};

/** True for Disclaimer/Notes question names and wide headers such as `2. Disclaimer/Notes: left a message`. */
export function isDisclaimerNotesPivotSource(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  if (questionLooksLikeDisclaimerNotes(raw)) return true;
  const stripped = stripWideQuestionPrefixes(raw);
  if (stripped !== raw && questionLooksLikeDisclaimerNotes(stripped)) return true;
  const label = wideColumnCollapseLabel(stripped);
  return label !== raw && questionLooksLikeDisclaimerNotes(label);
}

/** Shared pivot question title for every answer column of a notes question. */
export function disclaimerNotesPivotGroupLabel(text: string): string {
  const stripped = stripWideQuestionPrefixes(text.trim());
  return wideColumnCollapseLabel(stripped) || stripped;
}

export function disclaimerNotesPivotColumn(text: string): PivotAnswerColumn {
  const questionName = disclaimerNotesPivotGroupLabel(text);
  return {
    key: `notes-na::${questionName.toLowerCase()}`,
    questionName,
    answerValue: PIVOT_NOTES_NA,
    notesNa: true,
  };
}

/** Replace every notes header with one group label, leaving other headers in place. */
export function collapseDisclaimerNotesPivotHeaders(headers: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of headers) {
    const header = raw.trim();
    if (!header) continue;
    if (isDisclaimerNotesPivotSource(header)) {
      const label = disclaimerNotesPivotGroupLabel(header);
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
      continue;
    }
    out.push(header);
  }
  return out;
}

/** Record a pivot column, folding every Disclaimer/Notes answer into one N/A column. */
export function upsertPivotAnswerColumn(
  colByKey: Map<string, PivotAnswerColumn>,
  questionName: string,
  answerValue: string
): void {
  if (isDisclaimerNotesPivotSource(questionName)) {
    const col = disclaimerNotesPivotColumn(questionName);
    if (!colByKey.has(col.key)) colByKey.set(col.key, col);
    return;
  }
  const key = `${questionName}::${answerValue}`;
  if (!colByKey.has(key)) {
    colByKey.set(key, { key, questionName, answerValue });
  }
}
