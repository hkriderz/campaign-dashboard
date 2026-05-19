import SessionCredentialsGate from "@/components/credentials/SessionCredentialsGate";

export const dynamic = "force-dynamic";

export default function PdiMapperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionCredentialsGate
      requirements={{ gcp: true, pdi: true }}
      title="PDI Mapper credentials required"
      description="Upload your GCP service account and PDI API credentials to load live survey data and PDI questions for mapping."
    >
      {children}
    </SessionCredentialsGate>
  );
}
