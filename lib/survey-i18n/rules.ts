/**
 * Data-driven survey i18n rules — extend by appending rows (no logic changes required).
 *
 * - `match`: RE2-compatible regex (BigQuery); applied case-insensitively after LOWER().
 * - `replace`: English-ish canonical phrase so existing downstream regexes keep working.
 *
 * Order: longer / more specific phrases first to avoid partial overwrites.
 */
export type I18nPhraseRule = {
  id: string;
  match: string;
  replace: string;
};

export const PHRASE_NORMALIZATION_RULES: readonly I18nPhraseRule[] = [
  // Spanish canvass / disposition answers → tokens aligned with English exclusion/positive regexes
  {
    id: "es-not-correct-person",
    match: "no\\s+(es\\s+)?la\\s+persona\\s+correcta",
    replace: "not the correct person",
  },
  {
    id: "es-talking-correct-full",
    match: "hablando\\s+con\\s+la\\s+persona\\s+correcta",
    replace: "talking to correct person",
  },
  { id: "es-correct-person-short", match: "persona\\s+correcta", replace: "correct person" },
  { id: "es-wrong-number", match: "n[uú]mero\\s+equivocado", replace: "wrong number" },
  { id: "es-voicemail", match: "buz[oó]n\\s+de\\s+voz", replace: "voicemail" },
  {
    id: "es-declined",
    match: "rechaz[oó]\\s*(la\\s*)?(conversaci[oó]n)?",
    replace: "declined",
  },
  { id: "es-hung-up", match: "colg[oó]", replace: "hang up" },
  { id: "es-callback", match: "llamar\\s+m[aá]s\\s+tarde", replace: "call back later" },
  { id: "es-no-answer", match: "no\\s+hay\\s+respuesta", replace: "no answer" },
  { id: "es-dnc", match: "no\\s+llamar", replace: "do not call" },
  { id: "es-language-barrier", match: "barrera\\s+idiom[aá]tica", replace: "language barrier" },
  // Traci / polling style (Spanish script lines)
  {
    id: "es-disqualify-yes",
    match: "s[ií]\\s+deber[ií]a\\s+descalificar",
    replace: "yes should disqualify",
  },
  {
    id: "es-disqualify-no-bother",
    match: "no\\s+me\\s+importa",
    replace: "does not bother me",
  },
  {
    id: "es-not-disqualify",
    match: "no\\s+deber[ií]a\\s+descalificar",
    replace: "no should not disqualify",
  },
  { id: "es-not-sure-short", match: "no\\s+seguro\\/?a", replace: "not sure" },
  { id: "es-undecided", match: "indeciso\\/?a", replace: "undecided" },
  { id: "es-support-faizah", match: "apoya\\s+a\\s+faizah", replace: "support faizah" },
  { id: "es-support-ada", match: "apoya\\s+a\\s+ada", replace: "support ada" },
  { id: "es-support-traci", match: "apoya\\s+a\\s+traci", replace: "support traci" },
];

/** Substrings (lowercased) that identify Traci-violations-style questions across languages. */
export const TRACI_VIOLATION_QUESTION_HINTS: readonly string[] = [
  "traci violation",
  "traci violations",
  "guion de traci",
  "guión de traci",
  "violaciones de traci",
];

/**
 * Substrings after "canvass result -" style prefix that mean correct-person disposition.
 * Used only after text has been phrase-normalized to English where possible.
 */
export const CORRECT_PERSON_DISPOSITION_HINTS: readonly string[] = [
  "talking to correct",
  "correct person",
  "correct pers",
  "right person",
  "reached correct",
];

/** Hints that a question is disclaimer-like (any language), for surveyed exclusion. */
export const DISCLAIMER_QUESTION_HINTS: readonly string[] = ["disclaimer", "aviso legal", "leyó aviso"];

/**
 * Regex body (single line) for script blocks that are NOT canvass dispositions — extend here only.
 * Used inside REGEXP_CONTAINS(LOWER(question_name), r'...') in BigQuery.
 */
export const SCRIPT_BLOCK_EXCLUSION_REGEX_BODY =
  "(final\\s*result|resultado\\s*final|polling|pitch|donate|donaci[oó]n|vote\\s*plan|disclaimer|not\\s*traci|\\bntp\\b|faizah\\s*pitch|commitments?\\s*pitch|flyer|guion\\s+de\\s+traci|gui[oó]n\\s+de\\s+traci)";

/** Non-canvass Traci violations / rap blocks (regex body). */
export const TRACI_SCRIPT_EXCLUSION_REGEX_BODY =
  "traci\\s+violations|violations?\\s*rap|violaciones\\s+de\\s+traci|guion\\s+de\\s+traci|gui[oó]n\\s+de\\s+traci";

export function normalizeSurveyTextForMatching(loweredText: string): string {
  let s = loweredText;
  for (const rule of PHRASE_NORMALIZATION_RULES) {
    try {
      s = s.replace(new RegExp(rule.match, "gi"), rule.replace);
    } catch {
      // Invalid regex in a bad rule — skip so one bad row does not break the app
    }
  }
  return s;
}

export function isTraciViolationQuestionName(questionName: string): boolean {
  const q = questionName.trim().toLowerCase();
  return TRACI_VIOLATION_QUESTION_HINTS.some((hint) => q.includes(hint));
}

/** Layout slot key from `questionCanonicalGroupKey` (includes gloss tokens like "violations script"). */
export function isTraciViolationLayoutCanonicalKey(canonicalKey: string): boolean {
  const q = canonicalKey.trim().toLowerCase();
  if (TRACI_VIOLATION_QUESTION_HINTS.some((hint) => q.includes(hint.toLowerCase()))) return true;
  if (/\bviolations?\s+script\b/.test(q)) return true;
  return false;
}

export function questionLooksLikeDisclaimer(questionName: string): boolean {
  const q = questionName.trim().toLowerCase();
  return DISCLAIMER_QUESTION_HINTS.some((hint) => q.includes(hint));
}

/** Column-style canvass row: disposition encoded in question_name after a dash. */
export function isCanvassResultColumnQuestion(questionName: string): boolean {
  return /canvass\s*result\s*-/i.test(questionName.trim());
}

/**
 * After normalizeSurveyTextForMatching on full question_name, true if this is correct-person column.
 */
export function normalizedQuestionIsCorrectPersonColumn(normalizedQuestionLower: string): boolean {
  const t = normalizedQuestionLower.trim();
  if (!isCanvassResultColumnQuestion(t)) return false;
  return CORRECT_PERSON_DISPOSITION_HINTS.some((hint) => t.includes(hint));
}
