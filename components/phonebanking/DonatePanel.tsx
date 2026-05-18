import type { PhoneBankCsvRow } from "@/lib/types";
import { sumRows } from "@/lib/csv-parser";

type Props = {
  rows: PhoneBankCsvRow[];
};

function pct(num: number, den: number): string {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

type DonateStatProps = {
  label: string;
  value: number;
  total: number;
  color: string;
  textColor: string;
};

function DonateStat({ label, value, total, color, textColor }: DonateStatProps) {
  const pctNum = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className={`rounded-lg p-4 ${color} flex flex-col gap-1`}>
      <p className={`text-2xl font-bold ${textColor}`}>{value}</p>
      <p className={`text-xs font-medium ${textColor} opacity-80`}>{label}</p>
      <p className={`text-xs ${textColor} opacity-60`}>{pctNum}% of surveyed</p>
      <div className="h-1 rounded-full bg-white/30 mt-1">
        <div
          className="h-full rounded-full bg-white/70 transition-all"
          style={{ width: `${pctNum}%` }}
        />
      </div>
    </div>
  );
}

export default function DonatePanel({ rows }: Props) {
  if (!rows.length) return null;
  const total = sumRows(rows);
  const surveyed = total.surveyed;

  const donateTotal = total.donateNow + total.donateLater + total.donateUndecided + total.donateWont;
  if (!donateTotal) return null;

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-amber-800 dark:text-amber-300 text-sm">Donate</h3>
        <span className="text-xs text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full">
          {donateTotal} responses · {pct(total.donateNow + total.donateLater, surveyed)} will donate
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <DonateStat
          label="Will Donate Now"
          value={total.donateNow}
          total={surveyed}
          color="bg-emerald-500"
          textColor="text-white"
        />
        <DonateStat
          label="Will Donate Later"
          value={total.donateLater}
          total={surveyed}
          color="bg-teal-500"
          textColor="text-white"
        />
        <DonateStat
          label="Undecided"
          value={total.donateUndecided}
          total={surveyed}
          color="bg-amber-400"
          textColor="text-white"
        />
        <DonateStat
          label="Will Not Donate"
          value={total.donateWont}
          total={surveyed}
          color="bg-gray-400"
          textColor="text-white"
        />
      </div>
      <div className="mt-3 text-xs text-amber-700 dark:text-amber-300">
        Disclaimer read: Yes — {total.disclaimerYes} &nbsp;|&nbsp; No — {total.disclaimerNo}
      </div>
    </div>
  );
}
