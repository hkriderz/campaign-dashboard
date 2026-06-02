export type DoorknockBaseColumnKey = "doorsKnocked" | "contacts" | "contactRate";

export type DoorknockSourceFile = {
  id: string;
  originalName: string;
  relativePath: string;
  sizeBytes: number;
  checksum: string;
  rowCount: number;
  columns: string[];
};

export type DoorknockSurveyAnswerColumn = {
  key: string;
  question: string;
  answer: string;
};

export type DoorknockSurveyGroup = {
  question: string;
  columns: DoorknockSurveyAnswerColumn[];
};

export type DoorknockNonContactColumn = {
  key: string;
  label: string;
  sourceHeader: string;
};

export type DoorknockCanvasserRow = {
  canvasserName: string;
  doorsKnocked: number;
  contacts: number;
  contactRate: number;
  surveyAnswers: Record<string, number>;
  nonContacts: Record<string, number>;
};

export type DoorknockCampaignDetection = {
  campaignId: string;
  campaignName: string;
  confidence: number;
  evidence: string[];
  candidateMentions: string[];
  campaignCode: string | null;
};

export type DoorknockCampaignReport = {
  id: string;
  campaignId: string;
  campaignName: string;
  reportDate: string | null;
  sourceFile: DoorknockSourceFile;
  detection: DoorknockCampaignDetection;
  rows: DoorknockCanvasserRow[];
  totals: Omit<DoorknockCanvasserRow, "canvasserName" | "contactRate"> & {
    contactRate: number;
  };
  surveyGroups: DoorknockSurveyGroup[];
  nonContactColumns: DoorknockNonContactColumn[];
};

export type DoorknockSummarySettings = {
  lowDoorsThreshold: number;
  lowDoorsMaxStrongSupport: number;
  lowContactRatePct: number;
  supportAnswerLabels: string[];
  strongSupportAnswerLabels: string[];
  undecidedAnswerLabels: string[];
  surveySupportThresholdPct: number;
  surveyQuestionScope: "first" | "all";
  nonContactOutlierMultiplier: number;
  nonContactMinCount: number;
  ignoredNonContactLabels: string[];
};

export type DoorknockSummaryFlagKind =
  | "low_doors_low_support"
  | "low_contact_rate"
  | "survey_support_struggle"
  | "non_contact_outlier";

export type DoorknockSummaryFlag = {
  kind: DoorknockSummaryFlagKind;
  campaignId: string;
  campaignName: string;
  canvasserName: string;
  message: string;
  metrics: Record<string, number | string>;
};

export type DoorknockResultsSummary = {
  reportDate: string | null;
  campaignCount: number;
  sourceFileCount: number;
  totalCanvassers: number;
  totalDoorsKnocked: number;
  totalContacts: number;
  contactRate: number;
  flags: Record<DoorknockSummaryFlagKind, DoorknockSummaryFlag[]>;
};

export type DoorknockResultsReport = {
  sourceFiles: DoorknockSourceFile[];
  campaigns: DoorknockCampaignReport[];
  settings: DoorknockSummarySettings;
  summary: DoorknockResultsSummary;
  validationIssues: string[];
};

export type SavedDoorknockResultsReport = DoorknockResultsReport & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type SavedDoorknockResultsListItem = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  summary: DoorknockResultsSummary;
  sourceFiles: DoorknockSourceFile[];
};

export const DEFAULT_DOORKNOCK_SUMMARY_SETTINGS: DoorknockSummarySettings = {
  lowDoorsThreshold: 65,
  lowDoorsMaxStrongSupport: 10,
  lowContactRatePct: 8,
  supportAnswerLabels: ["strong support", "support"],
  strongSupportAnswerLabels: ["strong support"],
  undecidedAnswerLabels: ["undecided"],
  surveySupportThresholdPct: 50,
  surveyQuestionScope: "first",
  nonContactOutlierMultiplier: 2,
  nonContactMinCount: 5,
  ignoredNonContactLabels: ["not home"],
};
