import "server-only";

import {
  loadUniqueIdPhoneSnapshot,
  loadUniqueIdTextSnapshot,
  saveUniqueIdPhoneSnapshot,
  saveUniqueIdTextSnapshot,
  snapshotsDisabled,
} from "../bq-snapshot-store";
import {
  getTagById,
  resolveSurveyScriptProfile,
} from "../campaign-tags";
import { assertDataAccessAllowed } from "../credentials/gate";
import { candidateTermsForTag } from "../strong-support-from-survey";
import { collectPhoneEvents, collectTextEvents } from "../unique-ids/collect";
import type { UniqueIdContactEvent } from "../unique-ids/types";
import type { CampaignTag } from "../types";
import { fetchTagPdiSurveyRows, groupRowsIntoCallSummaries } from "./qc-recontact";
import { fetchTagTextContacts } from "./text-recontact";

export type UniqueIdChannelLoad = {
  events: UniqueIdContactEvent[];
  savedAt: string;
  error?: string;
};

function emptyLoad(error?: string): UniqueIdChannelLoad {
  return { events: [], savedAt: "", error };
}

function tagHasPhone(tag: CampaignTag): boolean {
  return tag.mode === "phonebanking" || tag.mode === "both";
}

function tagHasText(tag: CampaignTag): boolean {
  return tag.includeInTexting === true;
}

export async function fetchPhoneUniqueIdEvents(tag: CampaignTag): Promise<UniqueIdContactEvent[]> {
  assertDataAccessAllowed({ gcp: true });
  const profile = resolveSurveyScriptProfile(tag);
  const rows = await fetchTagPdiSurveyRows(tag, { requirePdi: true });
  const calls = groupRowsIntoCallSummaries(rows, profile, candidateTermsForTag(tag));
  return collectPhoneEvents(calls, profile);
}

export async function fetchTextUniqueIdEvents(tag: CampaignTag): Promise<UniqueIdContactEvent[]> {
  assertDataAccessAllowed({ gcp: true });
  const profile = resolveSurveyScriptProfile(tag);
  const contacts = await fetchTagTextContacts(tag, profile);
  return collectTextEvents(contacts, profile);
}

export async function rebuildPhoneUniqueIdSnapshot(tag: CampaignTag): Promise<UniqueIdChannelLoad> {
  try {
    if (!tagHasPhone(tag)) return emptyLoad();
    const events = await fetchPhoneUniqueIdEvents(tag);
    if (!snapshotsDisabled()) {
      saveUniqueIdPhoneSnapshot(tag.id, events, { touchEvenIfUnchanged: true });
    }
    return { events, savedAt: new Date().toISOString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return emptyLoad(message);
  }
}

export async function rebuildTextUniqueIdSnapshot(tag: CampaignTag): Promise<UniqueIdChannelLoad> {
  try {
    if (!tagHasText(tag)) return emptyLoad();
    const events = await fetchTextUniqueIdEvents(tag);
    if (!snapshotsDisabled()) {
      saveUniqueIdTextSnapshot(tag.id, events, { touchEvenIfUnchanged: true });
    }
    return { events, savedAt: new Date().toISOString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return emptyLoad(message);
  }
}

export async function loadPhoneUniqueIdEvents(
  tag: CampaignTag,
  options: { buildIfMissing?: boolean } = {}
): Promise<UniqueIdChannelLoad> {
  if (!tagHasPhone(tag)) return emptyLoad();
  const snap = snapshotsDisabled() ? null : loadUniqueIdPhoneSnapshot(tag.id);
  if (snap) return { events: snap.rows, savedAt: snap.savedAt };
  if (!options.buildIfMissing) {
    return emptyLoad("Phone unique-ID snapshot is missing. Refresh phone & text to load it.");
  }
  return rebuildPhoneUniqueIdSnapshot(tag);
}

export async function loadTextUniqueIdEvents(
  tag: CampaignTag,
  options: { buildIfMissing?: boolean } = {}
): Promise<UniqueIdChannelLoad> {
  if (!tagHasText(tag)) return emptyLoad();
  const snap = snapshotsDisabled() ? null : loadUniqueIdTextSnapshot(tag.id);
  if (snap) return { events: snap.rows, savedAt: snap.savedAt };
  if (!options.buildIfMissing) {
    return emptyLoad("Text unique-ID snapshot is missing. Refresh phone & text to load it.");
  }
  return rebuildTextUniqueIdSnapshot(tag);
}

export function resolveUniqueIdTag(tagId: string): CampaignTag | undefined {
  const tag = getTagById(tagId);
  if (!tag || tag.id.startsWith("qc-")) return undefined;
  return tag;
}
