import type { PdiAnswerOption } from "./types";

function normalize(s: string): string {
  return s
    .trim()
    .replace(/^[a-zA-Z0-9]{1,2}\.\s+/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CANVASS_RESULT_ALIAS_GROUPS: string[][] = [
  ["voicemail", "voice mail", "buzon de voz"],
  ["talking to correct person", "correct person", "hablando con la persona correcta"],
  ["callback", "call back", "no answer", "llamar mas tarde", "no hay respuesta"],
  ["moved"],
  ["do not call", "dnc", "no llamar"],
  ["wrong number", "numero equivocado"],
  ["declined conversation", "declined", "rechazo la conversacion"],
];

function aliasGroupFor(text: string): string[] | null {
  const norm = normalize(text);
  return (
    CANVASS_RESULT_ALIAS_GROUPS.find((group) =>
      group.some((term) => norm.includes(term) || term.includes(norm))
    ) ?? null
  );
}

function optionSearchText(option: PdiAnswerOption): string {
  return normalize(`${option.displayCode} ${option.displayDescription} ${option.flagIdDescription}`);
}

function overlapScore(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared++;
  return shared / Math.max(wordsA.size, wordsB.size);
}

export interface MatchResult {
  option: PdiAnswerOption;
  confidence: "auto" | "manual";
  method: "desc-match";
}

export function autoMatchAnswer(
  stwAnswer: string,
  options: PdiAnswerOption[]
): MatchResult | null {
  if (!options.length) return null;

  const normStw = normalize(stwAnswer);

  const codeMatch = options.find((o) => normalize(o.displayCode) === normStw);
  if (codeMatch) {
    return { option: codeMatch, confidence: "auto", method: "desc-match" };
  }

  const aliasGroup = aliasGroupFor(stwAnswer);
  if (aliasGroup) {
    const aliasMatch = options.find((o) => {
      const normPdi = optionSearchText(o);
      return aliasGroup.some((term) => normPdi.includes(term) || term.includes(normPdi));
    });
    if (aliasMatch) {
      return { option: aliasMatch, confidence: "auto", method: "desc-match" };
    }
  }

  const exactMatch = options.find((o) => normalize(o.displayDescription) === normStw);
  if (exactMatch) {
    return { option: exactMatch, confidence: "auto", method: "desc-match" };
  }

  const containsMatch = options.find((o) => {
    const normPdi = normalize(o.displayDescription);
    return normStw.includes(normPdi) || normPdi.includes(normStw);
  });
  if (containsMatch) {
    return { option: containsMatch, confidence: "auto", method: "desc-match" };
  }

  let bestScore = 0;
  let bestOption: PdiAnswerOption | null = null;
  for (const o of options) {
    const score = overlapScore(normStw, normalize(o.displayDescription));
    if (score > bestScore) {
      bestScore = score;
      bestOption = o;
    }
  }
  if (bestScore >= 0.6 && bestOption) {
    return { option: bestOption, confidence: "auto", method: "desc-match" };
  }

  return null;
}

export function autoMatchAllAnswers(
  answers: string[],
  options: PdiAnswerOption[]
): Record<string, MatchResult> {
  const results: Record<string, MatchResult> = {};
  for (const answer of answers) {
    const match = autoMatchAnswer(answer, options);
    if (match) results[answer] = match;
  }
  return results;
}
