import type { CampaignTag, SurveyScriptProfile } from "./types";

/** Copy for Daily Aggregate CSV fallbacks, Traci-violation panel, and final-result footnotes. */
export type DashboardAggregateLexicon = {
  pollingSupportRowLabel: string;
  pollingSecondaryRowLabel: string;
  finalFallbackSSLabel: string;
  finalFallbackOtherPositiveLabel: string;
  finalFallbackSOLabel: string;
  traciViolationHeading: string;
  traciYesCaption: string;
  traciUnsureCaption: string;
  traciNoCaption: string;
  finalResultBucketsFootnoteLead: string;
  /** Phonebankers tab: column for `finalWontVoteTraci`. */
  phonebankerOtherPositiveColumnLabel: string;
};

export function getDashboardAggregateLexicon(
  tag: CampaignTag,
  profile: SurveyScriptProfile
): DashboardAggregateLexicon {
  const name = tag.label;
  if (profile === "genericChallenger") {
    return {
      pollingSupportRowLabel: name,
      pollingSecondaryRowLabel: "Undecided B",
      finalFallbackSSLabel: `${name} strong support`,
      finalFallbackOtherPositiveLabel: "Other+",
      finalFallbackSOLabel: "Strong oppose",
      traciViolationHeading: "Follow-up survey block",
      traciYesCaption: "Yes / concerned",
      traciUnsureCaption: "Unsure",
      traciNoCaption: "No / not concerned",
      finalResultBucketsFootnoteLead: `${name} script`,
      phonebankerOtherPositiveColumnLabel: "Other+ (lean away from opponent)",
    };
  }
  if (profile === "eunissesTwoWay") {
    return {
      pollingSupportRowLabel: name,
      pollingSecondaryRowLabel: "Undecided B",
      finalFallbackSSLabel: `${name} strong support`,
      finalFallbackOtherPositiveLabel: "Anti Traci / other+",
      finalFallbackSOLabel: "Strong oppose (Traci / opponent)",
      traciViolationHeading: "Traci Violation Q",
      traciYesCaption: "Yes, disqualify her",
      traciUnsureCaption: "Unsure",
      traciNoCaption: "No, doesn't bother me",
      finalResultBucketsFootnoteLead: `${name}–Traci script`,
      phonebankerOtherPositiveColumnLabel: "Other Positive (won't vote Traci)",
    };
  }
  return {
    pollingSupportRowLabel: "Faizah",
    pollingSecondaryRowLabel: "Anti Traci",
    finalFallbackSSLabel: "Faizah SS",
    finalFallbackOtherPositiveLabel: "Anti Traci",
    finalFallbackSOLabel: "SO (Traci Supporter)",
    traciViolationHeading: "Traci Violation Q",
    traciYesCaption: "Yes, disqualify her",
    traciUnsureCaption: "Unsure",
    traciNoCaption: "No, doesn't bother me",
    finalResultBucketsFootnoteLead: "Faizah–Traci script",
    phonebankerOtherPositiveColumnLabel: "Other Positive (Won't Vote Opponent)",
  };
}
