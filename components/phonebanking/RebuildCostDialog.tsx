"use client";

type RebuildCostDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Confirms a Rebuild before it queries BigQuery from December 1, 2025. */
export default function RebuildCostDialog({ open, onCancel, onConfirm }: RebuildCostDialogProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rebuild-cost-title"
        className="max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="rebuild-cost-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Rebuild from December 1, 2025?
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-snug">
          Rebuild queries BigQuery from December 1, 2025, including contact and callee JSON, and costs much more
          than Refresh.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-amber-700 hover:bg-amber-800 text-white px-3 py-2 text-xs font-medium"
          >
            Rebuild
          </button>
        </div>
      </div>
    </div>
  );
}
