import SessionCredentialsGate from "@/components/credentials/SessionCredentialsGate";

export const dynamic = "force-dynamic";

export default function PdiTextSyncerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionCredentialsGate
      requirements={{ gcp: true, pdi: true }}
      title="PDI Text Syncer credentials required"
      description="Upload your GCP service account and PDI API credentials before running text-tag sync jobs."
    >
      {children}
    </SessionCredentialsGate>
  );
}
