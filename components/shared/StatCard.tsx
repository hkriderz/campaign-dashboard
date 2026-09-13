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
        accent ? "border-[var(--section-accent)]" : "",
      ].join(" ")}
    >
      <p className="section-kicker">
        {label}
      </p>
      <p className="font-display text-2xl font-semibold tracking-tight text-[var(--section-ink)]">
        {value}
      </p>
      {sub && (
        <p className="text-xs text-[var(--section-muted)]">{sub}</p>
      )}
    </div>
  );
}
