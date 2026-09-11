import type { TextTagQuestionBlock } from "@/lib/texting-tag-rollups";

function pct(num: number, den: number): string {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

type Props = {
  blocks: TextTagQuestionBlock[];
  contactCount?: number;
  emptyMessage?: string;
};

export default function TextTagRollup({ blocks, contactCount, emptyMessage }: Props) {
  if (!blocks.length) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {emptyMessage ?? "No contact tags recorded for this scope."}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {blocks.map((block) => {
        const denom = block.kind === "moved" && contactCount && contactCount > 0
          ? contactCount
          : block.taggedContacts;
        return (
          <div key={`${block.kind}:${block.question}`}>
            <div className="font-semibold text-gray-700 dark:text-gray-200">{block.question}</div>
            <div className="text-gray-600 dark:text-gray-400 text-sm">
              {block.taggedContacts.toLocaleString()} tagged
              {block.kind === "moved" && contactCount && contactCount > 0 ? (
                <span> · {contactCount.toLocaleString()} contacts</span>
              ) : null}
            </div>
            {block.lines.map((line) => (
              <div
                key={line.label}
                className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 py-px border-b border-gray-100/80 dark:border-gray-700/50 last:border-b-0"
              >
                <span className="tabular-nums font-medium text-gray-900 dark:text-gray-100 shrink-0">
                  {line.uniqueContacts.toLocaleString()}
                </span>
                <span className="text-gray-800 dark:text-gray-100 min-w-0 flex-1">{line.label}</span>
                <span className="text-gray-600 dark:text-gray-400 tabular-nums shrink-0">
                  {pct(line.uniqueContacts, denom)}
                </span>
                {block.kind === "support" && contactCount && contactCount > 0 ? (
                  <span className="text-gray-400 dark:text-gray-500 tabular-nums shrink-0 text-xs w-full sm:w-auto sm:ml-1">
                    {pct(line.uniqueContacts, contactCount)} of contacts
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
