// ─── Campaign / Tag Types ─────────────────────────────────────────────────────

export type AppMode = "phonebanking" | "canvassing" | "pdi";

/**
 * Which survey answer → bucket rules apply (Faizah–Traci vs Ada-style vs Eunisses–Traci).
 * Drives survey bucket classification, phonebanker BQ merges, and dashboard copy.
 */
export type SurveyScriptProfile = "faizahTraci" | "eunissesTwoWay" | "genericChallenger";

export type CampaignTag = {
  id: string;
  label: string;
  searchTerms: string[];
  /**
   * When set, each inner list is OR’d (LIKE), and each group is AND’d together.
   * Replaces the flat `searchTerms` / `campaignCodes` OR clause for this tag.
   * `campaignCodes` regexes are OR’d into the **last** group only.
   */
  searchTermGroups?: string[][];
  /**
   * Sidebar: consecutive tags with the same `navGroup` render under one subheading (e.g. "QC Calls").
   */
  navGroup?: string;
  /**
   * Short codes in phone bank names (often 3 letters), e.g. `EUN 004`, `ADA-001`.
   * Matched in SQL with a boundary-style regex so codes are not bare substrings.
   */
  campaignCodes?: string[];
  color: string;
  textColor: string;
  mode: AppMode | "both";
  /** When false, hide the Polling block on the daily aggregate (e.g. scripts without a Polling question). */
  showPollingAggregate?: boolean;
  /**
   * When the BQ “Final Result” / “Resultado final” rollup is empty, derive counts per call from the
   * last substantive structured survey answer (aligned with `fill_final_results` in `stw_to_pdi.py`).
   */
  useCallLevelFinalResultFill?: boolean;
  /** When set, overrides {@link resolveSurveyScriptProfile} inference from tag id. */
  surveyScriptProfile?: SurveyScriptProfile;
  /**
   * When true, Daily Aggregate “Final Result” lists raw `answer_value` labels from BigQuery (same wording as the script).
   * When false/omitted, labels are merged into dashboard buckets (see `consolidateSurveyAnswerLines`).
   */
  verbatimFinalResultAggregate?: boolean;
};

// ─── Phone Banking Types ──────────────────────────────────────────────────────

export type PhoneBankSummary = {
  campaignId: string;
  campaignName: string;
  totalDials: number;
  uniqueCallers: number;
  totalHours: number;
  totalSeconds: number;
  firstCallDate: string | null;
  lastCallDate: string | null;
  campaignCreatedDate: string;
};

export type CandidateStats = {
  tag: CampaignTag;
  totalDials: number;
  uniqueCallers: number;
  totalHours: number;
  phoneBankCount: number;
  firstCallDate: string | null;
  lastCallDate: string | null;
  phoneBanks: PhoneBankSummary[];
};

export type PhonebankerDailyStat = {
  campaignName: string;
  callDate: string;
  phonebankerName: string;
  numDials: number;
  totalCallSeconds: number;
  totalDialerSeconds: number;
  totalCallHours: number;
  totalDialerHours: number;
  earliestLogin: string;
  latestLogout: string;
};

export type PhonebankerAggregateStat = {
  phonebankerName: string;
  totalDials: number;
  totalCallHours: number;
  totalDialerHours: number;
  daysWorked: number;
  campaigns: string[];
};

export type TagDailyCallerStat = {
  campaignId: string;
  campaignName: string;
  callDate: string;
  phonebankerName: string;
  callsAnswered: number;
  talkingToCorrectPerson: number;
  surveyed: number;
  /** Distinct dials (calls rows) for this session day — keeps minimal real sessions with 0 STW call seconds. */
  numDials: number;
  totalCallSeconds: number;
  totalDialerSeconds: number;
};

export type PhonebankerQuestionResponseStat = {
  campaignId: string;
  campaignName: string;
  callDate: string;
  phonebankerName: string;
  questionName: string;
  answerValue: string;
  responseCount: number;
};

/** One `survey_results` row for call-level final-result fill (Eunisses / scripts without FR in BQ rollup). */
export type CallSurveyRowForFill = {
  callId: string;
  campaignId: string;
  campaignName: string;
  callDate: string;
  phonebankerName: string;
  questionName: string;
  answerValue: string;
  surveyResultId: number;
};

export type PhoneBankDetail = {
  campaign: PhoneBankSummary;
  dailyStats: PhonebankerDailyStat[];
  phonebankerAggregates: PhonebankerAggregateStat[];
  availableDates: string[];
};

// ─── CSV / Google Sheets Phone Bank Data ─────────────────────────────────────
// Mirrors the column layout of "LA 2026 HWLRA Roster & Data - Faizah PBs.csv"
// Column indices are fixed — we parse by position not header name.

export type PhoneBankCsvRow = {
  // Identity
  date: string;
  phoneBankName: string;
  callerName: string; // normalized
  callerNameRaw: string; // original
  // Session timing (HH:MM:SS strings)
  hoursLoggedIn: string;
  timeInCalls: string;
  // Contact funnel
  callsAnswered: number;
  correctPerson: number;
  surveyed: number;
  surveyRateRaw: string; // e.g. "23.71%" — computed by source, kept as string
  // Polling
  pollingFaizah: number;
  pollingUndecidedB: number;
  pollingUndecided: number;
  pollingTraci: number;
  // Faizah Pitch
  pitchSS: number;
  pitchUndecidedB: number;
  pitchUndecided: number;
  pitchSO: number;
  pitchHangUp: number;
  // Not Traci Park
  ntpFaizah: number;
  ntpCommits: number;
  ntpUndecided: number;
  ntpTraciSupporter: number;
  ntpHangUp: number;
  // Final Result (primary outcomes)
  finalSS: number;
  finalWontVoteTraci: number;
  finalUndecided: number;
  finalSO: number;
  // Donate
  donateNow: number;
  donateLater: number;
  donateUndecided: number;
  donateWont: number;
  // Disclaimer
  disclaimerNo: number;
  disclaimerYes: number;
  // Canvass non-contact results
  canvassAMNA: number;
  canvassCallBack: number;
  canvassDeclined: number;
  canvassDNC: number;
  canvassLangOther: number;
  canvassLangSpanish: number;
  canvassMoved: number;
  canvassWrongNumber: number;
  /** Voicemail / machine outcomes (wide STW scripts). */
  canvassAnsweringMachine: number;
  canvassVoicemail: number;
  // Flyer
  flyerYes: number;
  flyerUnsure: number;
  flyerNo: number;
  // Traci Violations Rap (present in PBs 017+)
  violationsYes: number;
  violationsUnsure: number;
  violationsNo: number;
  // Vote Plan (present in PB 019)
  votePlanA: number;
  votePlanB: number;
  votePlanC: number;
  votePlanD: number;
  votePlanE: number;
  votePlanF: number;
  votePlanG: number;
  /**
   * Wide-import columns that do not map to built-in fields (exact CSV header → count).
   * Preserved through merge/replace; subtotals use {@link sumRows}.
   */
  extraWideColumns?: Record<string, number>;
};

/** A zero-value row — used as base for accumulation */
export const EMPTY_CSV_ROW: Omit<PhoneBankCsvRow, 'date' | 'phoneBankName' | 'callerName' | 'callerNameRaw' | 'hoursLoggedIn' | 'timeInCalls' | 'surveyRateRaw'> = {
  callsAnswered: 0, correctPerson: 0, surveyed: 0,
  pollingFaizah: 0, pollingUndecidedB: 0, pollingUndecided: 0, pollingTraci: 0,
  pitchSS: 0, pitchUndecidedB: 0, pitchUndecided: 0, pitchSO: 0, pitchHangUp: 0,
  ntpFaizah: 0, ntpCommits: 0, ntpUndecided: 0, ntpTraciSupporter: 0, ntpHangUp: 0,
  finalSS: 0, finalWontVoteTraci: 0, finalUndecided: 0, finalSO: 0,
  donateNow: 0, donateLater: 0, donateUndecided: 0, donateWont: 0,
  disclaimerNo: 0, disclaimerYes: 0,
  canvassAMNA: 0, canvassCallBack: 0, canvassDeclined: 0, canvassDNC: 0,
  canvassLangOther: 0, canvassLangSpanish: 0, canvassMoved: 0, canvassWrongNumber: 0,
  canvassAnsweringMachine: 0, canvassVoicemail: 0,
  flyerYes: 0, flyerUnsure: 0, flyerNo: 0,
  violationsYes: 0, violationsUnsure: 0, violationsNo: 0,
  votePlanA: 0, votePlanB: 0, votePlanC: 0, votePlanD: 0, votePlanE: 0, votePlanF: 0, votePlanG: 0,
};

// ─── API Response Wrappers ────────────────────────────────────────────────────

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: number };
