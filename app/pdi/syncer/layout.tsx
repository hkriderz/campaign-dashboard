import SessionCredentialsGate from "@/components/credentials/SessionCredentialsGate";

export default function PdiSyncerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionCredentialsGate
      requirements={{ gcp: true, pdi: true }}
      title="PDI Syncer credentials required"
      description="Upload your GCP service account and PDI API credentials before running sync jobs."
    >
      {children}
    </SessionCredentialsGate>
  );
}
