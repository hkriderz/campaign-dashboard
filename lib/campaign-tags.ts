import type { CampaignTag, SurveyScriptProfile } from "./types";
import {
  readCampaignTagsConfigFromDisk,
  storedEntryToPrimaryCampaignTag,
  type CampaignTagsConfigFileV1,
  type StoredCampaignTagV1,
} from "./campaign-tags-file";

/**
 * Central config for all candidate/campaign tags.
 *
 * searchTerms: matched case-insensitively against `campaigns.name` via SQL LIKE '%term%'.
 * campaignCodes: optional short codes matched as `CODE` + optional space/dash + digit
 * (REGEXP_CONTAINS), e.g. EUN 005 and ADA001 without spelling the full name.
 *
 * QC Calls: buckets are **derived** from each phone-banking candidate when `enableQc` is set
 * in `data/campaign-tags.json` (or the built-in defaults). Any campaign whose name matches
 * {@link QC_CAMPAIGN_NAME_MARKERS} AND the candidate’s terms/codes appears under “QC Calls”.
 *
 * Optional file: set `CAMPAIGN_TAGS_CONFIG_PATH` or use default `data/campaign-tags.json`.
 * When the file is missing or `tags` is empty, built-in defaults below are used.
 *
 * color: used for card borders, badges, and chart series.
 * textColor: used for text on top of the color (ensure contrast).
 */

/** Sidebar subheading for derived QC buckets. */
export const QC_NAV_GROUP_LABEL = "QC Calls";

/**
 * Substrings matched case-insensitively on `campaigns.name` (LIKE) to treat a list as QC.
 * Extend when STW uses new naming (e.g. "quality control", "q.c.").
 */
export const QC_CAMPAIGN_NAME_MARKERS: readonly string[] = ["qc"];

/**
 * Built-in candidates when no config file or empty `tags` array.
 * Each `both` / `phonebanking` entry gets an automatic `qc-<id>` tag when using defaults.
 */
const DEFAULT_CORE_CANDIDATE_TAGS: CampaignTag[] = [
  {
    id: "faizah",
    label: "Faizah Malik",
    searchTerms: ["faizah", "malik"],
    color: "#4f46e5",
    textColor: "#ffffff",
    mode: "both",
  },
  {
    id: "eunisses",
    label: "Eunisses Hernandez",
    searchTerms: ["eunisses", "hernandez"],
    campaignCodes: ["eun"],
    color: "#7c3aed",
    textColor: "#ffffff",
    mode: "both",
    showPollingAggregate: false,
    useCallLevelFinalResultFill: true,
  },
  {
    id: "ada",
    label: "Ada",
    searchTerms: [],
    campaignCodes: ["ada"],
    color: "#ea580c",
    textColor: "#ffffff",
    mode: "both",
  },
];

function qcMarkerGroup(): string[] {
  return QC_CAMPAIGN_NAME_MARKERS.map((m) => m.trim()).filter(Boolean);
}

function buildQcBucketTag(primary: CampaignTag): CampaignTag {
  const markers = qcMarkerGroup();
  if (!markers.length) {
    throw new Error("QC_CAMPAIGN_NAME_MARKERS must include at least one non-empty marker");
  }
  return {
    id: `qc-${primary.id}`,
    label: primary.label,
    searchTerms: [],
    searchTermGroups: [markers, [...primary.searchTerms]],
    campaignCodes: primary.campaignCodes,
    navGroup: QC_NAV_GROUP_LABEL,
    color: primary.color,
    textColor: primary.textColor,
    mode: "phonebanking",
    showPollingAggregate: primary.showPollingAggregate,
    useCallLevelFinalResultFill: primary.useCallLevelFinalResultFill,
    surveyScriptProfile: primary.surveyScriptProfile,
    verbatimFinalResultAggregate: primary.verbatimFinalResultAggregate,
  };
}

function qcBucketsFromCandidates(candidates: readonly CampaignTag[]): CampaignTag[] {
  return candidates
    .filter((t) => t.mode === "phonebanking" || t.mode === "both")
    .map((t) => buildQcBucketTag(t));
}

/** Stored rows mirroring {@link DEFAULT_CORE_CANDIDATE_TAGS} for the Campaign Tags editor. */
export function getBuiltInDefaultStoredTags(): StoredCampaignTagV1[] {
  return DEFAULT_CORE_CANDIDATE_TAGS.map((t) => ({
    id: t.id,
    label: t.label,
    searchTerms: [...t.searchTerms],
    campaignCodes: t.campaignCodes ? [...t.campaignCodes] : undefined,
    enableQc: true,
    oppositionMode: "none" as const,
    oppositionSearchTerms: undefined,
    color: t.color,
    textColor: t.textColor,
    mode: t.mode,
    showPollingAggregate: t.showPollingAggregate,
    useCallLevelFinalResultFill: t.useCallLevelFinalResultFill,
    verbatimFinalResultAggregate: t.verbatimFinalResultAggregate,
    surveyScriptProfile: t.surveyScriptProfile,
  }));
}

/**
 * Tags as saved on disk (for the editor). When no file or empty list, returns built-in defaults shape.
 */
export function getCampaignTagsConfigForEditor(): {
  source: "file" | "default";
  file: CampaignTagsConfigFileV1 | null;
  tags: StoredCampaignTagV1[];
} {
  const file = readCampaignTagsConfigFromDisk();
  if (file && file.tags.length > 0) {
    // Warm resolved tag list from the same disk read (sidebar, active-tags list, etc.).
    cachedAllTags = buildTagsFromFile(file);
    return { source: "file", file, tags: file.tags };
  }
  return {
    source: "default",
    file,
    tags: getBuiltInDefaultStoredTags(),
  };
}

function buildTagsFromFile(config: CampaignTagsConfigFileV1): CampaignTag[] {
  const primaries = config.tags.map((s) => storedEntryToPrimaryCampaignTag(s));
  const qcBuckets: CampaignTag[] = [];
  for (let i = 0; i < config.tags.length; i++) {
    const stored = config.tags[i]!;
    const primary = primaries[i]!;
    if (
      stored.enableQc &&
      (primary.mode === "phonebanking" || primary.mode === "both")
    ) {
      qcBuckets.push(buildQcBucketTag(primary));
    }
  }
  return [...primaries, ...qcBuckets];
}

function computeAllTags(): CampaignTag[] {
  const file = readCampaignTagsConfigFromDisk();
  if (file && file.tags.length > 0) {
    return buildTagsFromFile(file);
  }
  return [
    ...DEFAULT_CORE_CANDIDATE_TAGS,
    ...qcBucketsFromCandidates(DEFAULT_CORE_CANDIDATE_TAGS),
  ];
}

let cachedAllTags: CampaignTag[] | null = null;

function allTagsList(): CampaignTag[] {
  if (!cachedAllTags) {
    cachedAllTags = computeAllTags();
  }
  return cachedAllTags;
}

/** Re-read config from disk (after saves). */
export function reloadCampaignTagsFromDisk(): void {
  cachedAllTags = computeAllTags();
}

export function getCampaignTags(): CampaignTag[] {
  return allTagsList();
}

export function getCoreCampaignTags(): CampaignTag[] {
  return allTagsList().filter((t) => !isDerivedQcTagId(t.id));
}

export function getPhonebankingTags(): CampaignTag[] {
  return allTagsList().filter(
    (t) => t.mode === "phonebanking" || t.mode === "both"
  );
}

/** Resolved phone-banking tags for UI (includes derived `qc-*` slugs). */
export function getActivePhonebankingTagRows(): Array<{
  id: string;
  label: string;
  navGroup: string | null;
  isQc: boolean;
  mode: CampaignTag["mode"];
}> {
  return getPhonebankingTags().map((t) => ({
    id: t.id,
    label: t.label,
    navGroup: t.navGroup ?? null,
    isQc: isDerivedQcTagId(t.id),
    mode: t.mode,
  }));
}

export function getCanvassingTags(): CampaignTag[] {
  return allTagsList().filter(
    (t) => t.mode === "canvassing" || t.mode === "both"
  );
}

/** True when `id` is a derived QC slug (`qc-<candidateId>`). */
export function isDerivedQcTagId(tagId: string): boolean {
  return tagId.startsWith("qc-") && tagId.length > 3;
}

/** Look up a tag by its slug ID */
export function getTagById(id: string): CampaignTag | undefined {
  return allTagsList().find((t) => t.id === id);
}

/** Script profile for survey bucketing and labels (QC tags inherit from their primary candidate). */
export function resolveSurveyScriptProfile(tag: CampaignTag): SurveyScriptProfile {
  if (tag.surveyScriptProfile) return tag.surveyScriptProfile;
  const baseId = tag.id.startsWith("qc-") ? tag.id.slice(3) : tag.id;
  if (baseId === "ada") return "genericChallenger";
  if (baseId === "eunisses") return "eunissesTwoWay";
  return "faizahTraci";
}

/**
 * Whether the Final Result block should list raw STW/BQ answer text instead of consolidated buckets.
 * Explicit `verbatimFinalResultAggregate` on the tag wins; otherwise Ada-style scripts default to verbatim.
 */
export function tagUsesVerbatimFinalResultAggregate(tag: CampaignTag): boolean {
  if (tag.verbatimFinalResultAggregate != null) return tag.verbatimFinalResultAggregate;
  return resolveSurveyScriptProfile(tag) === "genericChallenger";
}

function sqlEscapeLikeFragment(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

/** Strip to [a-z0-9] for safe insertion into a BigQuery RE2 literal. */
function regexSafeCode(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Build a BigQuery WHERE clause for searchTerms (LIKE) and campaignCodes (REGEXP_CONTAINS).
 */
export function buildTagWhereClause(
  tag: CampaignTag,
  column = "campaigns.name"
): string {
  const col = `LOWER(${column})`;

  if (tag.searchTermGroups && tag.searchTermGroups.length > 0) {
    const lastIdx = tag.searchTermGroups.length - 1;
    const groupExprs: string[] = [];
    for (let i = 0; i < tag.searchTermGroups.length; i++) {
      const group = tag.searchTermGroups[i] ?? [];
      const likeParts = group
        .map((t) => t.trim())
        .filter(Boolean)
        .map((term) => `${col} LIKE '%${sqlEscapeLikeFragment(term.toLowerCase())}%'`);
      const codeParts =
        i === lastIdx
          ? (tag.campaignCodes ?? [])
              .map((raw) => {
                const c = regexSafeCode(raw);
                if (!c) return null;
                return `REGEXP_CONTAINS(${col}, r'(^|[^a-z0-9])${c}(\\s|-)?[0-9]')`;
              })
              .filter((x): x is string => x != null)
          : [];
      const parts = [...likeParts, ...codeParts];
      if (!parts.length) {
        throw new Error(`Tag "${tag.id}" has an empty searchTermGroups[${i}] (add terms or campaignCodes)`);
      }
      groupExprs.push(`(${parts.join(" OR ")})`);
    }
    return `(${groupExprs.join(" AND ")})`;
  }

  const likeParts = tag.searchTerms.map(
    (term) => `${col} LIKE '%${sqlEscapeLikeFragment(term.toLowerCase())}%'`
  );
  const codeParts = (tag.campaignCodes ?? [])
    .map((raw) => {
      const c = regexSafeCode(raw);
      if (!c) return null;
      return `REGEXP_CONTAINS(${col}, r'(^|[^a-z0-9])${c}(\\s|-)?[0-9]')`;
    })
    .filter((x): x is string => x != null);

  const parts = [...likeParts, ...codeParts];
  if (!parts.length) {
    throw new Error(`Tag "${tag.id}" has no searchTerms or campaignCodes`);
  }
  return `(${parts.join(" OR ")})`;
}
