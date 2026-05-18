import { listTombstoneEntries } from "@/lib/csv-slice-tombstones";
import { loadDailyCallerSnapshot } from "@/lib/bq-snapshot-store";
import { makeSliceKey } from "@/lib/slice-key";
import type { TagDailyCallerStat } from "@/lib/types";

export type TombstoneBqOverlapRow = {
  sliceKey: string;
  phoneBankName?: string;
  isoDate?: string;
};

/**
 * Tombstoned CSV slices that still appear in the on-disk daily-caller snapshot for this tag
 * (BigQuery refresh brought them back in BQ while the user had deleted CSV locally).
 */
export function getTombstoneBqOverlapForTag(tagId: string): TombstoneBqOverlapRow[] {
  const snap = loadDailyCallerSnapshot(tagId);
  const bqSliceKeys = new Set<string>();
  if (snap?.rows?.length) {
    for (const row of snap.rows as TagDailyCallerStat[]) {
      bqSliceKeys.add(makeSliceKey(row.campaignName, row.callDate));
    }
  }
  const tombEntries = listTombstoneEntries(tagId);
  const out: TombstoneBqOverlapRow[] = [];
  for (const t of tombEntries) {
    if (!bqSliceKeys.has(t.sliceKey)) continue;
    out.push({
      sliceKey: t.sliceKey,
      phoneBankName: t.phoneBankName,
      isoDate: t.isoDate,
    });
  }
  return out;
}
