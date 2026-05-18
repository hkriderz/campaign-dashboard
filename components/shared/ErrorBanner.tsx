type ErrorBannerProps = {
  message: string;
};

export default function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-4 flex gap-3 items-start">
      <span className="text-red-500 dark:text-red-400 text-lg flex-shrink-0" aria-hidden="true">⚠</span>
      <div>
        <p className="font-semibold text-red-800 dark:text-red-300 text-sm">Error loading data</p>
        <p className="text-red-600 dark:text-red-300 text-xs mt-0.5 font-mono">{message}</p>
      </div>
    </div>
  );
}
