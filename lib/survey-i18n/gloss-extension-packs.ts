import type { SurveyScriptProfile } from "../types";

/**
 * Optional regex gloss rules per script profile — additive after built-in `GLOSS_RULES`.
 * Use for new phone banks / STW wording without editing the core table.
 *
 * - `match`: passed to `new RegExp(match, flags)` — escape backslashes in the string.
 * - `replace`: replacement English phrase (same role as built-in `en`).
 * - Keep patterns specific; overly broad rules can mis-merge unrelated questions.
 */
export type SurveyGlossExtensionRule = {
  id: string;
  match: string;
  replace: string;
  /** RegExp flags (default `gi`). */
  flags?: string;
};

export type SurveyAnswerGroupingExtensionRule = SurveyGlossExtensionRule;

const EMPTY: readonly SurveyGlossExtensionRule[] = [];

/**
 * Per-profile question/answer gloss extensions (UI + canonical keys).
 * All profiles default to no extra rules — behavior matches pre-extension code.
 */
export const SURVEY_GLOSS_EXTENSION_PACKS: Record<SurveyScriptProfile, readonly SurveyGlossExtensionRule[]> = {
  faizahTraci: EMPTY,
  eunissesTwoWay: EMPTY,
  genericChallenger: EMPTY,
};

/**
 * Extra answer-line grouping rules (Daily Aggregate merge keys), after built-in `ANSWER_GROUPING_GLOSS_RULES`.
 */
export const SURVEY_ANSWER_GROUPING_EXTENSION_PACKS: Record<
  SurveyScriptProfile,
  readonly SurveyAnswerGroupingExtensionRule[]
> = {
  faizahTraci: EMPTY,
  eunissesTwoWay: EMPTY,
  genericChallenger: EMPTY,
};

type Compiled = { id: string; re: RegExp; en: string };

const compiledGlossCache: Partial<Record<SurveyScriptProfile, readonly Compiled[]>> = {};
const compiledAnswerCache: Partial<Record<SurveyScriptProfile, readonly Compiled[]>> = {};

function compileRule(rule: SurveyGlossExtensionRule): Compiled | null {
  try {
    const flags = rule.flags ?? "gi";
    return { id: rule.id, re: new RegExp(rule.match, flags), en: rule.replace };
  } catch {
    return null;
  }
}

function compilePack(rules: readonly SurveyGlossExtensionRule[]): Compiled[] {
  return rules.map(compileRule).filter((x): x is Compiled => x != null);
}

export function getCompiledGlossExtensions(profile: SurveyScriptProfile | undefined): readonly Compiled[] {
  if (!profile) return [];
  if (!compiledGlossCache[profile]) {
    compiledGlossCache[profile] = compilePack(SURVEY_GLOSS_EXTENSION_PACKS[profile] ?? []);
  }
  return compiledGlossCache[profile]!;
}

export function getCompiledAnswerGroupingExtensions(
  profile: SurveyScriptProfile | undefined
): readonly Compiled[] {
  if (!profile) return [];
  if (!compiledAnswerCache[profile]) {
    compiledAnswerCache[profile] = compilePack(SURVEY_ANSWER_GROUPING_EXTENSION_PACKS[profile] ?? []);
  }
  return compiledAnswerCache[profile]!;
}

export function applyCompiledGlossRules(text: string, rules: readonly Compiled[]): string {
  let out = text;
  for (const { re, en } of rules) {
    out = out.replace(re, en);
  }
  return out;
}
