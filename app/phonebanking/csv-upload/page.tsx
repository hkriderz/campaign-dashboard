import { Suspense } from "react";
import { getPhonebankingTags } from "@/lib/campaign-tags";
import CsvUploadHub from "./CsvUploadHub";

export const dynamic = "force-dynamic";

export default async function CsvUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const sp = await searchParams;
  const initialTagId = sp.tag?.trim() || "all";
  const tags = getPhonebankingTags().map((t) => ({ id: t.id, label: t.label }));

  return (
    <Suspense fallback={<p className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</p>}>
      <CsvUploadHub initialTagId={initialTagId} tags={tags} />
    </Suspense>
  );
}
