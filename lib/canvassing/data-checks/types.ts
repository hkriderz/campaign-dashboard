import type {
  DoorknockResultsReport,
  DoorknockResultsSummary,
  DoorknockSummaryFlag,
  DoorknockSummaryFlagKind,
  DoorknockSummarySettings,
} from "@/lib/canvassing/doorknocks-results/types";
import { DEFAULT_DOORKNOCK_SUMMARY_SETTINGS } from "@/lib/canvassing/doorknocks-results/types";

export type DataCheckFlagKind = DoorknockSummaryFlagKind | "geo_timing_check";

export type DataCheckFlag = Omit<DoorknockSummaryFlag, "kind"> & {
  kind: DataCheckFlagKind;
};

export type DataChecksSummary = Omit<DoorknockResultsSummary, "flags"> & {
  flags: Record<DataCheckFlagKind, DataCheckFlag[]>;
};

export type DataChecksReport = Omit<DoorknockResultsReport, "summary"> & {
  summary: DataChecksSummary;
};

export type SavedDataChecksReport = DataChecksReport & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type SavedDataChecksListItem = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  summary: DataChecksSummary;
  sourceFiles: DataChecksReport["sourceFiles"];
};

export const DEFAULT_DATA_CHECKS_SETTINGS: DoorknockSummarySettings = {
  ...DEFAULT_DOORKNOCK_SUMMARY_SETTINGS,
  supportAnswerLabels: ["strong support", "support", "lean support"],
};

export const DATA_CHECK_FLAG_KINDS: DataCheckFlagKind[] = [
  "low_doors_low_support",
  "low_contact_rate",
  "survey_support_struggle",
  "non_contact_outlier",
  "geo_timing_check",
];
