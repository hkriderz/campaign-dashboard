/**
 * Last wide PB report column headers per tag (for "similar to other PBs" matching hints).
 */
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

function safeTag(tag: string): string {
  return tag.replace(/[^a-z0-9_-]/gi, "");
}

function fp(tag: string): string {
  return path.join(DATA_DIR, `stw-wide-reference-headers-${safeTag(tag)}.json`);
}

export function saveWideReferenceHeaders(tag: string, headers: string[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(fp(tag), JSON.stringify({ headers }, null, 2), "utf-8");
}

export function loadWideReferenceHeaders(tag: string): string[] | null {
  const p = fp(tag);
  if (!fs.existsSync(p)) return null;
  try {
    const o = JSON.parse(fs.readFileSync(p, "utf-8")) as { headers?: string[] };
    return Array.isArray(o.headers) ? o.headers : null;
  } catch {
    return null;
  }
}
