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
import { laThreeDayWindowStart, mergeRowsByCallDate, PHONE_HISTORY_START, upsertById } from "../snapshot-merge";
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

async function loadMergedPdiRows(
  tag: CampaignTag,
  requirePdi: boolean,
  incremental: boolean
): Promise<PdiSurveyRow[]> {
  const existing = loadPdiSurveySnapshot(tag.id);
  const useWindow = incremental && existing != null;
  const historyStart = useWindow ? laThreeDayWindowStart() : PHONE_HISTORY_START;
  const fresh = await fetchTagPdiSurveyRows(tag, { requirePdi, callDateOnOrAfter: historyStart });
  const rows = useWindow ? mergeRowsByCallDate(existing!.rows, fresh, historyStart) : fresh;
  savePdiSurveySnapshot(tag.id, rows, { touchEvenIfUnchanged: true });
  return rows;
}

async function loadMergedTextContacts(
  tag: CampaignTag,
  incremental: boolean
): Promise<QcTextContactSummary[]> {
  const profile = resolveSurveyScriptProfile(tag);
  const existing = loadTextContactsSnapshot(tag.id);
  const useWindow = incremental && existing != null;
  const fresh = await fetchTagTextContacts(
    tag,
    profile,
    useWindow ? { activeSince: laThreeDayWindowStart() } : undefined
  );
  const rows = useWindow
    ? upsertById(existing!.rows, fresh, (row) => row.campaignContactId)
    : fresh;
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

/**
 * Merge raw PDI and text-contact snapshots, then recompute recontact pairs or unique-ID files.
 * Incremental mode requires the raw snapshot to already exist; otherwise the full history is loaded.
 */
export async function refreshRecontactAndUniqueSnapshots(
  tagId: string,
  mode: "full" | "incremental"
): Promise<void> {
  if (snapshotsDisabled()) return;
  const tag = getTagById(tagId);
  if (!tag) return;
  const incremental = mode === "incremental";

  if (isDerivedQcTagId(tagId)) {
    const primary = getTagById(primaryTagIdFromQc(tagId));
    if (!primary) return;
    const [qcRows, primaryRows, textContacts] = await Promise.all([
      loadMergedPdiRows(tag, false, incremental),
      loadMergedPdiRows(primary, true, incremental),
      loadMergedTextContacts(primary, incremental),
    ]);
    const pairs = buildQcRecontactPairsFromSources(tagId, qcRows, primaryRows, textContacts);
    saveRecontactPairsSnapshot(tagId, pairs, { touchEvenIfUnchanged: true });
    return;
  }

  const tasks: Promise<void>[] = [];
  if (tagHasPhone(tag)) {
    tasks.push(
      loadMergedPdiRows(tag, true, incremental).then((rows) => {
        savePhoneEvents(tag, rows);
      })
    );
  }
  if (tagHasText(tag)) {
    tasks.push(
      loadMergedTextContacts(tag, incremental).then((contacts) => {
        saveTextEvents(tag, contacts);
      })
    );
  }
  await Promise.all(tasks);
}
