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
      <p className="section-kicker">Empty</p>
      <p className="font-display text-xl font-semibold text-[var(--section-ink)]">{title}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
        {description}
      </p>
    </div>
  );
}
