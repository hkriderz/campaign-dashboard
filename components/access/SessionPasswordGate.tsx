import { accessPasswordEnabled } from "@/lib/access/config";
import SessionPasswordGateClient from "@/components/access/SessionPasswordGateClient";

type Props = {
  children: React.ReactNode;
};

/**
 * When CAMPAIGN_DASHBOARD_ACCESS_PASSWORD is set, the client gate checks
 * /api/access/status so the wall matches the unlock cookie.
 */
export default async function SessionPasswordGate({ children }: Props) {
  if (!accessPasswordEnabled()) {
    return children;
  }

  return <SessionPasswordGateClient>{children}</SessionPasswordGateClient>;
}
