"use client";

import { formatStrongSupportCell } from "@/lib/strong-support-from-survey";

type Props = {
  total: number;
  synthesized?: number;
  onOpen?: () => void;
  className?: string;
};

export default function SynthesizedCountLabel({
  total,
  synthesized = 0,
  onOpen,
  className,
}: Props) {
  const main = total.toLocaleString();
  if (synthesized <= 0) {
    return <span className={className}>{main}</span>;
  }

  const synthText = `${synthesized.toLocaleString()} Synthesized`;
  if (!onOpen) {
    return <span className={className}>{formatStrongSupportCell(total, synthesized)}</span>;
  }

  return (
    <span className={className}>
      {main}{" "}
      <button
        type="button"
        onClick={onOpen}
        className="underline decoration-dotted underline-offset-2 text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-indigo-100 font-medium"
        aria-haspopup="dialog"
        aria-label={`Show ${synthText}`}
      >
        ({synthText})
      </button>
    </span>
  );
}
