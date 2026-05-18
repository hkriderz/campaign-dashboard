type StatCardProps = {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
};

export default function StatCard({
  label,
  value,
  sub,
  accent = false,
}: StatCardProps) {
  return (
    <div
      className={[
        "dash-card flex flex-col gap-1 relative",
        accent ? "dash-card-glow border-indigo-500/30" : "",
      ].join(" ")}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
        {label}
      </p>
      <p className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
        {value}
      </p>
      {sub && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{sub}</p>
      )}
    </div>
  );
}
