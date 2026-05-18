/**
 * Merge phonebanker rows that are probably the same person when STW shows variant names
 * (e.g. "Car5" vs "Carmen Acosta") without relying solely on string normalization.
 *
 * Clustering is **per campaign day** (slice): names are never merged across dates or campaigns.
 */

import { normalizeName } from "./csv-parser";
import { canonicalizePhonebankerName } from "./phonebanker-name";
import { makeSliceKey, normalizeDateToIso } from "./slice-key";
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

function prefixKeysMergeable(ka: string, kb: string): boolean {
  if (!ka || !kb) return false;
  const [s, l] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (s.length < 3) return false;
  if (!l.startsWith(s)) return false;
  if (s.length === 3 && l.length - s.length > 6) return false;
  return true;
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

/** True when two canonical display names likely refer to one dialer. */
export function phonebankerLabelsLikelySamePerson(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  const k1 = primaryDedupeKey(a);
  const k2 = primaryDedupeKey(b);
  if (k1 === k2) return true;

  if (ta.length >= 2 && tb.length >= 2) {
    const fa = fullAlphaCompact(a);
    const fb = fullAlphaCompact(b);
    if (fa === fb) return true;
    if (fa.length >= 6 && fb.length >= 6 && levenshtein(fa, fb) <= 2) return true;
    return false;
  }

  if (prefixKeysMergeable(k1, k2)) return true;
  const shortK = Math.min(k1.length, k2.length);
  if (shortK >= 4 && levenshtein(k1, k2) <= 2) return true;
  return false;
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
    add(makeSliceKey(r.campaignName, r.callDate), r.phonebankerName);
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
  rawOrCanonicalName: string
): string {
  const sk = makeSliceKey(campaignName, callDate);
  const canonical = canonicalizePhonebankerName(rawOrCanonicalName);
  const m = repMapBySlice.get(sk);
  if (!m) return canonical;
  return m.get(canonical) ?? canonical;
}

export function mergeTagDailyCallerStats(rows: TagDailyCallerStat[]): TagDailyCallerStat[] {
  const map = new Map<string, TagDailyCallerStat>();
  for (const r of rows) {
    const key = `${r.campaignId}::${r.callDate}::${r.phonebankerName}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r });
    } else {
      prev.callsAnswered += r.callsAnswered;
      prev.talkingToCorrectPerson += r.talkingToCorrectPerson;
      prev.surveyed += r.surveyed;
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
