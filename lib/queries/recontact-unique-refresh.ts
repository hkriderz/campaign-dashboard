import {
  loadPdiSurveySnapshot,
  loadTextContactsSnapshot,
  savePdiSurveySnapshot,
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
import { syncQcAnalysisFromLocalFiles } from "../qc-recontact/local-pairs";
import {
  fetchTagPdiSurveyRows,
  groupRowsIntoCallSummaries,
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

/**
 * Phone PDI snapshot, then QC pairs from the files just saved.
 * A QC tag does not scan survey history again; its dialer file is already on disk.
 */
export async function refreshTagPhoneContactFollowUp(
  tagId: string,
  mode: "full" | "incremental",
  options?: { windowStart?: string; queryStartedAt?: string; skipQcSync?: boolean }
): Promise<void> {
  if (snapshotsDisabled()) return;
  const tag = getTagById(tagId);
  if (!tag) return;
  const incremental = mode === "incremental";
  const windowStart = options?.windowStart;
  const queryStartedAt = options?.queryStartedAt ?? new Date().toISOString();
  const syncQc = async () => {
    if (options?.skipQcSync) return;
    const qcTagId = isDerivedQcTagId(tagId) ? tagId : `qc-${tagId}`;
    await syncQcAnalysisFromLocalFiles(qcTagId);
  };

  if (isDerivedQcTagId(tagId)) {
    await syncQc();
    return;
  }

  if (!tagHasPhone(tag)) {
    await syncQc();
    return;
  }
  const rows = await loadMergedPdiRows(tag, true, incremental, windowStart, queryStartedAt);
  savePhoneEvents(tag, rows);
  await syncQc();
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
  await refreshTagTextFollowUp(tagId, mode, options);
  await refreshTagPhoneContactFollowUp(tagId, mode, options);
}
