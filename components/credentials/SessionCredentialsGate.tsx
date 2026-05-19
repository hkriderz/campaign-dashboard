import { sessionCredentialsEnabled, type DataAccessRequirements } from "@/lib/credentials";
import SessionCredentialsGateClient from "@/components/credentials/SessionCredentialsGateClient";

type Props = {
  children: React.ReactNode;
  requirements?: DataAccessRequirements;
  title?: string;
  description?: string;
};

/**
 * When session credentials are enabled, the client gate checks /api/pdi/credentials
 * (same source as uploads) so the wall never disagrees with "Ready" status.
 */
export default async function SessionCredentialsGate({
  children,
  requirements = { gcp: true },
  title = "Upload your credentials",
  description = "Each browser session requires its own GCP and PDI credentials. Upload the files below to access dashboard data. Nothing is shared with other visitors.",
}: Props) {
  if (!sessionCredentialsEnabled()) {
    return children;
  }

  return (
    <SessionCredentialsGateClient requirements={requirements} title={title} description={description}>
      {children}
    </SessionCredentialsGateClient>
  );
}
