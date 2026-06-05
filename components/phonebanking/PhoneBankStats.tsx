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
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
      <StatCard
        label="Total Calls"
        value={campaign.totalCalls.toLocaleString()}
        accent
      />
      <StatCard
        label="Dials"
        value={campaign.totalDials.toLocaleString()}
      />
      {campaign.totalSurveyed > 0 ? (
        <StatCard
          label="Surveyed"
          value={campaign.totalSurveyed.toLocaleString()}
        />
      ) : null}
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
