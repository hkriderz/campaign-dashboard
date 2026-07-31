export type CanvassingFileRole = "knock_details" | "campaign_results" | "unknown";

export type CanvassingFileFormat = "csv" | "xlsx";

export type ValidationSeverity = "info" | "warning" | "error";

export type CanvassingValidationIssue = {
  severity: ValidationSeverity;
  code: string;
  message: string;
  fileName?: string;
  sheetName?: string;
  rowNumber?: number;
  field?: string;
};

export type CanvassingSourceFile = {
  id: string;
  originalName: string;
  relativePath: string;
  format: CanvassingFileFormat;
  role: CanvassingFileRole;
  sheetName?: string;
  sizeBytes: number;
  checksum: string;
  rowCount: number;
  columns: string[];
  warnings: string[];
};

export type CanvassingParsedFile = {
  sourceFile: CanvassingSourceFile;
  rows: Record<string, string>[];
};

export type CanvassingKnockEvent = {
  canvasserName: string;
  assignmentName: string;
  voter: string;
  primaryId: string;
  phone: string;
  dateTimeRaw: string;
  occurredAt: string;
  parseConfidence: number;
  question: string;
  response: string;
  sourceFileId: string;
  sourceFileName: string;
  sourceRowNumber: number;
};

export type CanvassingGapDetail = {
  canvasserName: string;
  startAt: string;
  endAt: string;
  gapMinutes: number;
  isBigGap: boolean;
  /** Gap is at least 60 minutes. */
  isHourGap: boolean;
  /** Gap is at least 120 minutes. */
  isOutlierGap: boolean;
  startVoter: string;
  endVoter: string;
  endResponse: string;
  sourceFileName: string;
};

export type CanvasserGapStats = {
  canvasserName: string;
  knockCount: number;
  firstKnockAt: string | null;
  mostRecentKnockAt: string | null;
  largestGapMinutes: number;
  largestGapStartAt: string | null;
  largestGapEndAt: string | null;
  totalGapMinutesOver10: number;
  averageNonZeroGapMinutes: number;
  averageGapEndingInContactMinutes: number | null;
  gapCountOver10: number;
  bigGapCountOver30: number;
  hourGapCount: number;
  outlierGapCount: number;
};

export type KnockAnalysisReportMode = "lunch" | "final";

export type CampaignResultCanvasser = {
  canvasserName: string;
  totals: Record<string, number>;
};

export type CampaignResultSummary = {
  campaignName: string;
  fileName: string;
  sheetName?: string;
  rowCount: number;
  canvasserCount: number;
  resultColumns: string[];
  totals: Record<string, number>;
  canvassers: CampaignResultCanvasser[];
};

export type CanvassingReportSummary = {
  detectedReportDate: string | null;
  totalSourceFiles: number;
  knockDetailFiles: number;
  campaignResultFiles: number;
  unknownFiles: number;
  totalKnockRows: number;
  validKnockEvents: number;
  invalidKnockRows: number;
  totalCanvassers: number;
  gapsOver10: number;
  bigGapsOver30: number;
  gapsOver60: number;
  outlierGapsOver120: number;
  totalGapMinutesOver10: number;
  largestGapMinutes: number;
};

export type CanvassingReportResult = {
  sourceFiles: CanvassingSourceFile[];
  summary: CanvassingReportSummary;
  canvasserStats: CanvasserGapStats[];
  gapDetails: CanvassingGapDetail[];
  /** Gaps over 30 minutes (legacy / regression). */
  bigGapDetails: CanvassingGapDetail[];
  /** Gaps of 60 minutes or more. */
  hourGapDetails: CanvassingGapDetail[];
  /** Gaps of 120 minutes or more. */
  outlierGapDetails: CanvassingGapDetail[];
  campaignResults: CampaignResultSummary[];
  validationIssues: CanvassingValidationIssue[];
};

export type SavedCanvassingReport = CanvassingReportResult & {
  id: string;
  name: string;
  reportDate: string;
  createdAt: string;
  updatedAt: string;
};

export type SavedCanvassingReportListItem = {
  id: string;
  name: string;
  reportDate: string;
  createdAt: string;
  updatedAt: string;
  summary: CanvassingReportSummary;
  sourceFiles: CanvassingSourceFile[];
};
