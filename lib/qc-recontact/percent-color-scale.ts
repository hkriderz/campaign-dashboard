/**
 * Shared percent cell color bands for canvasser / Lit QC / phonebanker overview tables.
 * Persisted in localStorage so the three tables stay in sync.
 */

export type PercentColorTone = "darkWarm" | "lightWarm" | "none" | "lightGreen" | "darkGreen";

export type PercentColorBand = {
  id: string;
  /** Inclusive whole-percent lower edge (0–100). */
  minInclusive: number;
  /** Inclusive whole-percent upper edge (0–100). */
  maxInclusive: number;
  tone: PercentColorTone;
};

export type PercentColorScaleConfig = {
  enabled: boolean;
  bands: PercentColorBand[];
};

export const PERCENT_COLOR_SCALE_STORAGE_KEY = "campaign-dashboard:overview-percent-color-scale:v1";

/** Fired on `window` after a same-tab config write so open tables refresh. */
export const PERCENT_COLOR_SCALE_EVENT = "campaign-dashboard:percent-color-scale";

export const PERCENT_COLOR_TONES: readonly PercentColorTone[] = [
  "darkWarm",
  "lightWarm",
  "none",
  "lightGreen",
  "darkGreen",
] as const;

export const DEFAULT_PERCENT_COLOR_SCALE: PercentColorScaleConfig = {
  enabled: true,
  bands: [
    { id: "0-20", minInclusive: 0, maxInclusive: 20, tone: "darkWarm" },
    { id: "21-40", minInclusive: 21, maxInclusive: 40, tone: "lightWarm" },
    { id: "41-60", minInclusive: 41, maxInclusive: 60, tone: "none" },
    { id: "61-80", minInclusive: 61, maxInclusive: 80, tone: "lightGreen" },
    { id: "81-100", minInclusive: 81, maxInclusive: 100, tone: "darkGreen" },
  ],
};

const TONE_CLASS: Record<PercentColorTone, string> = {
  darkWarm: "bg-red-200 text-red-950 dark:bg-red-900/60 dark:text-red-50",
  lightWarm: "bg-orange-100 text-orange-950 dark:bg-orange-900/35 dark:text-orange-50",
  none: "",
  lightGreen: "bg-green-100 text-green-950 dark:bg-green-900/35 dark:text-green-50",
  darkGreen: "bg-green-300 text-green-950 dark:bg-green-800/55 dark:text-green-50",
};

const TONE_SWATCH: Record<PercentColorTone, string> = {
  darkWarm: "bg-red-200 border-red-400",
  lightWarm: "bg-orange-100 border-orange-300",
  none: "bg-white border-gray-300",
  lightGreen: "bg-green-100 border-green-300",
  darkGreen: "bg-green-300 border-green-500",
};

export function percentToneClass(tone: PercentColorTone): string {
  return TONE_CLASS[tone] ?? "";
}

export function percentToneSwatchClass(tone: PercentColorTone): string {
  return TONE_SWATCH[tone] ?? TONE_SWATCH.none;
}

export function percentToneLabel(tone: PercentColorTone): string {
  switch (tone) {
    case "darkWarm":
      return "Dark warm";
    case "lightWarm":
      return "Light warm";
    case "none":
      return "None";
    case "lightGreen":
      return "Light green";
    case "darkGreen":
      return "Dark green";
    default:
      return tone;
  }
}

export function bandRangeLabel(band: PercentColorBand): string {
  return `${band.minInclusive}–${band.maxInclusive}%`;
}

function bandMinHundredths(band: PercentColorBand): number {
  if (band.minInclusive <= 0) return 0;
  // Match legacy cutoffs: 20.00% is still in 0–20; 20.01% starts 21–40.
  return (band.minInclusive - 1) * 100 + 1;
}

function bandMaxHundredths(band: PercentColorBand): number {
  return band.maxInclusive * 100;
}

export function resolvePercentBandTone(
  rateValue: number | null,
  config: PercentColorScaleConfig
): PercentColorTone | null {
  if (!config.enabled || rateValue === null || !Number.isFinite(rateValue)) return null;
  const hundredths = Math.round(rateValue * 10000);
  for (const band of config.bands) {
    if (hundredths >= bandMinHundredths(band) && hundredths <= bandMaxHundredths(band)) {
      return band.tone;
    }
  }
  return null;
}

export function percentColorScaleClass(
  rateValue: number | null,
  config: PercentColorScaleConfig
): string {
  const tone = resolvePercentBandTone(rateValue, config);
  if (!tone || tone === "none") return "";
  return percentToneClass(tone);
}

function isTone(value: unknown): value is PercentColorTone {
  return typeof value === "string" && (PERCENT_COLOR_TONES as readonly string[]).includes(value);
}

function sanitizeBand(raw: unknown, fallback: PercentColorBand): PercentColorBand {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const record = raw as Record<string, unknown>;
  const tone = isTone(record.tone) ? record.tone : fallback.tone;
  const minInclusive =
    typeof record.minInclusive === "number" && Number.isFinite(record.minInclusive)
      ? Math.max(0, Math.min(100, Math.round(record.minInclusive)))
      : fallback.minInclusive;
  const maxInclusive =
    typeof record.maxInclusive === "number" && Number.isFinite(record.maxInclusive)
      ? Math.max(minInclusive, Math.min(100, Math.round(record.maxInclusive)))
      : fallback.maxInclusive;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : fallback.id;
  return { id, minInclusive, maxInclusive, tone };
}

export function sanitizePercentColorScaleConfig(raw: unknown): PercentColorScaleConfig {
  if (!raw || typeof raw !== "object") return structuredClone(DEFAULT_PERCENT_COLOR_SCALE);
  const record = raw as Record<string, unknown>;
  const enabled = typeof record.enabled === "boolean" ? record.enabled : true;
  const defaults = DEFAULT_PERCENT_COLOR_SCALE.bands;
  const rawBands = Array.isArray(record.bands) ? record.bands : [];
  const bands = defaults.map((fallback, index) => {
    const byId = rawBands.find(
      (band) =>
        band &&
        typeof band === "object" &&
        typeof (band as { id?: unknown }).id === "string" &&
        (band as { id: string }).id === fallback.id
    );
    return sanitizeBand(byId ?? rawBands[index], fallback);
  });
  return { enabled, bands };
}

export function loadPercentColorScale(): PercentColorScaleConfig {
  if (typeof window === "undefined") return structuredClone(DEFAULT_PERCENT_COLOR_SCALE);
  try {
    const raw = window.localStorage.getItem(PERCENT_COLOR_SCALE_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_PERCENT_COLOR_SCALE);
    return sanitizePercentColorScaleConfig(JSON.parse(raw) as unknown);
  } catch {
    return structuredClone(DEFAULT_PERCENT_COLOR_SCALE);
  }
}

export function savePercentColorScale(config: PercentColorScaleConfig): PercentColorScaleConfig {
  const next = sanitizePercentColorScaleConfig(config);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PERCENT_COLOR_SCALE_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(PERCENT_COLOR_SCALE_EVENT));
    } catch {
      // Ignore quota / private-mode failures; in-memory config still applies for this tab.
    }
  }
  return next;
}

export function resetPercentColorScale(): PercentColorScaleConfig {
  return savePercentColorScale(structuredClone(DEFAULT_PERCENT_COLOR_SCALE));
}
