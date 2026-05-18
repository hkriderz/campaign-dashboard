export type SyncPhase =
  | "starting"
  | "mapping"
  | "sync_state"
  | "bigquery"
  | "fill"
  | "ledger"
  | "transform"
  | "post"
  | "complete";

export const SYNC_PHASE_STEPS: ReadonlyArray<{ id: SyncPhase; label: string; progress: number }> = [
  { id: "starting", label: "Start", progress: 5 },
  { id: "mapping", label: "Mapping", progress: 12 },
  { id: "sync_state", label: "Sync state", progress: 18 },
  { id: "bigquery", label: "BigQuery", progress: 40 },
  { id: "fill", label: "Final result fill", progress: 55 },
  { id: "ledger", label: "Ledger", progress: 68 },
  { id: "transform", label: "Transform", progress: 82 },
  { id: "post", label: "PDI post", progress: 95 },
  { id: "complete", label: "Done", progress: 100 },
];

export function phaseFromMessage(message: string): SyncPhase | null {
  if (message.includes("Loading mapping")) return "mapping";
  if (message.includes("Mode:") || message.includes("Date range:")) return "sync_state";
  if (message.includes("Executing BigQuery") || message.includes("Retrieved")) return "bigquery";
  if (message.includes("Final Result") || message.includes("Synthesized")) return "fill";
  if (message.includes("Ledger loaded")) return "ledger";
  if (message.includes("Transformed")) return "transform";
  if (message.includes("Posting") || message.includes("Batch ")) return "post";
  if (message.includes("Completed")) return "complete";
  return null;
}

export function progressForPhase(phase: SyncPhase): number {
  return SYNC_PHASE_STEPS.find((s) => s.id === phase)?.progress ?? 0;
}
