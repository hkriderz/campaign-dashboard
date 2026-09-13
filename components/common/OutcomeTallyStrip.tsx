import { GENERIC_OUTCOME_LABELS } from "@/lib/survey-answer-consolidation";

export type OutcomeTallyStripProps = {
  strongSupport: number;
  undecided: number;
  strongOppose: number;
  knocks?: number;
  contacts?: number;
  className?: string;
};

function formatCount(value: number): string {
  return value.toLocaleString();
}

/**
 * Compact SS / U / SO strip. Labels stay generic; candidate scope is the page filter.
 */
export default function OutcomeTallyStrip({
  strongSupport,
  undecided,
  strongOppose,
  knocks,
  contacts,
  className,
}: OutcomeTallyStripProps) {
  const items: Array<{ label: string; value: number; tone?: "ss" | "so" }> = [];
  if (knocks != null) items.push({ label: "Doors knocked", value: knocks });
  if (contacts != null) items.push({ label: "Contacts", value: contacts });
  items.push(
    { label: GENERIC_OUTCOME_LABELS.strongSupport, value: strongSupport, tone: "ss" },
    { label: GENERIC_OUTCOME_LABELS.undecided, value: undecided },
    { label: GENERIC_OUTCOME_LABELS.strongOppose, value: strongOppose, tone: "so" }
  );

  return (
    <ul
      className={[
        "flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {items.map((item, index) => (
        <li key={item.label} className="flex items-baseline gap-1.5">
          {index > 0 ? (
            <span className="text-gray-300 dark:text-gray-600 select-none" aria-hidden>
              ·
            </span>
          ) : null}
          <span
            className={[
              "tabular-nums font-semibold",
              item.tone === "ss"
                ? "text-emerald-700 dark:text-emerald-300"
                : item.tone === "so"
                  ? "text-rose-700 dark:text-rose-300"
                  : "text-gray-900 dark:text-gray-100",
            ].join(" ")}
          >
            {formatCount(item.value)}
          </span>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
