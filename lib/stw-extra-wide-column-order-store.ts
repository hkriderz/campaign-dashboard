/**
 * Per-tag stable column order for wide-import "extra" headers (not mapped to built-in fields).
 * New headers append in first-seen order from each import.
 */
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

function safeTag(tag: string): string {
  return tag.replace(/[^a-z0-9_-]/gi, "");
}

function fp(tag: string): string {
  return path.join(DATA_DIR, `stw-extra-wide-column-order-${safeTag(tag)}.json`);
}

export function loadExtraWideColumnOrder(tag: string): string[] {
  const p = fp(tag);
  if (!fs.existsSync(p)) return [];
  try {
    const o = JSON.parse(fs.readFileSync(p, "utf-8")) as { order?: string[] };
    return Array.isArray(o.order) ? o.order.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function mergeExtraWideColumnOrder(tag: string, incomingOrder: string[]): void {
  if (!incomingOrder.length) return;
  const seen = new Set(loadExtraWideColumnOrder(tag));
  const next = [...seen];
  for (const h of incomingOrder) {
    const t = h.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    next.push(t);
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(fp(tag), JSON.stringify({ order: next }, null, 2), "utf-8");
}
