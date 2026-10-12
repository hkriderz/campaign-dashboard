import {
  loadPdiSurveySnapshot,
  loadTextContactsSnapshot,
  savePdiSurveySnapshot,
  saveRecontactPairsSnapshot,
  saveTextContactsSnapshot,
  saveUniqueIdPhoneSnapshot,
  saveUniqueIdTextSnapshot,
  snapshotsDisabled,
} from "../bq-snapshot-store";
import {
  getTagById,
  isDerivedQcTagId,
  resolveSurveyScriptProfile,
} from "../campaign-tags";
import { candidateTermsForTag } from "../strong-support-from-survey";
import type { CampaignTag } from "../types";
import { collectPhoneEvents, collectTextEvents } from "../unique-ids/collect";
import { mergeRowsByCallDate, mergeTextContactWindow, PHONE_HISTORY_START } from "../snapshot-merge";
import {
  buildQcRecontactPairsFromSources,
  fetchTagPdiSurveyRows,
  groupRowsIntoCallSummaries,
  primaryTagIdFromQc,
  type PdiSurveyRow,
} from "./qc-recontact";
import { fetchTagTextContacts } from "./text-recontact";
import type { QcTextContactSummary } from "../qc-recontact/types";

function tagHasPhone(tag: CampaignTag): boolean {
  return tag.mode === "phonebanking" || tag.mode === "both";
}

function tagHasText(tag: CampaignTag): boolean {
  return tag.includeInTexting === true;
}

function keepStoredIdentity(existing: readonly PdiSurveyRow[], fresh: PdiSurveyRow[]): PdiSurveyRow[] {
  const byKey = new Map<string, PdiSurveyRow>();
  for (const row of existing) {
    byKey.set(`${row.callId}\t${row.questionName}`, row);
  }
  return fresh.map((row) => {
    if (row.pdiId && row.voterName) return row;
    const prev = byKey.get(`${row.callId}\t${row.questionName}`);
    if (!prev) return row;
    return {
      ...row,
      pdiId: row.pdiId || prev.pdiId,
      voterName: row.voterName || prev.voterName,
      voterAddress: row.voterAddress || prev.voterAddress,
    };
  });
}

async function loadMergedPdiRows(
  tag: CampaignTag,
  requirePdi: boolean,
  incremental: boolean,
  windowStart: string | undefined,
  queryStartedAt: string
): Promise<PdiSurveyRow[]> {
  const existing = loadPdiSurveySnapshot(tag.id);
  const useWindow = incremental && existing != null && Boolean(windowStart);
  const historyStart = useWindow ? windowStart! : PHONE_HISTORY_START;
  let fresh = await fetchTagPdiSurveyRows(tag, {
    requirePdi,
    callDateOnOrAfter: historyStart,
    omitCalleeJson: useWindow,
    queryStartedAt: useWindow ? undefined : queryStartedAt,
  });
  if (useWindow) fresh = keepStoredIdentity(existing!.rows, fresh);
  if (requirePdi) fresh = fresh.filter((row) => row.pdiId !== "");
  const rows = useWindow ? mergeRowsByCallDate(existing!.rows, fresh, historyStart) : fresh;
  savePdiSurveySnapshot(tag.id, rows, { touchEvenIfUnchanged: true });
  return rows;
}

async function loadMergedTextContacts(
  tag: CampaignTag,
  incremental: boolean,
  windowStart: string | undefined,
  queryStartedAt: string
): Promise<QcTextContactSummary[]> {
  const profile = resolveSurveyScriptProfile(tag);
  const existing = loadTextContactsSnapshot(tag.id);
  const useWindow = incremental && existing != null && Boolean(windowStart);
  const fresh = await fetchTagTextContacts(
    tag,
    profile,
    useWindow
      ? { activeSince: windowStart }
      : { queryStartedAt }
  );
  const rows = useWindow ? mergeTextContactWindow(existing!.rows, fresh) : fresh;
  saveTextContactsSnapshot(tag.id, rows, { touchEvenIfUnchanged: true });
  return rows;
}

function savePhoneEvents(tag: CampaignTag, rows: PdiSurveyRow[]): void {
  if (!tagHasPhone(tag)) return;
  const profile = resolveSurveyScriptProfile(tag);
  const calls = groupRowsIntoCallSummaries(rows, profile, candidateTermsForTag(tag));
  saveUniqueIdPhoneSnapshot(tag.id, collectPhoneEvents(calls, profile), { touchEvenIfUnchanged: true });
}

function saveTextEvents(tag: CampaignTag, contacts: QcTextContactSummary[]): void {
  if (!tagHasText(tag)) return;
  const profile = resolveSurveyScriptProfile(tag);
  saveUniqueIdTextSnapshot(tag.id, collectTextEvents(contacts, profile), { touchEvenIfUnchanged: true });
}

/** Text-contact snapshot and unique-ID text events. QC tags do this inside the phone step. */
export async function refreshTagTextFollowUp(
  tagId: string,
  mode: "full" | "incremental",
  options?: { windowStart?: string; queryStartedAt?: string }
): Promise<void> {
  if (snapshotsDisabled()) return;
  const tag = getTagById(tagId);
  if (!tag || isDerivedQcTagId(tagId) || !tagHasText(tag)) return;
  const contacts = await loadMergedTextContacts(
    tag,
    mode === "incremental",
    options?.windowStart,
    options?.queryStartedAt ?? new Date().toISOString()
  );
  saveTextEvents(tag, contacts);
}

/** Phone PDI snapshot, or the QC pair file. This is the slow step. */
export async function refreshTagPhoneContactFollowUp(
  tagId: string,
  mode: "full" | "incremental",
  options?: { windowStart?: string; queryStartedAt?: string }
): Promise<void> {
  if (snapshotsDisabled()) return;
  const tag = getTagById(tagId);
  if (!tag) return;
  const incremental = mode === "incremental";
  const windowStart = options?.windowStart;
  const queryStartedAt = options?.queryStartedAt ?? new Date().toISOString();

  if (isDerivedQcTagId(tagId)) {
    const primary = getTagById(primaryTagIdFromQc(tagId));
    if (!primary) return;
    const [qcRows, primaryRows, textContacts] = await Promise.all([
      loadMergedPdiRows(tag, false, incremental, windowStart, queryStartedAt),
      loadMergedPdiRows(primary, true, incremental, windowStart, queryStartedAt),
      loadMergedTextContacts(primary, incremental, windowStart, queryStartedAt),
    ]);
    const pairs = buildQcRecontactPairsFromSources(tagId, qcRows, primaryRows, textContacts);
    saveRecontactPairsSnapshot(tagId, pairs, { touchEvenIfUnchanged: true });
    const profile = resolveSurveyScriptProfile(tag);
    const qcCalls = groupRowsIntoCallSummaries(qcRows, profile, candidateTermsForTag(primary));
    saveUniqueIdPhoneSnapshot(
      tagId,
      collectPhoneEvents(qcCalls, profile, { includeQcCampaigns: true }),
      { touchEvenIfUnchanged: true }
    );
    return;
  }

  if (!tagHasPhone(tag)) return;
  const rows = await loadMergedPdiRows(tag, true, incremental, windowStart, queryStartedAt);
  savePhoneEvents(tag, rows);
}

/**
 * Merge raw PDI and text-contact snapshots, then recompute recontact pairs or unique-ID files.
 * Incremental mode requires the raw snapshot to already exist; otherwise the full history is loaded.
 */
export async function refreshRecontactAndUniqueSnapshots(
  tagId: string,
  mode: "full" | "incremental",
  options?: { windowStart?: string; queryStartedAt?: string }
): Promise<void> {
  await Promise.all([
    refreshTagTextFollowUp(tagId, mode, options),
    refreshTagPhoneContactFollowUp(tagId, mode, options),
  ]);
}
