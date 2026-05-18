/** Browser helpers for `/api/phonebanking/tombstone-clear`. */

export async function clearTombstonesForTag(tagId: string, sliceKeys: string[]): Promise<number> {
  const res = await fetch("/api/phonebanking/tombstone-clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: tagId, sliceKeys }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    data?: { cleared?: number };
  };
  if (!res.ok || !json.ok) throw new Error(json.error ?? "Clear failed");
  return json.data?.cleared ?? sliceKeys.length;
}

/** Empty the tag’s full removal log (all tombstones). Hidden slices reappear on the dashboard. */
export async function clearAllTombstonesForTag(tagId: string): Promise<number> {
  const res = await fetch("/api/phonebanking/tombstone-clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: tagId, clearAll: true }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    data?: { cleared?: number };
  };
  if (!res.ok || !json.ok) throw new Error(json.error ?? "Clear removal log failed");
  return json.data?.cleared ?? 0;
}
