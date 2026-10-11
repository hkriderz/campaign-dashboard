import { getAuthUserFromCookies, userCanEdit } from "@/lib/auth/current";
import {
  getActivePhonebankingTagRows,
  getCampaignTagsConfigForEditor,
  getPhonebankingTags,
} from "@/lib/campaign-tags";
import { getCampaignTagsConfigPath } from "@/lib/campaign-tags-file";
import { getPhonebankingSnapshotsMeta } from "@/lib/tag-dashboard-snapshot";
import CampaignTagsClient from "./CampaignTagsClient";

export const dynamic = "force-dynamic";

export default async function CampaignTagsPage() {
  const editor = getCampaignTagsConfigForEditor();
  const snapshotsMeta = getPhonebankingSnapshotsMeta(
    getPhonebankingTags().map((t) => t.id)
  );

  const user = await getAuthUserFromCookies();

  return (
    <CampaignTagsClient
      canEdit={userCanEdit(user)}
      initialTags={editor.tags}
      initialSource={editor.source}
      initialActiveTags={getActivePhonebankingTagRows()}
      configPath={getCampaignTagsConfigPath()}
      snapshotsMeta={snapshotsMeta}
    />
  );
}
