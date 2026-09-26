/**
 * Voter-id lookup for Scale to Win contact JSON (`callees.data` or `campaign_contacts.data`).
 *
 * Trusted PDI keys win even when the value is not `CA` + digits (Nithya lists use `V1_PDIID`).
 * Primary-id keys are used only when that column is a PDI-shaped id. Names and emails on
 * broad lists can start with "CA" but are not `CA` followed by digits.
 */

const JSON_COLUMN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** Exact or generic key patterns, most specific first. Case-insensitive. */
export const TRUSTED_PDI_KEY_PATTERNS = [
  "v1_pdiid",
  "pdi_id",
  "pdi id",
  "contact[ _]?pdi[ _]?id",
  '[^"]*pdi[ _]?id[^"]*',
] as const;

export const PRIMARY_ID_KEY_PATTERNS = [
  "v1_primaryid",
  "primary_id",
  "primary id",
  "contact[ _]?primary[ _]?id",
  '[^"]*primary[ _]?id[^"]*',
] as const;

/** Entire value is `CA` plus digits, e.g. `CA18678463`. */
export const PDI_ID_SHAPE = /^CA[0-9]+$/i;

function assertJsonColumn(jsonColumn: string): void {
  if (!JSON_COLUMN_PATTERN.test(jsonColumn)) {
    throw new Error(`Unsafe JSON column for PDI id extract: ${jsonColumn}`);
  }
}

function quotedKeyExtract(jsonColumn: string, keyPattern: string): string {
  return `REGEXP_EXTRACT(${jsonColumn}, r'(?i)"${keyPattern}"\\s*:\\s*"([^"]+)"')`;
}

function primaryIdExtract(jsonColumn: string, keyPattern: string): string {
  const extracted = quotedKeyExtract(jsonColumn, keyPattern);
  return `IF(REGEXP_CONTAINS(IFNULL(${extracted}, ""), r'(?i)^CA[0-9]+$'), ${extracted}, NULL)`;
}

/**
 * BigQuery expression. Empty string when no id is found.
 * Result is trimmed and uppercased (`ca18678463` → `CA18678463`).
 */
export function pdiIdExtractSql(jsonColumn: string): string {
  assertJsonColumn(jsonColumn);
  const candidates = [
    ...TRUSTED_PDI_KEY_PATTERNS.map((pattern) => quotedKeyExtract(jsonColumn, pattern)),
    ...PRIMARY_ID_KEY_PATTERNS.map((pattern) => primaryIdExtract(jsonColumn, pattern)),
  ];
  return `UPPER(TRIM(IFNULL(COALESCE(\n      ${candidates.join(",\n      ")}\n    ), "")))`;
}

function firstCapturedValue(raw: string, keyPatterns: readonly string[]): string {
  for (const keyPattern of keyPatterns) {
    const match = new RegExp(`"${keyPattern}"\\s*:\\s*"([^"]+)"`, "i").exec(raw);
    const value = match?.[1]?.trim() ?? "";
    if (value) return value;
  }
  return "";
}

/**
 * Same key order as `pdiIdExtractSql`, for tests and for JSON already loaded in process.
 * Returns "" when the contact has no usable voter id.
 */
export function selectPdiIdFromJson(raw: string): string {
  const trusted = firstCapturedValue(raw, TRUSTED_PDI_KEY_PATTERNS);
  if (trusted) return trusted.toUpperCase();

  const primary = firstCapturedValue(raw, PRIMARY_ID_KEY_PATTERNS).toUpperCase();
  return PDI_ID_SHAPE.test(primary) ? primary : "";
}
