export type DistrictLayerId = "la-city-council" | "ca-state-assembly";

export type DistrictLayerOption = {
  id: DistrictLayerId;
  label: string;
  description: string;
  labelPrefix: "cd" | "ad";
};

export const DISTRICT_LAYER_OPTIONS: DistrictLayerOption[] = [
  {
    id: "la-city-council",
    label: "LA City Council",
    description: "Classify rows into Los Angeles City Council districts.",
    labelPrefix: "cd",
  },
  {
    id: "ca-state-assembly",
    label: "CA Assembly",
    description: "Classify rows into California Assembly districts.",
    labelPrefix: "ad",
  },
];

export type DistrictJobStatus = "queued" | "processing" | "completed" | "failed";

export type DistrictColumnMapping = {
  addressCol: string;
  cityCol: string;
  stateCol: string;
  zipCol: string;
  streetNumCol: string;
  streetNameCol: string;
  aptCol: string;
};

export type DistrictTargetSelection = Partial<Record<DistrictLayerId, string[]>>;

export type DistrictExportFile = {
  fileName: string;
  downloadUrl: string;
  rowCount: number | null;
  kind:
    | "matched"
    | "inferred_districts"
    | "other_districts"
    | "outside_layer"
    | "outside_target"
    | "geocode_failed"
    | "manual_review"
    | "other";
};

export type DistrictClassifierJob = {
  id: string;
  status: DistrictJobStatus;
  originalFileName: string;
  inputPath: string;
  outputDir: string;
  dbPath: string;
  layers: DistrictLayerId[];
  targetSelection: DistrictTargetSelection;
  compareHistorical: boolean;
  columnMapping: DistrictColumnMapping;
  progress: number;
  processedRows: number;
  totalRows: number | null;
  progressMessage: string;
  errorMessage: string | null;
  stdout: string;
  stderr: string;
  exports: DistrictExportFile[];
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type DistrictScanResult = {
  columns: string[];
  firstRow: Record<string, string>;
  suggestedMapping: Partial<Record<"address" | "city" | "state" | "zip" | "street_number" | "street_name" | "apartment", string>>;
  districtMenus: Record<string, string>;
};

export type DistrictReviewRow = {
  rowNumber: number;
  name?: string;
  address?: string;
  zip?: string;
  district?: string;
  confidence?: string;
  method?: string;
  reason?: string;
};

export const DEFAULT_DISTRICT_COLUMN_MAPPING: DistrictColumnMapping = {
  addressCol: "Address",
  cityCol: "City",
  stateCol: "State",
  zipCol: "Zip",
  streetNumCol: "Street #",
  streetNameCol: "Street Name",
  aptCol: "Apt #",
};
