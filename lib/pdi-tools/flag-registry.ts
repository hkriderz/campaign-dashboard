import type { PdiQuestion, FlagRegistryEntry, FlagScope } from "./types";

const OPERATIONAL_CODES = new Set([
  "NH",
  "MV",
  "D",
  "DNC",
  "LM",
  "BNH",
  "BNM",
  "AMM",
  "GTD",
  "AV",
  "REF",
  "RQ",
  "DRN",
  "PY",
  "SNTLTR",
  "DNSLTTR",
  "DECL",
  "LB",
  "WNVFTP",
  "FLLW",
  "HSKPSS",
  "HSKPSO",
  "WN",
  "HOSTILE",
  "PCYES",
  "PCU",
  "PCNO",
  "FZHSSCI",
  "FZHSSNCI",
]);

const DEMOGRAPHIC_CODES = new Set(["Children", "Military", "Pets", "Seniors"]);

export function buildFlagRegistry(questions: PdiQuestion[]): FlagRegistryEntry[] {
  const flagMap = new Map<string, { code: string; desc: string; surveys: Set<string> }>();

  for (const q of questions) {
    for (const opt of q.answerOptions) {
      if (!flagMap.has(opt.flagId)) {
        flagMap.set(opt.flagId, {
          code: opt.displayCode,
          desc: opt.displayDescription,
          surveys: new Set(),
        });
      }
      flagMap.get(opt.flagId)!.surveys.add(q.id);
    }
  }

  const registry: FlagRegistryEntry[] = [];
  for (const [flagId, { code, desc, surveys }] of flagMap) {
    const usedInNQuestions = surveys.size;
    let scope: FlagScope;

    if (DEMOGRAPHIC_CODES.has(code)) {
      scope = "demographic";
    } else if (OPERATIONAL_CODES.has(code.toUpperCase())) {
      scope = "operational";
    } else if (usedInNQuestions > 3) {
      scope = "generic";
    } else {
      scope = "question-specific";
    }

    registry.push({ flagId, code, desc, scope, usedInNQuestions });
  }

  return registry.sort((a, b) => a.code.localeCompare(b.code));
}
