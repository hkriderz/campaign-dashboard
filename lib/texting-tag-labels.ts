export type TextTagKind = "support" | "moved" | "other";

export type ClassifiedTextTag = {
  question: string;
  answer: string;
  kind: TextTagKind;
};

const SUPPORT_ANSWERS = ["Strong Support", "Undecided", "Neither", "Strong Oppose"] as const;

export const TEXT_SUPPORT_ANSWER_ORDER: readonly string[] = SUPPORT_ANSWERS;

export const TEXT_QUESTION_ORDER: readonly string[] = ["Support", "Moved", "Other"];

function normalizeTagKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "");
}

function splitCamel(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function isNithyaCandidate(tagId: string): boolean {
  const base = tagId.startsWith("qc-") ? tagId.slice(3) : tagId;
  return base === "nithya";
}

function classifyNithya(rawName: string): ClassifiedTextTag {
  const raw = rawName.trim();
  const key = normalizeTagKey(raw);

  if (key.startsWith("moved") || /^moved\b/i.test(raw)) {
    return { question: "Moved", answer: "Recently moved", kind: "moved" };
  }

  const afterMayor = key.includes("nithyamayor")
    ? key.slice(key.indexOf("nithyamayor") + "nithyamayor".length)
    : key;

  if (
    afterMayor === "yes" ||
    afterMayor === "_yes" ||
    key.endsWith("nithyamayoryes") ||
    /_yes$/i.test(raw)
  ) {
    return { question: "Support", answer: "Strong Support", kind: "support" };
  }
  if (afterMayor.includes("supportbass") || afterMayor.includes("bass")) {
    return { question: "Support", answer: "Strong Oppose", kind: "support" };
  }
  if (afterMayor.includes("undecided")) {
    return { question: "Support", answer: "Undecided", kind: "support" };
  }
  if (afterMayor.includes("neither")) {
    return { question: "Support", answer: "Neither", kind: "support" };
  }

  return { question: "Other", answer: raw || "[No tag]", kind: "other" };
}

function classifyGeneric(rawName: string): ClassifiedTextTag {
  const raw = rawName.trim();
  if (!raw) return { question: "Other", answer: "[No tag]", kind: "other" };
  if (/^moved/i.test(raw)) {
    return { question: "Moved", answer: "Recently moved", kind: "moved" };
  }
  const us = raw.indexOf("_");
  if (us > 0) {
    return {
      question: splitCamel(raw.slice(0, us)),
      answer: splitCamel(raw.slice(us + 1)),
      kind: "other",
    };
  }
  return { question: splitCamel(raw), answer: raw, kind: "other" };
}

/** Map a raw STW Text `tags.name` to dashboard question/answer copy. */
export function classifyTextContactTag(rawName: string, candidateTagId: string): ClassifiedTextTag {
  if (isNithyaCandidate(candidateTagId)) return classifyNithya(rawName);
  return classifyGeneric(rawName);
}
