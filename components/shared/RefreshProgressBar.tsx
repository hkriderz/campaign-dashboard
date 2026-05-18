type RefreshProgressBarProps = {
  /** 0–100 for determinate; omit for indeterminate pulse */
  percent?: number;
  label: string;
  detail?: string;
};

export default function RefreshProgressBar({
  percent,
  label,
  detail,
}: RefreshProgressBarProps) {
  const determinate = typeof percent === "number";

  return (
    <div
      className="rounded-lg border border-gray-200/80 dark:border-white/10 bg-white/60 dark:bg-white/5 px-3 py-2.5 space-y-2"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-gray-800 dark:text-gray-200">{label}</span>
        {determinate ? (
          <span className="tabular-nums text-gray-500 dark:text-gray-400 shrink-0">
            {Math.round(percent)}%
          </span>
        ) : null}
      </div>

      <div className="h-2 rounded-full overflow-hidden bg-gray-200 dark:bg-white/10">
        {determinate ? (
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-mint-500 shadow-[0_0_12px_rgba(124,108,240,0.45)] transition-[width] duration-300 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        ) : (
          <div className="refresh-progress-indeterminate h-full w-2/5 rounded-full bg-gradient-to-r from-indigo-500 to-mint-500 shadow-[0_0_12px_rgba(124,108,240,0.4)]" />
        )}
      </div>

      {detail ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{detail}</p>
      ) : null}
    </div>
  );
}
