export type SnapshotFreshnessProps = {
  dataUpdatedAtIso?: string | null;
  dataUpdatedAtLabel?: string;
  isStale?: boolean;
  hasSnapshotData?: boolean;
  /** Shown when `hasSnapshotData` is false (tag vs global wording). */
  emptySnapshotHint?: string;
  className?: string;
};

export default function SnapshotFreshnessLine({
  dataUpdatedAtIso,
  dataUpdatedAtLabel,
  isStale,
  hasSnapshotData,
  emptySnapshotHint,
  className = "",
}: SnapshotFreshnessProps) {
  return (
    <p className={["text-xs text-gray-600 dark:text-gray-400", className].filter(Boolean).join(" ")}>
      <span className="font-semibold text-gray-800 dark:text-gray-200">Data updated at </span>
      {dataUpdatedAtIso ? (
        <time dateTime={dataUpdatedAtIso}>{dataUpdatedAtLabel ?? dataUpdatedAtIso}</time>
      ) : (
        <span>{dataUpdatedAtLabel ?? "Never"}</span>
      )}
      {isStale ? (
        <span className="ml-2 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          Stale
        </span>
      ) : null}
      {hasSnapshotData === false && emptySnapshotHint ? (
        <span className="ml-2 text-amber-800 dark:text-amber-300">{emptySnapshotHint}</span>
      ) : null}
    </p>
  );
}
