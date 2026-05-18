/**
 * Short English glosses for Spanish STW survey labels (UI only).
 * Extend `GLOSS_RULES` — longer / more specific patterns first.
 *
 * Optional per-profile packs: `gloss-extension-packs.ts` (additive; default empty).
 */

import type { SurveyScriptProfile } from "../types";
import { normalizeSurveyTextForMatching } from "./rules";
import {
  applyCompiledGlossRules,
  getCompiledAnswerGroupingExtensions,
  getCompiledGlossExtensions,
} from "./gloss-extension-packs";

type GlossRule = { id: string; re: RegExp; en: string };

const GLOSS_RULES: readonly GlossRule[] = [
  // English block titles → same `en` string as the Spanish gloss for that block (Daily Aggregate grouping).
  {
    id: "traci-violations-rap-en",
    re: /\btraci\s+violations?\s+rap\b/gi,
    en: "Traci violations script",
  },
  {
    id: "faizah-clean-money-en",
    re: /\bfaizah\s+clean\s+money(\s+alternative)?\b/gi,
    en: "Faizah — clean-money alternative",
  },
  {
    id: "final-result-en-title",
    re: /\bfinal\s+result\b/gi,
    en: "Final result",
  },
  {
    id: "gotv-ballot-vote-en",
    re: /let(?:'|\u2019)?s\s+get\s+that\s+ballot\s+and\s+vote!?/gi,
    en: "GOTV — get ballot & vote",
  },
  {
    id: "aviso-legal-title",
    re: /\baviso\s+legal\b/gi,
    en: "Disclaimer",
  },
  {
    id: "mensaje-voz-title",
    re: /\bmensaje\s+de\s+voz\b/gi,
    en: "Voicemail",
  },
  {
    id: "gotv-agarrar-boleta-head",
    re: /GOTV\s*[-–—:]\s*agarrar\s+la\s+boleta\s+y\s+a\s+votar!?/gi,
    en: "GOTV — get ballot & vote",
  },
  {
    id: "gotv-llenaron-boleta-foto",
    re: /llenaron\s+su\s+boleta\s+y\s+mandar[áa]n\s+una\s+foto!?/gi,
    en: "Returned ballot, will send photo",
  },
  {
    id: "gotv-vbm-foto",
    re: /votar[áa]n\s+por\s+correo\s+y\s+mandar[áa]n\s+una\s+foto!?/gi,
    en: "Vote by mail, will send photo",
  },
  {
    id: "gotv-early-in-person-photo",
    re: /votar[áa]n\s+temprano\s+en\s+persona\s+y\s+mandar[áa]n\s+foto!?/gi,
    en: "Vote early in person, will send photo",
  },
  {
    id: "gotv-eday-in-person-photo",
    re: /van\s+a\s+votar\s+el\s+d[ií]a\s+de\s+la\s+elecci[oó]n\s+en\s+persona\s+y\s+mandar[áa]n\s+foto!?/gi,
    en: "Vote on Election Day in person, will send photo",
  },
  {
    id: "gotv-plan-no-foto",
    re: /hice\s+plan\s+pero\s+no\s+mandar[áa]n\s+foto!?/gi,
    en: "Made a plan but won't send photo",
  },
  {
    id: "callback-no-answer",
    re: /llamar\s+m[aá]s\s+tarde\s+o\s+no\s+hay\s+respuesta/gi,
    en: "Callback / no answer",
  },
  {
    id: "colgado-rechazado",
    re: /colg[oó]\/rechaz[oó]\s+la\s+conversaci[oó]n/gi,
    en: "Hung up / declined",
  },
  {
    id: "no-disqualify-bother",
    re: /no,\s*eso\s+no\s+deber[ií]a\s+descalificarla\s*\/\s*no\s+me\s+importa\.?/gi,
    en: "No, shouldn't disqualify / doesn't matter",
  },
  {
    id: "si-descalificar",
    re: /s[ií]\s+deber[ií]a\s+descalificarla/gi,
    en: "Yes, should disqualify",
  },
  {
    id: "no-seguro",
    re: /no\s+seguro\/?a/gi,
    en: "Not sure",
  },
  {
    id: "indesis-typo",
    re: /\bindesis[ao](\/[oa])?/gi,
    en: "Undecided",
  },
  {
    id: "indeciso-no-traci-long",
    re: /indeciso\/?a\s+pero\s+no\s+votar[aá]\s+por\s+traci/gi,
    en: "Undecided but won't vote Traci",
  },
  {
    id: "no-seguro-faizah-no-traci",
    re: /no\s+seguro\/?a\s+sobre\s+faizah\s+pero\s+no\s+votar[aá]\s+por\s+traci/gi,
    en: "Unsure on Faizah but won't vote Traci",
  },
  { id: "indeciso", re: /indeciso\/?a/gi, en: "Undecided" },
  {
    id: "conversacion-eunisses",
    re: /conversaci[oó]n\s*(con\s*)?eunisses|eunisses\s+conversation/gi,
    en: "Eunisses name-ID / conversation",
  },
  {
    id: "guion-eunisses",
    re: /gui[oó]n\s+de\s+eunisses|guion\s+de\s+eunisses/gi,
    en: "Eunisses script / rap",
  },
  { id: "apoya-eunisses", re: /apoya\s+a\s+eunisses/gi, en: "Supports Eunisses" },
  {
    id: "apoyo-noun-eunisses",
    re: /\bapoyo\s+a\s+eunisses\b/gi,
    en: "Support for Eunisses",
  },
  {
    id: "opone-eunisses",
    re: /oposici[oó]n\s+a\s+eunisses|se\s+opone\s+a\s+eunisses|opone\s+a\s+eunisses/gi,
    en: "Opposes Eunisses",
  },
  {
    id: "eunisses-clean-money-block",
    re: /eunisses\s*[-–—]\s*candidat[oa]\s+de\s+dinero\s+limpio/gi,
    en: "Eunisses — clean-money alternative",
  },
  /** Must run before `candidata-dinero` — that rule matches the same Spanish phrase and would break this pattern. */
  {
    id: "faizah-clean-money-block",
    re: /faizah\s*[-–—]\s*candidat[oa]\s+de\s+dinero\s+limpio/gi,
    en: "Faizah — clean-money alternative",
  },
  { id: "apoya-faizah", re: /apoya\s+a\s+faizah\s+malik/gi, en: "Supports Faizah Malik" },
  { id: "apoyo-faizah", re: /\bapoyo\s+a\s+faizah(\s+malik)?\b/gi, en: "Support for Faizah Malik" },
  { id: "apoya-traci", re: /apoya\s+a\s+traci\s+park/gi, en: "Supports Traci Park" },
  { id: "apoyo-traci", re: /\bapoyo\s+a\s+traci(\s+park)?\b/gi, en: "Support for Traci Park" },
  {
    id: "candidata-dinero",
    re: /candidat[oa]\s+de\s+dinero\s+limpio/gi,
    en: "Clean $ candidate",
  },
  {
    id: "mas-puntos-traci",
    re: /m[aá]s\s+puntos\s+en\s+contra\s+de\s+traci/gi,
    en: "More anti-Traci points",
  },
  { id: "guion-traci", re: /guion\s+de\s+traci/gi, en: "Traci violations script" },
  { id: "guion-traci-accent", re: /gui[oó]n\s+de\s+traci/gi, en: "Traci violations script" },
  { id: "plan-voto", re: /plan\s+de\s+voto/gi, en: "Vote plan" },
  { id: "compromisos", re: /\bcompromisos?\b/gi, en: "Commitments" },
  {
    id: "alternativa-dinero-limpio",
    re: /alternativa(\s+de)?\s+dinero\s+limpio/gi,
    en: "Clean-money alternative",
  },
  { id: "resultado-final", re: /resultado\s+final/gi, en: "Final result" },
  { id: "donacion", re: /donaci[oó]n/gi, en: "Donation" },
  { id: "va-donar-luego", re: /va\s+a\s+donar\s+mas\s+tarde/gi, en: "Will donate later" },
  { id: "no-donara", re: /no\s+va\s+a\s+donar/gi, en: "Won't donate" },
  { id: "leyo-aviso", re: /ley[oó]\s+aviso\s+legal/gi, en: "Read legal notice" },
  { id: "dejo-vm", re: /dej[oó]\s+mensaje\s+de\s+voz/gi, en: "Left voicemail" },
  {
    id: "hablando-persona",
    re: /hablando\s+con\s+la\s+persona\s+correcta/gi,
    en: "Talking to correct person",
  },
  { id: "numero-equiv", re: /n[uú]mero\s+equivocado/gi, en: "Wrong number" },
  { id: "buzon", re: /buz[oó]n\s+de\s+voz/gi, en: "Voicemail" },
  {
    id: "rechazo-conv",
    re: /rechaz[oó]\s+la\s+conversaci[oó]n/gi,
    en: "Declined conversation",
  },
  { id: "barrera", re: /barrera\s+idiom[aá]tica/gi, en: "Language barrier" },
  { id: "no-llamar", re: /no\s+llamar/gi, en: "Do not call" },
];

/**
 * Extra STW answer normalizations for merging EN/ES counts in Daily Aggregate (not applied in table headers).
 * Runs after `applySurveyLabelGlosses`.
 */
const ANSWER_GROUPING_GLOSS_RULES: readonly GlossRule[] = [
  {
    id: "grp-en-yes-disqualify-her",
    re: /\byes\s+it\s+should\s+disqualify\s+her\b/gi,
    en: "Yes, should disqualify",
  },
  {
    id: "grp-en-no-disqualify-slash-care",
    re: /\bno\s+it\s+should\s+not\s+disqualify\s+her\s*\/\s*i\s+don'?t\s+care\s+about\s+that\.?/gi,
    en: "No, shouldn't disqualify / doesn't matter",
  },
  {
    id: "grp-en-no-disqualify-her",
    re: /\bno\s+it\s+should\s+not\s+disqualify\s+her\b/gi,
    en: "No, shouldn't disqualify / doesn't matter",
  },
  {
    id: "grp-en-unsure-line",
    re: /^\s*unsure\.?\s*$/gi,
    en: "Not sure",
  },
  {
    id: "grp-en-wont-donate",
    re: /\bwon'?t\s+donate\b/gi,
    en: "Won't donate",
  },
  {
    id: "grp-en-will-donate-later",
    re: /\bwill\s+donate\s+later\b/gi,
    en: "Will donate later",
  },
];

function applySurveyLabelGlossesForGrouping(text: string, profile?: SurveyScriptProfile): string {
  let out = applySurveyLabelGlosses(text, profile);
  for (const { re, en } of ANSWER_GROUPING_GLOSS_RULES) {
    out = out.replace(re, en);
  }
  const extraAns = getCompiledAnswerGroupingExtensions(profile);
  if (extraAns.length) {
    out = normalizeWs(applyCompiledGlossRules(out, extraAns));
  }
  return normalizeWs(out);
}

/** When the slice is Spanish by answers but the header is still English STW text. */
const ENGLISH_HEADER_GLOSS_RULES: readonly GlossRule[] = [
  { id: "canvass-result", re: /^canvass\s+result$/i, en: "Call / canvass outcome" },
  {
    id: "contact-quality",
    re: /^contact\s+(quality|disposition)/i,
    en: "Contact quality / disposition",
  },
];

/**
 * English script titles that often appear on bilingual surveys; gloss only when the slice
 * already has Spanish content (so English-only campaigns stay unchanged).
 */
const ENGLISH_SCRIPT_WHEN_SPANISH_SLICE: readonly GlossRule[] = [
  {
    id: "eunisses-conversation-en",
    re: /^eunisses\s+conversation$/i,
    en: "Eunisses name-ID / conversation",
  },
  {
    id: "eunisses-clean-money-en",
    re: /^eunisses\s*[-–—]\s*clean\s+money(\s+alternative)?$/i,
    en: "Eunisses — clean-money alternative",
  },
  {
    id: "eunisses-script-en",
    re: /^eunisses\s+(violations?\s+)?(rap|script)$/i,
    en: "Eunisses script / rap",
  },
  {
    id: "eunisses-clean-money-phrase-en",
    re: /^eunisses\s+clean\s+money(\s+alternative)?$/i,
    en: "Eunisses — clean-money alternative",
  },
  {
    id: "clean-money-alt-generic-en",
    re: /^clean\s+money(\s+alternative)?$/i,
    en: "Clean-money alternative",
  },
  {
    id: "anti-traci-points-en",
    re: /^further\s+anti[\s-]*traci\s+points$/i,
    en: "More anti-Traci points",
  },
];

const SPANISH_ACCENT_RE = /[áéíóúñüÁÉÍÓÚÑÜ¿¡]/;
const SPANISH_TOKEN_RE =
  /\b(de|del|la|las|los|con|para|m[aá]s|guion|gui[oó]n|candidat[oa]|indeciso|indesis|apoya|apoyo|opone|oposici[oó]n|descalificar|resultado|donaci[oó]n|buz[oó]n|equivocado|hablando|rechaz[oó]|llamar|seguro|ley[oó]|aviso|legal|mensaje|voz|colg[oó]|persona|correcta|n[uú]mero|barrera|idiom[aá]tica|votar[aá]|importa|deber[ií]a|descalificarla|puntos|contra|traci|faizah|malik|dinero|limpio|español|espanol|violaci[oó]n|violaciones|conversaci[oó]n|conversacion|encuesta|pregunta|elecci[oó]n|votaci[oó]n|compromisos?|alternativa|plan\s+de|boleta|agarrar|correo|mandar|llenaron|temprano|persona|elecci[oó]n|gotv)\b/i;

/** STW-style leading question index: "01 ", "1.", "2) ", etc. */
const LEADING_Q_INDEX_RE = /^\s*(\d{1,2})([\.\)\-:]\s*|\s+)(.*\S.*)$/;

/** Optional "A. " / "B) " answer prefix from STW. */
const ANSWER_LETTER_PREFIX_RE = /^(\s*[A-Z])([\.\)]\s+)(.+)$/i;

/** Leading tally like "82 A. " before the letter option (STW exports). */
const ANSWER_LETTER_WITH_COUNT_PREFIX_RE = /^\s*(?:\d+\s+)?([A-Z])([\.\)]\s+)(.+)$/i;

/** Capture leading count, letter code, and body for English display labels in Daily Aggregate. */
const AGGREGATE_ANSWER_DISPLAY_RE = /^(\s*(?:\d+\s+)?)([A-Z])([\.\)]\s+)(.+)$/i;

function splitAnswerForGrouping(text: string): { letter: string; body: string } {
  const t = text.trim();
  const m = t.match(ANSWER_LETTER_WITH_COUNT_PREFIX_RE);
  if (m?.[3] != null && m[3].trim().length > 0) {
    return { letter: m[1]!.toUpperCase(), body: m[3].trim() };
  }
  return { letter: "", body: t };
}

export type PbSurveyRowForSliceI18n = {
  answerValue: string;
  questionName: string;
};

export type SurveyColumnHeaderRole = "question" | "answer";

export function isSpanishPhonebankCampaign(campaignName: string): boolean {
  return /\bspanish\b|español|espanol|\(español\)/i.test(campaignName.trim());
}

export function surveyLabelLooksSpanish(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (SPANISH_ACCENT_RE.test(t)) return true;
  return SPANISH_TOKEN_RE.test(t);
}

/**
 * True when any question name or answer value in the slice looks Spanish — works across
 * all tags (Faizah, Eunisses, etc.) without relying on campaign titles.
 */
export function sliceHasSpanishSurveyContent(rows: Iterable<PbSurveyRowForSliceI18n>): boolean {
  for (const r of rows) {
    const v = r.answerValue.trim();
    if (v && v.toLowerCase() !== "[no answer recorded]" && surveyLabelLooksSpanish(v)) {
      return true;
    }
    const q = r.questionName.trim();
    if (q && surveyLabelLooksSpanish(q)) return true;
  }
  return false;
}

export function isSpanishPhonebankSlice(
  campaignName: string,
  rows: Iterable<PbSurveyRowForSliceI18n>
): boolean {
  return isSpanishPhonebankCampaign(campaignName) || sliceHasSpanishSurveyContent(rows);
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const NOT_PROPER_NAME_FOLLOWING_A =
  "los|las|el|la|un|una|uno|este|esta|estos|estas|mi|tu|su|mis|tus|sus";

/** "Apoyo a Name" / "apoyo a nombre" → Support for Name (any campaign). */
function applyGenericApoyoA(text: string): string {
  const re = new RegExp(
    `\\bapoyo\\s+a\\s+(?!${NOT_PROPER_NAME_FOLLOWING_A}\\b)([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9]*)\\b`,
    "gi"
  );
  return text.replace(re, (_, name: string) => {
    const n = name.charAt(0).toUpperCase() + name.slice(1);
    return `Support for ${n}`;
  });
}

/** Same for verb form "Apoya a Name". */
function applyGenericApoyaA(text: string): string {
  const re = new RegExp(
    `\\bapoya\\s+a\\s+(?!${NOT_PROPER_NAME_FOLLOWING_A}\\b)([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9]*)\\b`,
    "gi"
  );
  return text.replace(re, (_, name: string) => {
    const n = name.charAt(0).toUpperCase() + name.slice(1);
    return `Supports ${n}`;
  });
}

export function applySurveyLabelGlosses(text: string, profile?: SurveyScriptProfile): string {
  let out = text;
  for (const { re, en } of GLOSS_RULES) {
    out = out.replace(re, en);
  }
  out = applyGenericApoyoA(out);
  out = applyGenericApoyaA(out);
  out = normalizeWs(out);
  const extra = getCompiledGlossExtensions(profile);
  if (extra.length) {
    out = normalizeWs(applyCompiledGlossRules(out, extra));
  }
  return out;
}

function glossEnglishWhenSpanishSlice(text: string): string {
  const t = text.trim();
  for (const { re, en } of ENGLISH_HEADER_GLOSS_RULES) {
    if (re.test(t)) return en;
  }
  for (const { re, en } of ENGLISH_SCRIPT_WHEN_SPANISH_SLICE) {
    if (re.test(t)) return en;
  }
  return t;
}

/** STW sometimes ships EN/ES in one label — do not append a redundant parenthetical. */
function questionHeaderAlreadyBilingual(text: string): boolean {
  const t = text.trim();
  if (/conversation/i.test(t) && /conversaci[oó]n/i.test(t)) return true;
  if (/\s\/\s/.test(t) && t.length >= 12) return true;
  return false;
}

/** Core text after "01 ", "1.", etc., for glossing without duplicating the index in parentheses. */
function coreForGloss(text: string): { core: string; display: string } {
  const t = text.trim();
  const m = t.match(LEADING_Q_INDEX_RE);
  if (m?.[3]) return { core: m[3].trim(), display: t };
  return { core: t, display: t };
}

function splitAnswerLetterPrefix(text: string): { display: string; glossBody: string } {
  const t = text.trim();
  const m = t.match(ANSWER_LETTER_PREFIX_RE);
  if (m?.[3]) return { display: t, glossBody: m[3].trim() };
  return { display: t, glossBody: t };
}

/**
 * Returns `original (English gloss)` when this slice is a Spanish phone bank (by campaign name
 * or any Spanish-looking question/answer text) and we can supply a gloss that differs from the original.
 */
export function formatSurveyColumnHeader(
  text: string,
  opts: { spanishSlice: boolean; role?: SurveyColumnHeaderRole; profile?: SurveyScriptProfile }
): string {
  const t = text.trim();
  if (!t) return text;
  const { spanishSlice, profile } = opts;
  const role: SurveyColumnHeaderRole = opts.role ?? "answer";

  if (!spanishSlice) {
    if (!surveyLabelLooksSpanish(t)) return text;
  }

  if (role === "question" && questionHeaderAlreadyBilingual(t)) {
    return text;
  }

  if (role === "answer") {
    const { display, glossBody } = splitAnswerLetterPrefix(t);
    let gloss = applySurveyLabelGlosses(glossBody, profile);
    const nb = normalizeWs(glossBody).toLowerCase();
    const ng = normalizeWs(gloss).toLowerCase();
    if (ng !== nb && gloss) {
      return `${display} (${gloss})`;
    }
    gloss = applySurveyLabelGlosses(t, profile);
    const n0 = normalizeWs(t).toLowerCase();
    const n1 = normalizeWs(gloss).toLowerCase();
    if (n1 !== n0 && gloss) {
      return `${display} (${gloss})`;
    }
    return text;
  }

  const { core, display } = coreForGloss(t);
  let gloss = applySurveyLabelGlosses(core, profile);
  const nCore = normalizeWs(core).toLowerCase();
  const nGloss = normalizeWs(gloss).toLowerCase();

  if (nGloss === nCore || !gloss) {
    gloss = applySurveyLabelGlosses(t, profile);
    const n0 = normalizeWs(t).toLowerCase();
    const n1 = normalizeWs(gloss).toLowerCase();
    if (n1 !== n0 && gloss) {
      return `${display} (${gloss})`;
    }
    if (spanishSlice && !surveyLabelLooksSpanish(t)) {
      let enGloss = glossEnglishWhenSpanishSlice(t);
      if (enGloss === t) enGloss = glossEnglishWhenSpanishSlice(core);
      if (
        enGloss !== t &&
        enGloss !== core &&
        normalizeWs(enGloss).toLowerCase() !== n0 &&
        normalizeWs(enGloss).toLowerCase() !== nCore
      ) {
        return `${display} (${enGloss})`;
      }
    }
    return text;
  }

  return `${display} (${gloss})`;
}

function finalizeQuestionGroupToken(s: string): string {
  let x = normalizeWs(s).toLowerCase();
  x = x.replace(/[\u2012\u2013\u2014\u2212]+/g, "-");
  x = normalizeSurveyTextForMatching(x);
  return x.replace(/\s+/g, " ").trim();
}

/** Map STW question cores that gloss to disposition phrasing into the same key as "Disclaimer" titles. */
function finalizeQuestionCoreForKey(glossedCore: string): string {
  let x = normalizeWs(glossedCore).replace(/\bread\s+legal\s+notice\b/gi, "Disclaimer");
  return finalizeQuestionGroupToken(x);
}

/**
 * Map a script question title to an English semantic token using the same gloss rules as table headers
 * (`applySurveyLabelGlosses`, `glossEnglishWhenSpanishSlice`), then phrase-normalize for stable keys.
 */
function deriveEnglishCanonicalQuestionCore(
  core: string,
  fullTitle: string,
  profile?: SurveyScriptProfile
): string {
  const s = normalizeWs(core);
  const full = normalizeWs(fullTitle);

  let g = normalizeWs(applySurveyLabelGlosses(s, profile));
  if (g.toLowerCase() !== s.toLowerCase()) {
    return finalizeQuestionCoreForKey(g);
  }

  g = normalizeWs(glossEnglishWhenSpanishSlice(s));
  if (g.toLowerCase() !== s.toLowerCase()) {
    return finalizeQuestionCoreForKey(g);
  }

  g = normalizeWs(glossEnglishWhenSpanishSlice(full));
  if (g.toLowerCase() !== full.toLowerCase()) {
    return finalizeQuestionCoreForKey(g);
  }

  g = normalizeWs(applySurveyLabelGlosses(full, profile));
  if (g.toLowerCase() !== full.toLowerCase()) {
    return finalizeQuestionCoreForKey(g);
  }

  return finalizeQuestionCoreForKey(s);
}

/**
 * Stable key for merging BigQuery `question_name` rows that are the same script block in another language.
 * Uses the leading STW index (01, 02, …) when present so different blocks are never merged.
 * Aligns with `formatSurveyColumnHeader` gloss source (`GLOSS_RULES` + English-on-bilingual-survey titles).
 */
export function questionCanonicalGroupKey(
  questionName: string,
  profile?: SurveyScriptProfile
): string {
  const t = questionName.trim();
  if (!t) return "";
  const { core } = coreForGloss(t);
  const m = t.match(LEADING_Q_INDEX_RE);
  const idxRaw = m?.[1];
  const idx =
    idxRaw != null && idxRaw !== "" && !Number.isNaN(parseInt(idxRaw, 10))
      ? String(parseInt(idxRaw, 10)).padStart(2, "0")
      : "";
  const semantic = deriveEnglishCanonicalQuestionCore(core, t, profile);
  return idx ? `${idx}::${semantic}` : semantic;
}

/**
 * Merge key for survey answer lines across languages: optional `A`/`B`/… letter (same MCQ option)
 * plus gloss-normalized English token (`GLOSS_RULES` + grouping extras).
 */
export function surveyAnswerLineGroupKey(
  answerLabel: string,
  profile?: SurveyScriptProfile
): string {
  const t = answerLabel.trim();
  if (!t) return "";
  const { letter, body } = splitAnswerForGrouping(t);
  const g = applySurveyLabelGlossesForGrouping(body, profile);
  const token = finalizeQuestionGroupToken(g);
  return letter ? `${letter}::${token}` : token;
}

/**
 * English-forward label for Daily Aggregate answer rows: keeps optional `82` + `B.` / `B)` prefix,
 * glosses the body the same way as merge keys (so "No seguro/a" → "Not sure").
 */
export function formatAggregateAnswerLineLabel(
  rawLabel: string,
  profile?: SurveyScriptProfile
): string {
  const t = rawLabel.trim();
  if (!t) return t;
  const m = t.match(AGGREGATE_ANSWER_DISPLAY_RE);
  if (m?.[4]) {
    const lead = m[1]!.trim();
    const letter = m[2]!.toUpperCase();
    const mid = m[3]!;
    const body = m[4]!.trim();
    const glossed = normalizeWs(applySurveyLabelGlossesForGrouping(body, profile));
    const prefix = lead ? `${lead} ` : "";
    return `${prefix}${letter}${mid}${glossed}`.trim();
  }
  return normalizeWs(applySurveyLabelGlossesForGrouping(t, profile));
}
