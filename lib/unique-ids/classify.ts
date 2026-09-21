import type { KnockSupportOutcome } from "../canvassing/overview-tally";
import {
  classifySurveyAnswerDisplayLabel,
  GENERIC_OUTCOME_LABELS,
  finalResultFamilyForDisplayLabel,
} from "../survey-answer-consolidation";
import type { SurveyScriptProfile } from "../types";
import type { UniqueIdChannel, UniqueIdContactEvent, UniqueIdFamily } from "./types";

/** When timestamps tie, canvass beats phone beats text. */
export const CHANNEL_TIE_RANK: Record<UniqueIdChannel, number> = {
  canvass: 2,
  phone: 1,
  text: 0,
};

export const UNIQUE_ID_CHANNELS: readonly UniqueIdChannel[] = ["phone", "text", "canvass"];

export const UNIQUE_ID_FAMILIES: readonly UniqueIdFamily[] = [
  "strongSupport",
  "undecided",
  "strongOppose",
];

export function familyFromKnockOutcome(outcome: KnockSupportOutcome): UniqueIdFamily | null {
  if (outcome === "strong_support" || outcome === "support") return "strongSupport";
  if (outcome === "undecided") return "undecided";
  if (outcome === "oppose" || outcome === "strong_oppose") return "strongOppose";
  return null;
}

/** Map a classified or raw support label onto SS / U / SO. Neither folds to Undecided. */
export function familyFromResultLabel(
  raw: string,
  profile: SurveyScriptProfile
): UniqueIdFamily | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^neither$/i.test(trimmed)) return "undecided";
  const classified = classifySurveyAnswerDisplayLabel(trimmed, profile);
  if (/^neither$/i.test(classified)) return "undecided";
  const family = finalResultFamilyForDisplayLabel(classified);
  if (family === "strongSupport" || family === "undecided" || family === "strongOppose") {
    return family;
  }
  return null;
}

export function familyDisplayLabel(family: UniqueIdFamily): string {
  return GENERIC_OUTCOME_LABELS[family];
}

export function channelDisplayLabel(channel: UniqueIdChannel): string {
  if (channel === "phone") return "Phone";
  if (channel === "text") return "Text";
  return "Canvass";
}

export function compareEventsNewestFirst(
  a: UniqueIdContactEvent,
  b: UniqueIdContactEvent
): number {
  const byAt = (b.occurredAt || "").localeCompare(a.occurredAt || "");
  if (byAt !== 0) return byAt;
  const byDay = (b.occurredOn || "").localeCompare(a.occurredOn || "");
  if (byDay !== 0) return byDay;
  return CHANNEL_TIE_RANK[b.channel] - CHANNEL_TIE_RANK[a.channel];
}

export function compareEventsOldestFirst(
  a: UniqueIdContactEvent,
  b: UniqueIdContactEvent
): number {
  return compareEventsNewestFirst(b, a);
}
