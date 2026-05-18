import StatCard from "@/components/shared/StatCard";
import type { PhoneBankSummary } from "@/lib/types";

type Props = {
  campaign: PhoneBankSummary;
};

function fmtHours(h: number) {
  return h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(h * 60)}m`;
}

export default function PhoneBankStats({ campaign }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <StatCard
        label="Total Dials"
        value={campaign.totalDials.toLocaleString()}
        accent
      />
      <StatCard
        label="Call Time"
        value={fmtHours(campaign.totalHours)}
        sub={`${campaign.totalSeconds.toLocaleString()}s total`}
      />
      <StatCard
        label="Unique Callers"
        value={campaign.uniqueCallers.toLocaleString()}
      />
      <StatCard
        label="Date Range"
        value={campaign.firstCallDate ?? "—"}
        sub={campaign.lastCallDate ? `through ${campaign.lastCallDate}` : undefined}
      />
    </div>
  );
}
