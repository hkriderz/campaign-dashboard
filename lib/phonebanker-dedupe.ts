/**
 * Merge phonebanker rows that are probably the same person when STW shows variant names
 * (e.g. typo last names "Gabriel Guerrero" / "Gabriel Guerroro").
 *
 * Clustering is **per campaign day** (slice): names are never merged across dates or campaigns.
 * First-only labels never merge with first+last (Brenda ≠ Brenda Salas). First-name fuzzy
 * matching is disabled so similar first names (Brenda / Freyda) stay distinct.
 */

import { normalizeName } from "./csv-parser";
import { canonicalizePhonebankerName } from "./phonebanker-name";
import { dailyCallerSliceKey, makeBqSliceKey, makeSliceKey, normalizeDateToIso } from "./slice-key";
import type { PhoneBankCsvRow, PhonebankerQuestionResponseStat, TagDailyCallerStat } from "./types";

/** Union-find for transitive clustering. */
class UnionFind {
  private readonly parent: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }

  find(i: number): number {
    if (this.parent[i] !== i) this.parent[i] = this.find(this.parent[i]);
    return this.parent[i];
  }

  union(i: number, j: number): void {
    const ri = this.find(i);
    const rj = this.find(j);
    if (ri !== rj) this.parent[rj] = ri;
  }
}

function fullAlphaCompact(s: string): string {
  return s.replace(/[^a-z]/gi, "").toLowerCase();
}

function tokens(canonicalName: string): string[] {
  return canonicalName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** First-word alpha key, or full-string alpha for empty first word. */
export function primaryDedupeKey(canonicalName: string): string {
  const t = tokens(canonicalName);
  if (t.length === 0) return "";
  const first = t[0]!.replace(/[^a-z]/gi, "").toLowerCase();
  if (first.length >= 2) return first;
  return fullAlphaCompact(canonicalName);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[n]!;
}

function lastNameKey(nameTokens: string[]): string {
  if (nameTokens.length < 2) return "";
  return nameTokens[nameTokens.length - 1]!.replace(/[^a-z]/gi, "").toLowerCase();
}

/** True when both sides have last names that match or are a small typo apart. */
function lastNamesCompatible(ta: string[], tb: string[]): boolean {
  const la = lastNameKey(ta);
  const lb = lastNameKey(tb);
  if (!la || !lb) return false;
  if (la === lb) return true;
  const shortLen = Math.min(la.length, lb.length);
  if (shortLen >= 4 && levenshtein(la, lb) <= 2) return true;
  return false;
}

/**
 * True when two canonical display names likely refer to one dialer.
 * Never merges first-only with first+last, or similar-but-different first names.
 */
export function phonebankerLabelsLikelySamePerson(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = tokens(a);
  const tb = tokens(b);

  // Different name shape (first-only vs first+last) → never merge.
  if (ta.length !== tb.length && (ta.length === 1 || tb.length === 1)) {
    return false;
  }

  const k1 = primaryDedupeKey(a);
  const k2 = primaryDedupeKey(b);

  // Both multi-token: require compatible last names before any first-name logic.
  if (ta.length >= 2 && tb.length >= 2) {
    if (!lastNamesCompatible(ta, tb)) return false;
    if (k1 === k2) return true;
    const fa = fullAlphaCompact(a);
    const fb = fullAlphaCompact(b);
    if (fa === fb) return true;
    if (fa.length >= 6 && fb.length >= 6 && levenshtein(fa, fb) <= 2) return true;
    return false;
  }

  // Both single-token: exact first-name key only (no fuzzy Brenda ≈ Freyda).
  return Boolean(k1) && k1 === k2;
}

/** Prefer the richest label (more letters, fewer digits, longer). */
export function pickRepresentativeDisplayName(cluster: string[]): string {
  const uniq = [...new Set(cluster.filter(Boolean))];
  if (uniq.length === 0) return "";
  if (uniq.length === 1) return uniq[0]!;
  const score = (s: string) => {
    const letters = (s.match(/[a-z]/gi) ?? []).length;
    const digits = (s.match(/\d/g) ?? []).length;
    return letters * 100 - digits * 40 + s.length;
  };
  uniq.sort((x, y) => {
    const ds = score(y) - score(x);
    if (ds !== 0) return ds;
    return x.localeCompare(y);
  });
  return uniq[0]!;
}

/**
 * Map each canonical name in a slice to a single representative display string.
 */
export function buildPhonebankerRepresentativeMap(canonicalNames: string[]): Map<string, string> {
  const names = [...new Set(canonicalNames.map((n) => n.trim()).filter(Boolean))];
  const n = names.length;
  const uf = new UnionFind(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (phonebankerLabelsLikelySamePerson(names[i]!, names[j]!)) uf.union(i, j);
    }
  }
  const groups = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(names[i]!);
  }
  const out = new Map<string, string>();
  for (const g of groups.values()) {
    const rep = pickRepresentativeDisplayName(g);
    for (const name of g) out.set(name, rep);
  }
  return out;
}

/**
 * One representative map per slice key (`makeSliceKey`), built from BQ + CSV names on that slice.
 */
export function buildPhonebankerRepMapBySlice(
  bqCallers: TagDailyCallerStat[],
  csvRows: PhoneBankCsvRow[]
): Map<string, Map<string, string>> {
  const namesBySlice = new Map<string, Set<string>>();

  const add = (sliceKey: string, rawName: string) => {
    const c = canonicalizePhonebankerName(rawName);
    if (!c) return;
    if (!namesBySlice.has(sliceKey)) namesBySlice.set(sliceKey, new Set());
    namesBySlice.get(sliceKey)!.add(c);
  };

  for (const r of bqCallers) {
    add(dailyCallerSliceKey(r), r.phonebankerName);
    const nameKey = makeSliceKey(r.campaignName, r.callDate);
    if (nameKey !== dailyCallerSliceKey(r)) add(nameKey, r.phonebankerName);
  }
  for (const r of csvRows) {
    const iso = normalizeDateToIso(r.date);
    if (!iso) continue;
    add(makeSliceKey(r.phoneBankName, iso), normalizeName(r.callerName));
  }

  const out = new Map<string, Map<string, string>>();
  for (const [sk, set] of namesBySlice) {
    out.set(sk, buildPhonebankerRepresentativeMap([...set]));
  }
  return out;
}

export function resolvePhonebankerRep(
  repMapBySlice: Map<string, Map<string, string>>,
  campaignName: string,
  callDate: string,
  rawOrCanonicalName: string,
  campaignId?: string
): string {
  const canonical = canonicalizePhonebankerName(rawOrCanonicalName);
  const bqSk = makeBqSliceKey(campaignId ?? "", campaignName, callDate);
  const nameSk = makeSliceKey(campaignName, callDate);
  const m = repMapBySlice.get(bqSk) ?? repMapBySlice.get(nameSk);
  if (!m) return canonical;
  return m.get(canonical) ?? canonical;
}

export function mergeTagDailyCallerStats(rows: TagDailyCallerStat[]): TagDailyCallerStat[] {
  const map = new Map<string, TagDailyCallerStat>();
  for (const r of rows) {
    const key = `${r.campaignId}::${r.callDate}::${r.phonebankerName}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        ...r,
        totalCalls: r.totalCalls ?? 0,
        strongSupport: r.strongSupport ?? 0,
        strongSupportSynthesized: r.strongSupportSynthesized ?? 0,
      });
    } else {
      prev.totalCalls = Math.max(prev.totalCalls ?? 0, r.totalCalls ?? 0);
      prev.callsAnswered += r.callsAnswered;
      prev.talkingToCorrectPerson += r.talkingToCorrectPerson;
      prev.surveyed += r.surveyed;
      prev.strongSupport = (prev.strongSupport ?? 0) + (r.strongSupport ?? 0);
      prev.strongSupportSynthesized =
        (prev.strongSupportSynthesized ?? 0) + (r.strongSupportSynthesized ?? 0);
      prev.numDials += r.numDials;
      prev.totalCallSeconds += r.totalCallSeconds;
      prev.totalDialerSeconds += r.totalDialerSeconds;
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.callDate !== b.callDate) return b.callDate.localeCompare(a.callDate);
    if (a.campaignName !== b.campaignName) return a.campaignName.localeCompare(b.campaignName);
    return a.phonebankerName.localeCompare(b.phonebankerName);
  });
}

export function mergePhonebankerQuestionStats(
  rows: PhonebankerQuestionResponseStat[]
): PhonebankerQuestionResponseStat[] {
  const map = new Map<string, PhonebankerQuestionResponseStat>();
  for (const r of rows) {
    const key = `${r.campaignId}::${r.callDate}::${r.phonebankerName}::${r.questionName}::${r.answerValue}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r });
    } else {
      prev.responseCount += r.responseCount;
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.callDate !== b.callDate) return b.callDate.localeCompare(a.callDate);
    if (a.campaignName !== b.campaignName) return a.campaignName.localeCompare(b.campaignName);
    if (a.phonebankerName !== b.phonebankerName) return a.phonebankerName.localeCompare(b.phonebankerName);
    if (a.questionName !== b.questionName) return a.questionName.localeCompare(b.questionName);
    return a.answerValue.localeCompare(b.answerValue);
  });
}
