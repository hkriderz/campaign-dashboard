/**
 * User-configurable 2×2 survey sections for the Daily Aggregate card (below static metrics).
 * Persisted in localStorage per tag.
 */

import { questionCanonicalGroupKey } from "./survey-i18n/column-label-gloss";
import type { SurveyScriptProfile } from "./types";

export type AggregateSlotConfig =
  | { kind: "none" }
  | { kind: "preset"; preset: "polling" | "final" }
  /** Logical script block; BQ names for this date are resolved via `questionCanonicalGroupKey`. */
  | { kind: "question"; canonicalKey: string };

export type DailyAggregateLayoutV1 = {
  version: 1;
  row2Left: AggregateSlotConfig;
  row2Right: AggregateSlotConfig;
  row3Left: AggregateSlotConfig;
  row3Right: AggregateSlotConfig;
};

export const DEFAULT_DAILY_AGGREGATE_LAYOUT: DailyAggregateLayoutV1 = {
  version: 1,
  row2Left: { kind: "preset", preset: "polling" },
  row2Right: { kind: "none" },
  row3Left: { kind: "preset", preset: "final" },
  row3Right: { kind: "none" },
};

export const DAILY_AGGREGATE_LAYOUT_STORAGE_PREFIX = "campaign-dashboard:daily-aggregate-layout:v1:";

export function layoutStorageKey(tagId: string): string {
  return `${DAILY_AGGREGATE_LAYOUT_STORAGE_PREFIX}${tagId}`;
}

function normalizeQuestionSlot(
  o: Record<string, unknown>,
  profile?: SurveyScriptProfile
): { kind: "question"; canonicalKey: string } | null {
  if (o.kind !== "question") return null;
  if (typeof o.canonicalKey === "string" && o.canonicalKey.trim()) {
    return { kind: "question", canonicalKey: o.canonicalKey.trim() };
  }
  if (Array.isArray(o.questionNames)) {
    const names = o.questionNames
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length) {
      const keys = [...new Set(names.map((n) => questionCanonicalGroupKey(n, profile)))];
      const canonicalKey =
        keys.length === 1 ? keys[0]! : questionCanonicalGroupKey(names[0]!, profile);
      return { kind: "question", canonicalKey };
    }
  }
  if (typeof o.questionName === "string" && o.questionName.trim()) {
    const q = o.questionName.trim();
    return { kind: "question", canonicalKey: questionCanonicalGroupKey(q, profile) };
  }
  return null;
}

function parseSlotConfig(x: unknown, profile?: SurveyScriptProfile): AggregateSlotConfig | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.kind === "none") return { kind: "none" };
  if (o.kind === "preset" && (o.preset === "polling" || o.preset === "final")) {
    return { kind: "preset", preset: o.preset };
  }
  return normalizeQuestionSlot(o, profile);
}

export function parseDailyAggregateLayout(
  raw: string | null,
  opts?: { surveyScriptProfile?: SurveyScriptProfile }
): DailyAggregateLayoutV1 | null {
  if (!raw?.trim()) return null;
  const profile = opts?.surveyScriptProfile;
  try {
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object") return null;
    const o = j as Record<string, unknown>;
    if (o.version !== 1) return null;
    const keys = ["row2Left", "row2Right", "row3Left", "row3Right"] as const;
    const slots: Partial<Record<(typeof keys)[number], AggregateSlotConfig>> = {};
    for (const k of keys) {
      const slot = parseSlotConfig(o[k], profile);
      if (!slot) return null;
      slots[k] = slot;
    }
    return {
      version: 1,
      row2Left: slots.row2Left!,
      row2Right: slots.row2Right!,
      row3Left: slots.row3Left!,
      row3Right: slots.row3Right!,
    };
  } catch {
    return null;
  }
}

export const SLOT_KEYS = ["row2Left", "row2Right", "row3Left", "row3Right"] as const;
export type AggregateSlotKey = (typeof SLOT_KEYS)[number];

export const SLOT_LABELS: Record<AggregateSlotKey, string> = {
  row2Left: "Row 2 — left",
  row2Right: "Row 2 — right",
  row3Left: "Row 3 — left",
  row3Right: "Row 3 — right",
};
