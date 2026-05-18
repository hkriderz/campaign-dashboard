import SyncerClient from "./SyncerClient";

export const metadata = {
  title: "PDI Syncer — Campaign Dashboard",
  description: "Run BigQuery → PDI sync (stw_to_pdi.py) from the browser.",
};

export default function PdiSyncerPage() {
  return (
    <div className="p-6 lg:p-8">
      <SyncerClient />
    </div>
  );
}
