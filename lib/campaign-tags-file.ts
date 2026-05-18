import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import path from "path";
import type { CampaignTag, SurveyScriptProfile } from "./types";

export const CAMPAIGN_TAGS_FILE_VERSION = 1 as const;

export type OppositionMode = "none" | "named" | "other";

/**
 * One row in `campaign-tags.json`. Drives candidate matching and optional derived QC buckets.
 */
export type StoredCampaignTagV1 = {
  id: string;
  label: string;
  /** Aliases matched case-insensitively on campaign name (LIKE). */
  searchTerms: string[];
  campaignCodes?: string[];
  /** When true and mode is phonebanking/both, a `qc-<id>` tag is appended (QC ∧ candidate). */
  enableQc: boolean;
  oppositionMode: OppositionMode;
  /** Used when oppositionMode is `named` — extra LIKE terms (opponent names, etc.). */
  oppositionSearchTerms?: string[];
  color: string;
  textColor: string;
  mode: CampaignTag["mode"];
  showPollingAggregate?: boolean;
  useCallLevelFinalResultFill?: boolean;
  verbatimFinalResultAggregate?: boolean;
  surveyScriptProfile?: SurveyScriptProfile;
};

export type CampaignTagsConfigFileV1 = {
  version: typeof CAMPAIGN_TAGS_FILE_VERSION;
  tags: StoredCampaignTagV1[];
};

/** Generic “oppose someone else” phrases merged into search terms when oppositionMode is `other`. */
const OTHER_OPPOSE_TERMS: readonly string[] = [
  "someone else",
  "other candidate",
  "another candidate",
  "not sure yet",
];

export function getCampaignTagsConfigPath(): string {
  const fromEnv = process.env.CAMPAIGN_TAGS_CONFIG_PATH?.trim();
  if (fromEnv) return fromEnv;
  return path.join(process.cwd(), "data", "campaign-tags.json");
}

function dedupeTermsCi(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function storedEntryToPrimaryCampaignTag(
  entry: StoredCampaignTagV1
): CampaignTag {
  const baseTerms = dedupeTermsCi(entry.searchTerms ?? []);
  let extra: string[] = [];
  if (entry.oppositionMode === "named") {
    extra = dedupeTermsCi(entry.oppositionSearchTerms ?? []);
  } else if (entry.oppositionMode === "other") {
    extra = [...OTHER_OPPOSE_TERMS];
  }
  const searchTerms = dedupeTermsCi([...baseTerms, ...extra]);

  const campaignCodes = (entry.campaignCodes ?? [])
    .map((c) => c.trim())
    .filter(Boolean);

  return {
    id: entry.id,
    label: entry.label.trim(),
    searchTerms,
    campaignCodes: campaignCodes.length ? campaignCodes : undefined,
    color: entry.color,
    textColor: entry.textColor,
    mode: entry.mode,
    showPollingAggregate: entry.showPollingAggregate,
    useCallLevelFinalResultFill: entry.useCallLevelFinalResultFill,
    verbatimFinalResultAggregate: entry.verbatimFinalResultAggregate,
    surveyScriptProfile: entry.surveyScriptProfile,
  };
}

export function readCampaignTagsConfigFromDisk(): CampaignTagsConfigFileV1 | null {
  const p = getCampaignTagsConfigPath();
  if (!existsSync(p)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== CAMPAIGN_TAGS_FILE_VERSION) return null;
  if (!Array.isArray(o.tags)) return null;
  return { version: CAMPAIGN_TAGS_FILE_VERSION, tags: o.tags as StoredCampaignTagV1[] };
}

export function writeCampaignTagsConfigToDisk(
  config: CampaignTagsConfigFileV1
): void {
  const p = getCampaignTagsConfigPath();
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  renameSync(tmp, p);
}

export function isValidTagId(id: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

export function normalizeOppositionMode(v: unknown): OppositionMode {
  if (v === "named" || v === "other" || v === "none") return v;
  return "none";
}

export function validateStoredTags(
  tags: unknown
): { ok: true; tags: StoredCampaignTagV1[] } | { ok: false; error: string } {
  if (!Array.isArray(tags)) {
    return { ok: false, error: "Request body must include a tags array." };
  }
  const seen = new Set<string>();
  const out: StoredCampaignTagV1[] = [];

  for (let i = 0; i < tags.length; i++) {
    const row = tags[i];
    if (!row || typeof row !== "object") {
      return { ok: false, error: `tags[${i}] must be an object.` };
    }
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!id || !isValidTagId(id)) {
      return {
        ok: false,
        error: `tags[${i}].id must be a non-empty slug (lowercase letters, digits, hyphens).`,
      };
    }
    if (seen.has(id)) {
      return { ok: false, error: `Duplicate tag id "${id}".` };
    }
    seen.add(id);

    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!label) {
      return { ok: false, error: `tags[${i}].label is required.` };
    }

    const searchTerms = Array.isArray(r.searchTerms)
      ? r.searchTerms.filter((t): t is string => typeof t === "string")
      : [];
    const campaignCodes = Array.isArray(r.campaignCodes)
      ? r.campaignCodes.filter((t): t is string => typeof t === "string")
      : undefined;

    const hasCodes = (campaignCodes ?? []).some((c) => c.trim().length > 0);
    const hasTerms = searchTerms.some((t) => t.trim().length > 0);
    if (!hasTerms && !hasCodes) {
      return {
        ok: false,
        error: `tags[${i}]: add at least one search term or campaign code.`,
      };
    }

    const modeRaw = r.mode;
    const mode =
      modeRaw === "both" || modeRaw === "phonebanking" || modeRaw === "canvassing"
        ? modeRaw
        : null;
    if (!mode) {
      return {
        ok: false,
        error: `tags[${i}].mode must be "both", "phonebanking", or "canvassing".`,
      };
    }

    const enableQc = r.enableQc === true;
    if (enableQc && mode === "canvassing") {
      return {
        ok: false,
        error: `tags[${i}]: QC buckets apply to phone banking only; set mode to "both" or "phonebanking", or disable QC.`,
      };
    }

    const oppositionMode = normalizeOppositionMode(r.oppositionMode);

    const oppositionSearchTerms =
      oppositionMode === "named" && Array.isArray(r.oppositionSearchTerms)
        ? r.oppositionSearchTerms.filter((t): t is string => typeof t === "string")
        : undefined;

    const color = typeof r.color === "string" ? r.color.trim() : "";
    const textColor = typeof r.textColor === "string" ? r.textColor.trim() : "";
    if (!color || !textColor) {
      return { ok: false, error: `tags[${i}]: color and textColor are required.` };
    }

    let surveyScriptProfile: SurveyScriptProfile | undefined;
    if (r.surveyScriptProfile != null) {
      const sp = r.surveyScriptProfile;
      if (
        sp !== "faizahTraci" &&
        sp !== "eunissesTwoWay" &&
        sp !== "genericChallenger"
      ) {
        return { ok: false, error: `tags[${i}].surveyScriptProfile is invalid.` };
      }
      surveyScriptProfile = sp;
    }

    const entry: StoredCampaignTagV1 = {
      id,
      label,
      searchTerms,
      campaignCodes,
      enableQc,
      oppositionMode,
      oppositionSearchTerms,
      color,
      textColor,
      mode,
      showPollingAggregate:
        typeof r.showPollingAggregate === "boolean"
          ? r.showPollingAggregate
          : undefined,
      useCallLevelFinalResultFill:
        typeof r.useCallLevelFinalResultFill === "boolean"
          ? r.useCallLevelFinalResultFill
          : undefined,
      verbatimFinalResultAggregate:
        typeof r.verbatimFinalResultAggregate === "boolean"
          ? r.verbatimFinalResultAggregate
          : undefined,
      surveyScriptProfile,
    };

    out.push(entry);
  }

  return { ok: true, tags: out };
}
