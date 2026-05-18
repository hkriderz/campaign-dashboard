import { resolvePdiToolsCredentials } from "@/lib/pdi-tools/resolve-pdi-credentials";
import type { CreatedFlagInstanceRow } from "./flag-instances";
import type { PdiFlagPayloadItem } from "./types";
import { PDI_BATCH_SIZE, PDI_RETRY_BATCH_SIZE } from "./constants";
import { formatPdiFlagEntryDate } from "./format-pdi-flag-entry-date";
import type { SyncLogger } from "./logger";

const PDI_BASE_URL = "https://api.bluevote.com";

let cachedToken: { token: string; exp: number } | null = null;

async function getSessionToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.exp > now + 60_000) {
    return cachedToken.token;
  }

  const c = resolvePdiToolsCredentials();
  if (!c.pdiUsername || !c.pdiPassword || !c.pdiApiToken) {
    throw new Error(
      "PDI credentials missing. Upload credentials on the PDI Tools page or set PDI_* in .env.local."
    );
  }

  const res = await fetch(`${PDI_BASE_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Username: c.pdiUsername,
      Password: c.pdiPassword,
      ApiToken: c.pdiApiToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`PDI login failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { AccessToken?: string; ExpirationDate?: string };
  if (!data.AccessToken) {
    throw new Error("PDI login response missing AccessToken");
  }

  const exp = data.ExpirationDate ? Date.parse(data.ExpirationDate) : now + 3_600_000;
  cachedToken = { token: data.AccessToken, exp };
  return data.AccessToken;
}

function normalizeFlagPayload(items: PdiFlagPayloadItem[]): PdiFlagPayloadItem[] {
  return items.map((item) => ({
    ...item,
    flagEntryDate: formatPdiFlagEntryDate(item.flagEntryDate),
  }));
}

async function postFlagBatch(batch: PdiFlagPayloadItem[]): Promise<unknown> {
  const token = await getSessionToken();
  const body = normalizeFlagPayload(batch);

  const res = await fetch(`${PDI_BASE_URL}/flags`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PDI create_flags failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }

  const text = await res.text().catch(() => "");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Parse PDI `POST /flags` JSON body into per-row instance IDs (order-aligned with `batch`).
 */
export function extractInstanceIds(result: unknown, batch: PdiFlagPayloadItem[]): string[] {
  try {
    if (result == null) return batch.map(() => "");
    let rows: unknown[] = [];
    if (Array.isArray(result)) {
      rows = result;
    } else if (typeof result === "object") {
      const o = result as Record<string, unknown>;
      if (Array.isArray(o.data)) rows = o.data;
      else rows = [result];
    }
    const ids: string[] = [];
    for (let idx = 0; idx < batch.length; idx++) {
      const row = rows[idx];
      if (!row || typeof row !== "object") {
        ids.push("");
        continue;
      }
      const rec = row as Record<string, unknown>;
      const id = rec.id ?? rec.flagInstanceId ?? rec.FlagInstanceId ?? rec.flagId;
      ids.push(id != null ? String(id) : "");
    }
    return ids;
  } catch {
    return batch.map(() => "");
  }
}

export async function deleteFlagInstance(instanceId: string): Promise<void> {
  const token = await getSessionToken();
  const url = `${PDI_BASE_URL}/flags/${encodeURIComponent(instanceId)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`PDI delete flag failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }
}

export type PostFlagsResult = {
  successCount: number;
  failCount: number;
  newLedgerEntries: Array<{ pdi_id: string; flag_code: string; flag_date: string }>;
  newFlagInstances: CreatedFlagInstanceRow[];
};

export async function postFlagsToPdi(
  payload: PdiFlagPayloadItem[],
  flagIdToCode: Map<string, string>,
  runId: string,
  log: SyncLogger
): Promise<PostFlagsResult> {
  let successCount = 0;
  let failCount = 0;
  const newLedgerEntries: Array<{ pdi_id: string; flag_code: string; flag_date: string }> = [];
  const newFlagInstances: CreatedFlagInstanceRow[] = [];

  const recordBatch = (batch: PdiFlagPayloadItem[], result: unknown) => {
    const instanceIds = extractInstanceIds(result, batch);
    const nowTs = new Date().toISOString();
    for (let idx = 0; idx < batch.length; idx++) {
      const item = batch[idx]!;
      const code = flagIdToCode.get(item.flagId) ?? item.flagId;
      const dateStr = item.flagEntryDate.slice(0, 10);
      newLedgerEntries.push({
        pdi_id: item.pdiId,
        flag_code: code,
        flag_date: dateStr,
      });
      const iid = instanceIds[idx]?.trim();
      if (iid) {
        newFlagInstances.push({
          run_id: runId,
          instance_id: iid,
          pdi_id: item.pdiId,
          flag_id: item.flagId,
          flag_code: code,
          flag_date: dateStr,
          created_at: nowTs,
        });
      }
    }
  };

  log.info("=".repeat(70));
  log.info(`Posting ${payload.length} records to PDI in batches of ${PDI_BATCH_SIZE}...`);
  log.info("=".repeat(70));

  for (let i = 0; i < payload.length; i += PDI_BATCH_SIZE) {
    const chunk = payload.slice(i, i + PDI_BATCH_SIZE);
    const batchNum = Math.floor(i / PDI_BATCH_SIZE) + 1;
    log.info(`Batch ${batchNum}: Posting records ${i} -> ${i + chunk.length} (${chunk.length} items)`);

    try {
      const result = await postFlagBatch(chunk);
      log.info(`✓ Batch success`);
      successCount += chunk.length;
      recordBatch(chunk, result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`✗ Batch failed: ${msg.slice(0, 200)}`);
      failCount += chunk.length;
      log.info(`  Retrying batch in smaller batches of ${PDI_RETRY_BATCH_SIZE}...`);

      for (let j = 0; j < chunk.length; j += PDI_RETRY_BATCH_SIZE) {
        const small = chunk.slice(j, j + PDI_RETRY_BATCH_SIZE);
        try {
          const result = await postFlagBatch(small);
          log.info(`    ✓ Small batch ${j}-${j + small.length}`);
          successCount += small.length;
          failCount -= small.length;
          recordBatch(small, result);
        } catch (e2) {
          const msg2 = e2 instanceof Error ? e2.message : String(e2);
          log.error(`    ✗ Small batch ${j}-${j + small.length} failed: ${msg2.slice(0, 100)}`);
        }
      }
    }
  }

  return { successCount, failCount, newLedgerEntries, newFlagInstances };
}
