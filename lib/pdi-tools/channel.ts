export type PdiSyncChannel = "dialer" | "text";
export type TextMappingScope = "all" | "one";

export const DIALER_MAPPING_PREFIX = "stw_pdi_mapping";
export const TEXT_MAPPING_PREFIX = "stw_text_pdi_mapping";

export const TEXT_MAPPING_SURVEY_NAME = "Nithya (STW Text)";
export const TEXT_CANDIDATE_TAG_ID = "nithya";

export const DIALER_STATE_KEY = "global";
export const TEXT_STATE_KEY = "text";

export const DIALER_LOCK_KEY = "global";
export const TEXT_LOCK_KEY = "text";

export const DIALER_LEDGER_SOURCE = "sync_run";
export const TEXT_LEDGER_SOURCE = "text_sync_run";

/** PDI Admin → Acquisition Types → "ScaletoWin Phone Bank". */
export const DIALER_ACQUISITION_TYPE_ID = "w6we79BXkuCsBbb9QCyiLA==";
/** PDI Admin → Acquisition Types → "Text Bank" ("Imported From Text Bank"). */
export const TEXT_ACQUISITION_TYPE_ID = "eekkYPFC1TBzSChy2Ui8UQ==";

export function parsePdiSyncChannel(raw: unknown): PdiSyncChannel {
  return raw === "text" ? "text" : "dialer";
}

export function parseTextMappingScope(raw: unknown): TextMappingScope {
  return raw === "one" ? "one" : "all";
}

export function mappingFilePrefix(channel: PdiSyncChannel): string {
  return channel === "text" ? TEXT_MAPPING_PREFIX : DIALER_MAPPING_PREFIX;
}

export function isMappingFileForChannel(fileName: string, channel: PdiSyncChannel): boolean {
  const n = fileName.toLowerCase();
  if (!n.endsWith(".json")) return false;
  if (channel === "text") return n.includes(TEXT_MAPPING_PREFIX);
  return n.includes(DIALER_MAPPING_PREFIX) && !n.includes(TEXT_MAPPING_PREFIX);
}

export function syncStateKey(channel: PdiSyncChannel): string {
  return channel === "text" ? TEXT_STATE_KEY : DIALER_STATE_KEY;
}

export function syncLockKey(channel: PdiSyncChannel): string {
  return channel === "text" ? TEXT_LOCK_KEY : DIALER_LOCK_KEY;
}

export function ledgerSourceForChannel(channel: PdiSyncChannel): string {
  return channel === "text" ? TEXT_LEDGER_SOURCE : DIALER_LEDGER_SOURCE;
}

export function acquisitionTypeIdForChannel(channel: PdiSyncChannel): string {
  if (channel === "text") {
    return process.env.PDI_TEXT_ACQUISITION_TYPE_ID?.trim() || TEXT_ACQUISITION_TYPE_ID;
  }
  return process.env.PDI_DIALER_ACQUISITION_TYPE_ID?.trim() || DIALER_ACQUISITION_TYPE_ID;
}

export function mapperStorageKey(channel: PdiSyncChannel): string {
  return channel === "text"
    ? "campaign_dashboard_pdi_mapper_text_v1"
    : "campaign_dashboard_pdi_mapper_v1";
}

export function mappingExportFileName(channel: PdiSyncChannel, generatedIso?: string): string {
  const date = (generatedIso ?? new Date().toISOString()).slice(0, 10);
  return `${mappingFilePrefix(channel)}_${date}.json`;
}

/**
 * Text "all" writes to the shared synthetic survey. Text "one" uses the campaign name.
 * Dialer always uses the display survey name.
 */
export function mappingIdentitySurveyName(
  channel: PdiSyncChannel,
  displaySurveyName: string,
  scope: TextMappingScope = "all"
): string {
  if (channel === "text" && scope === "all") return TEXT_MAPPING_SURVEY_NAME;
  return displaySurveyName;
}

export function mappingQuestionKey(
  channel: PdiSyncChannel,
  displaySurveyName: string,
  questionName: string,
  scope: TextMappingScope = "all"
): string {
  return `${mappingIdentitySurveyName(channel, displaySurveyName, scope)}||${questionName}`;
}

export function mappingAnswerKey(
  channel: PdiSyncChannel,
  displaySurveyName: string,
  questionName: string,
  answerValue: string,
  scope: TextMappingScope = "all"
): string {
  return `${mappingQuestionKey(channel, displaySurveyName, questionName, scope)}||${answerValue}`;
}
