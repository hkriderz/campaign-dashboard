import type { AggregateAnswerLine } from "./daily-aggregate-survey-rollup";
import type { SurveyScriptProfile } from "./types";
import { normalizeSurveyTextForMatching } from "./survey-i18n/rules";

/**
 * Fixed order: Support → Undecided → Oppose.
 * Within Support, "Support other candidate" is last; within Oppose, "Oppose current candidate" is last.
 */
const BUCKET_ORDER_FAIZAH = [
  "Support Faizah",
  "Support other candidate",
  "Undecided",
  "Undecided — won't vote for Traci",
  "Support Traci",
  "Oppose current candidate",
] as const;

const BUCKET_ORDER_EUNISSES = [
  "Support Eunisses",
  "Support other candidate",
  "Undecided",
  "Undecided — won't vote for Traci",
  "Support Traci",
  "Oppose current candidate",
] as const;

const BUCKET_ORDER_GENERIC = [
  "Support Ada",
  "Support other candidate",
  "Undecided",
  "Undecided — won't vote opponent",
  "Support Traci",
  "Oppose current candidate",
] as const;

function bucketOrderForProfile(profile: SurveyScriptProfile): readonly string[] {
  switch (profile) {
    case "eunissesTwoWay":
      return BUCKET_ORDER_EUNISSES;
    case "genericChallenger":
      return BUCKET_ORDER_GENERIC;
    default:
      return BUCKET_ORDER_FAIZAH;
  }
}

/** Strip SS:/SO:/U: and leading letter codes (A. / B) / B ) so matching uses answer text. */
function stripLeadingSurveyCodes(label: string): string {
  let s = label.trim();
  s = s.replace(/^\s*(?:SS|SO|U)\s*:\s*/i, "");
  s = s.replace(/^\s*[A-Za-z]\s*[\.\)\-:]\s*/, "");
  s = s.replace(/^\s*[A-Za-z]\s+(?=[A-Za-z])/i, "");
  return s.trim();
}

function normalizedAnswerText(label: string): string {
  return normalizeSurveyTextForMatching(stripLeadingSurveyCodes(label).toLowerCase());
}

/** Spanish script: will not / does not vote for Traci (STW "no votará por Traci"). */
const RE_NEGATED_VOTE_TRACI_ES =
  /no\s+votará\s+por\s+traci(?:\s+park)?\b|no\s+votara\s+por\s+traci(?:\s+park)?\b|no\s+votar\s+por\s+traci(?:\s+park)?\b/i;

/** True when "vote for Traci" is negated (won't / not / will not) — substring must not count as pro-Traci. */
function hasNegatedVoteForTraci(n: string): boolean {
  return (
    /(won'?t|wont|will\s+not|would\s+not)\s+vot(e|ing)?\s*(?:for\s+)?traci(?:\s+park)?\b|not\s+vot(e|ing)?\s*(?:for\s+)?traci(?:\s+park)?\b|no\s+vot(e|ing)?\s*for\s+traci(?:\s+park)?\b/i.test(
      n
    ) || RE_NEGATED_VOTE_TRACI_ES.test(n)
  );
}

/** Nuanced undecided / lean-Faizah: won't vote for Traci, B-bucket wording, anti-Traci without full support-Traci. */
function matchesUndecidedAntiTraci(n: string): boolean {
  if (/\bundecided\s*[,;]?\s*but|someone\s+else|b\s+undecided\s+but/i.test(n)) return true;
  if (/\banti\s*traci\b|\banti-traci\b|\banti\s+traci\b/i.test(n)) return true;
  if (
    /(won'?t|wont|will\s+not|would\s+not)\s+vot(e|ing)?\s*(?:for\s+)?traci(?:\s+park)?\b|not\s+vot(e|ing)?\s*(?:for\s+)?traci(?:\s+park)?\b|no\s+vot(e|ing)?\s*for\s+traci(?:\s+park)?\b|not\s+vot(e|ing)\s+traci\b/i.test(
      n
    ) ||
    RE_NEGATED_VOTE_TRACI_ES.test(n)
  ) {
    return true;
  }
  if (/won'?t\s+support\s+traci|not\s+support(ing)?\s+traci|against\s+vot(e|ing)?\s*for\s+traci/i.test(n)) {
    return true;
  }
  if (
    /\bundecided\b|\bindeciso\b|\bnot\s+sure\b|\buncommitted\s+to\s+faizah\b/i.test(n) &&
    (/(won'?t|wont|will\s+not|would\s+not|not)\s+vot(e|ing)?\s*(?:for\s+)?traci(?:\s+park)?\b|not\s+support(ing)?\s+traci|against\s+traci/i.test(
      n
    ) ||
      RE_NEGATED_VOTE_TRACI_ES.test(n))
  ) {
    return true;
  }
  if (
    /\bundecided[\s,;–—\-]{0,8}(won'?t|wont|will\s+not|would\s+not|not)\s+vot(e|ing)?\s*(?:for\s+)?traci(?:\s+park)?\b/i.test(
      n
    )
  ) {
    return true;
  }
  if (
    /\bundecided[^.]{0,120}?(won'?t|wont|will\s+not|would\s+not|not)\s+vot(e|ing)?\s*(?:for\s+)?traci(?:\s+park)?\b/i.test(
      n
    )
  ) {
    return true;
  }
  return false;
}

function matchesPrimaryOppose(n: string, rawLabel: string): boolean {
  if (/\bstrong\s+oppose\b/i.test(n)) return true;
  if (
    /oppose\s+(the\s+)?current\s+candidate|\boppose\s+current\b|opposed\s+to\s+(the\s+)?current\s+candidate/i.test(n)
  ) {
    return true;
  }
  const stripped = stripLeadingSurveyCodes(rawLabel).trim().toLowerCase();
  if (/^(ss|so|u)\s*:\s*oppose\b/i.test(rawLabel.trim())) return true;
  if (/^\s*oppose\b/i.test(stripped)) return true;
  if (/\b(opone|en\s+contra|contra\s+(el|la)\s+candidat)/i.test(n)) return true;
  return false;
}

function matchesSupportOtherCandidate(n: string): boolean {
  if (/\boppose\b/i.test(n)) return false;
  return (
    /support\s+other\s+candidate|supporting\s+(a\s+)?different\s+candidate|vote\s+for\s+another\s+candidate/i.test(
      n
    ) || /\bother\s+candidate\b/i.test(n)
  );
}

function matchesSupportTraci(n: string): boolean {
  const proVoteForTraci =
    /vot(e|ing)\s+for\s+traci/i.test(n) && !hasNegatedVoteForTraci(n);
  return (
    /strong\s+oppose.*faizah.*traci|\boppose\b.*faizah.*\btraci|\bsupport\s+traci\b|(^|[^a-z'])traci\s+park|so:\s*strong|strong\s+oppose\s+vote/i.test(
      n
    ) ||
    proVoteForTraci ||
    /(^|[^a-z'])traci\s+park\s*$/i.test(n) ||
    /\btracey\b/i.test(n)
  );
}

function matchesSupportFaizah(n: string): boolean {
  return (
    (/strong\s+support|\bsupport\s+faizah|\bfaizah\b|\bmalik\b/i.test(n) || /\bapoya\b.*\bfaizah\b/.test(n)) &&
    !/\boppose\b.*\bfaizah\b/i.test(n)
  );
}

function matchesSupportAda(n: string): boolean {
  return (
    (/strong\s+support|\bsupport\s+ada\b|\badam\b|\bada\b/i.test(n) || /\bapoya\b.*\bada\b/.test(n)) &&
    !/\boppose\b.*\bada\b/i.test(n) &&
    !/\bfaizah\b|\bmalik\b/i.test(n)
  );
}

function matchesSupportEunisses(n: string): boolean {
  return (
    (/strong\s+support|\bsupport\s+eunisses|\beunisses\b|\bhernandez\b/i.test(n) ||
      /\bapoya\b.*\beunisses\b/.test(n)) &&
    !/\boppose\b.*\beunisses\b/i.test(n)
  );
}

/**
 * Map raw STW answer labels into display buckets. Unmatched lines keep their original label.
 */
export function classifySurveyAnswerDisplayLabel(
  rawLabel: string,
  profile: SurveyScriptProfile = "faizahTraci"
): string {
  const n = normalizedAnswerText(rawLabel);

  if (profile === "genericChallenger" && matchesUndecidedAntiTraci(n)) {
    return "Undecided — won't vote opponent";
  }
  if (
    profile === "genericChallenger" &&
    /won'?t\s+vote\s+for\s+traci|no\s+votar[aá]?\s+por\s+traci/i.test(n)
  ) {
    return "Undecided — won't vote opponent";
  }

  if (profile === "faizahTraci" && matchesUndecidedAntiTraci(n)) {
    return "Undecided — won't vote for Traci";
  }

  if (/\boppose\b/i.test(n) && /\bother\s+candidate\b/i.test(n)) {
    return "Oppose current candidate";
  }

  if (matchesSupportOtherCandidate(n)) {
    return "Support other candidate";
  }

  if (matchesSupportTraci(n)) {
    return "Support Traci";
  }

  if (matchesPrimaryOppose(n, rawLabel)) {
    return "Oppose current candidate";
  }

  if (profile === "genericChallenger") {
    // STW may still emit Faizah-script wording on Ada banks; count as support for this candidate.
    if (matchesSupportFaizah(n)) return "Support Ada";
    if (matchesSupportAda(n)) return "Support Ada";
  } else if (profile === "eunissesTwoWay") {
    if (matchesSupportEunisses(n) && !/oppose|traci\s+park\b/i.test(n)) {
      return "Support Eunisses";
    }
  } else if (matchesSupportFaizah(n)) {
    return "Support Faizah";
  }

  if (/\bundecided\b|\bnot\s+sure\b|indeciso/i.test(n)) {
    return "Undecided";
  }

  return rawLabel.trim();
}

/**
 * Consolidate Polling / Final Result breakdown rows into ordered buckets plus any unclassified labels.
 */
export function consolidateSurveyAnswerLines(
  lines: readonly AggregateAnswerLine[],
  profile: SurveyScriptProfile = "faizahTraci"
): AggregateAnswerLine[] {
  const byDisplay = new Map<string, number>();

  for (const { label, count } of lines) {
    const display = classifySurveyAnswerDisplayLabel(label, profile);
    byDisplay.set(display, (byDisplay.get(display) ?? 0) + count);
  }

  const ordered: AggregateAnswerLine[] = [];
  const order = bucketOrderForProfile(profile);

  for (const b of order) {
    const c = byDisplay.get(b);
    if (c != null && c > 0) ordered.push({ label: b, count: c });
    byDisplay.delete(b);
  }

  const rest = [...byDisplay.entries()]
    .filter(([, c]) => c > 0)
    .map(([label, count]) => ({ label, count }))
    .sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
    );

  return [...ordered, ...rest];
}
