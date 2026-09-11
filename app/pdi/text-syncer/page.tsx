import SyncerClient from "../syncer/SyncerClient";

export const metadata = {
  title: "PDI Text Syncer — Campaign Dashboard",
  description: "Run STW Text tag → PDI flag sync from the browser.",
};

export default function PdiTextSyncerPage() {
  return (
    <div className="p-6 lg:p-8">
      <SyncerClient channel="text" />
    </div>
  );
}
