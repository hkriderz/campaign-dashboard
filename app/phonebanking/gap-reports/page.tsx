import { Suspense } from "react";
import { getPhonebankingTags } from "@/lib/campaign-tags";
import GapReportsClient from "./GapReportsClient";

export const dynamic = "force-dynamic";

export default function PhonebankGapReportsPage() {
  const tags = getPhonebankingTags().map((t) => ({ id: t.id, label: t.label }));

  return (
    <Suspense fallback={<p className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</p>}>
      <GapReportsClient tags={tags} />
    </Suspense>
  );
}
