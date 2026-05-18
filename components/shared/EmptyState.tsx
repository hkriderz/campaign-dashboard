type EmptyStateProps = {
  title?: string;
  description?: string;
};

export default function EmptyState({
  title = "No data found",
  description = "There is no data to display for this selection.",
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <span className="text-4xl opacity-80" aria-hidden="true">
        📭
      </span>
      <p className="font-semibold text-gray-800 dark:text-gray-100">{title}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
        {description}
      </p>
    </div>
  );
}
