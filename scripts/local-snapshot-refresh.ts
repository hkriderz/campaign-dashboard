/**
 * Rebuild BQ snapshots against a running `next dev` server. No snapshot secret.
 * Refuses to run when NODE_ENV=production.
 *
 *   npx tsx scripts/local-snapshot-refresh.ts
 *   npx tsx scripts/local-snapshot-refresh.ts --tag qc-nithya
 *   npx tsx scripts/local-snapshot-refresh.ts --all
 */
const BASE = process.env.CAMPAIGN_DASHBOARD_LOCAL_URL?.trim() || "http://localhost:3000";

function parseArgs(argv: string[]): { refreshAll: boolean; tagId: string } {
  let refreshAll = false;
  let tagId = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--all") refreshAll = true;
    if (arg === "--tag") tagId = (argv[i + 1] ?? "").trim();
  }
  return { refreshAll, tagId };
}

async function postRefresh(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${BASE}/api/phonebanking/bq-snapshot-refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Refresh failed (${res.status})`);
  }
  return data;
}

async function listQcTagIds(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/campaign-tags`, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as {
    activePhonebankingTags?: { id: string }[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? `Could not list tags (${res.status})`);
  }
  return (data.activePhonebankingTags ?? []).map((t) => t.id).filter((id) => id.startsWith("qc-"));
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("local-snapshot-refresh is for next dev only.");
  }

  const { refreshAll, tagId } = parseArgs(process.argv.slice(2));
  if (refreshAll) {
    console.log(`Refreshing all phone-banking tags via ${BASE} …`);
    console.log(JSON.stringify(await postRefresh({ refreshAll: true, clear: false }), null, 2));
    return;
  }

  if (tagId) {
    console.log(`Refreshing ${tagId} via ${BASE} …`);
    console.log(JSON.stringify(await postRefresh({ tagId, clear: false }), null, 2));
    return;
  }

  const qcIds = await listQcTagIds();
  if (qcIds.length === 0) {
    throw new Error("No QC tags found. Pass --tag <id> or --all.");
  }

  console.log(`Refreshing QC tags: ${qcIds.join(", ")}`);
  for (const id of qcIds) {
    console.log(`→ ${id}`);
    const result = await postRefresh({ tagId: id, clear: false });
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
