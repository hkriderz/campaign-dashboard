export type PhoneBankHeaderStats = {
  phoneBanks: number;
  totalCalls: number;
  surveyed: number;
  callHours: number;
  callers: number;
  uniqueCallers: number;
};

type Props = {
  stats: PhoneBankHeaderStats;
};

function fmtHours(h: number) {
  if (!h) return "0m";
  return h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(h * 60)}m`;
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs">
      <div className="text-gray-500 dark:text-gray-400">{label}</div>
      <div className="font-semibold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

export default function PhoneBankStats({ stats }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 min-w-0">
      <Chip label="Phone Banks" value={stats.phoneBanks.toLocaleString()} />
      <Chip label="Total Calls" value={stats.totalCalls.toLocaleString()} />
      <Chip label="Surveyed" value={stats.surveyed.toLocaleString()} />
      <Chip label="Call Time" value={fmtHours(stats.callHours)} />
      <Chip label="Callers" value={stats.callers.toLocaleString()} />
      <Chip label="Unique Callers" value={stats.uniqueCallers.toLocaleString()} />
    </div>
  );
}
