import {
  getActivePhonebankingTagRows,
  getCampaignTagsConfigForEditor,
  getPhonebankingTags,
} from "@/lib/campaign-tags";
import { getCampaignTagsConfigPath } from "@/lib/campaign-tags-file";
import { getPhonebankingSnapshotsMeta } from "@/lib/tag-dashboard-snapshot";
import CampaignTagsClient from "./CampaignTagsClient";

export const dynamic = "force-dynamic";

export default function CampaignTagsPage() {
  const editor = getCampaignTagsConfigForEditor();
  const snapshotsMeta = getPhonebankingSnapshotsMeta(
    getPhonebankingTags().map((t) => t.id)
  );

  return (
    <CampaignTagsClient
      initialTags={editor.tags}
      initialSource={editor.source}
      initialActiveTags={getActivePhonebankingTagRows()}
      configPath={getCampaignTagsConfigPath()}
      snapshotsMeta={snapshotsMeta}
    />
  );
}
