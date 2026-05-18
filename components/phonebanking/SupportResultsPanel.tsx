import type { PhoneBankCsvRow } from "@/lib/types";
import { sumRows, ssRate } from "@/lib/csv-parser";

type Props = {
  rows: PhoneBankCsvRow[];
};

type FunnelStat = {
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
  dimmed?: boolean;
};

function funnelRow(label: string, value: number | string, opts: Partial<FunnelStat> = {}): FunnelStat {
  return { label, value, ...opts };
}

function pct(num: number, den: number): string {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

function StatBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pctNum = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-gray-600 dark:text-gray-300">{label}</span>
        <span className="font-semibold text-gray-800 dark:text-gray-100">
          {value} <span className="text-gray-400 dark:text-gray-500 font-normal">({pctNum}%)</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${pctNum}%` }}
        />
      </div>
    </div>
  );
}

export default function SupportResultsPanel({ rows }: Props) {
  if (!rows.length) return null;
  const total = sumRows(rows);

  const calls = total.callsAnswered;
  const correct = total.correctPerson;
  const surveyed = total.surveyed;
  const finalSS = total.finalSS;
  const finalWVT = total.finalWontVoteTraci;
  const finalUnd = total.finalUndecided;
  const finalSO = total.finalSO;

  const contactRate = pct(correct, calls);
  const surveyRate = pct(surveyed, correct);
  const ssRateStr = ssRate(total);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* Contact Funnel */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-5 bg-white dark:bg-gray-900 shadow-sm">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm mb-4">Contact Funnel</h3>
        <div className="space-y-3">
          <StatBar label="Calls Answered" value={calls} total={calls} color="bg-sky-400" />
          <StatBar label="Correct Person" value={correct} total={calls} color="bg-sky-500" />
          <StatBar label="Surveyed" value={surveyed} total={correct} color="bg-indigo-500" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-lg font-bold text-sky-600">{contactRate}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Contact Rate</p>
          </div>
          <div>
            <p className="text-lg font-bold text-indigo-600">{surveyRate}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Survey Rate</p>
          </div>
          <div>
            <p className="text-lg font-bold text-emerald-600">{ssRateStr}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">SS Rate</p>
          </div>
        </div>
      </div>

      {/* Final Results */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-5 bg-white dark:bg-gray-900 shadow-sm">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm mb-4">Final Results</h3>
        <div className="space-y-3">
          <StatBar label="Strong Support (SS)" value={finalSS} total={surveyed} color="bg-emerald-500" />
          <StatBar label="Won't Vote Traci" value={finalWVT} total={surveyed} color="bg-teal-400" />
          <StatBar label="Undecided" value={finalUnd} total={surveyed} color="bg-amber-400" />
          <StatBar label="Strong Oppose (SO)" value={finalSO} total={surveyed} color="bg-rose-500" />
        </div>
        <div className="mt-4 flex gap-4 justify-center flex-wrap">
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-600">{finalSS}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Strong Support</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-teal-600">{finalWVT}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Won&rsquo;t Vote Traci</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-rose-600">{finalSO}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Strong Oppose</p>
          </div>
        </div>
      </div>

      {/* Polling */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-5 bg-white dark:bg-gray-900 shadow-sm">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm mb-4">Polling</h3>
        <div className="space-y-3">
          <StatBar label="Faizah Malik" value={total.pollingFaizah} total={surveyed} color="bg-indigo-400" />
          <StatBar label="Undecided B" value={total.pollingUndecidedB} total={surveyed} color="bg-amber-400" />
          <StatBar label="Undecided" value={total.pollingUndecided} total={surveyed} color="bg-yellow-300" />
          <StatBar label="Traci Park" value={total.pollingTraci} total={surveyed} color="bg-rose-400" />
        </div>
      </div>

      {/* Faizah Pitch */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-5 bg-white dark:bg-gray-900 shadow-sm">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm mb-4">Faizah Pitch</h3>
        <div className="space-y-3">
          <StatBar label="Strong Support" value={total.pitchSS} total={surveyed} color="bg-emerald-400" />
          <StatBar label="Undecided B" value={total.pitchUndecidedB} total={surveyed} color="bg-amber-300" />
          <StatBar label="Undecided" value={total.pitchUndecided} total={surveyed} color="bg-yellow-300" />
          <StatBar label="Strong Oppose" value={total.pitchSO} total={surveyed} color="bg-rose-500" />
          <StatBar label="Hang Up" value={total.pitchHangUp} total={surveyed} color="bg-gray-300" />
        </div>
      </div>

      {/* Traci Violations (only if data present) */}
      {total.violationsYes + total.violationsUnsure + total.violationsNo > 0 && (
        <div className="rounded-xl border border-pink-200 dark:border-pink-800 p-5 bg-pink-50 dark:bg-pink-950/30 shadow-sm">
          <h3 className="font-semibold text-pink-800 dark:text-pink-300 text-sm mb-4">Traci Violations Rap</h3>
          <div className="space-y-3">
            <StatBar
              label="Should Disqualify"
              value={total.violationsYes}
              total={total.violationsYes + total.violationsUnsure + total.violationsNo}
              color="bg-emerald-500"
            />
            <StatBar
              label="Unsure"
              value={total.violationsUnsure}
              total={total.violationsYes + total.violationsUnsure + total.violationsNo}
              color="bg-amber-400"
            />
            <StatBar
              label="Should Not Disqualify"
              value={total.violationsNo}
              total={total.violationsYes + total.violationsUnsure + total.violationsNo}
              color="bg-rose-400"
            />
          </div>
        </div>
      )}

      {/* Vote Plan (only if data present) */}
      {total.votePlanA + total.votePlanB + total.votePlanC + total.votePlanD + total.votePlanE + total.votePlanF + total.votePlanG > 0 && (
        <div className="rounded-xl border border-cyan-200 dark:border-cyan-800 p-5 bg-cyan-50 dark:bg-cyan-950/30 shadow-sm">
          <h3 className="font-semibold text-cyan-800 dark:text-cyan-300 text-sm mb-4">Vote Plan</h3>
          {(() => {
            const vtotal =
              total.votePlanA + total.votePlanB + total.votePlanC + total.votePlanD +
              total.votePlanE + total.votePlanF + total.votePlanG;
            const plans = [
              { label: "A – Filled ballot on phone", value: total.votePlanA },
              { label: "B – Vote by mail", value: total.votePlanB },
              { label: "C – Early in person", value: total.votePlanC },
              { label: "D – Election day", value: total.votePlanD },
              { label: "E – Plan, no photo", value: total.votePlanE },
              { label: "F – No plan", value: total.votePlanF },
              { label: "G – Already voted", value: total.votePlanG },
            ];
            return (
              <div className="space-y-2">
                {plans.map((p) => (
                  <StatBar key={p.label} label={p.label} value={p.value} total={vtotal} color="bg-cyan-500" />
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
