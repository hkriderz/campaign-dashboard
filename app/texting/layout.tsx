import AppShell from "@/components/layout/AppShell";
import Sidebar from "@/components/layout/Sidebar";
import SessionCredentialsGate from "@/components/credentials/SessionCredentialsGate";
import { getTextingTags } from "@/lib/campaign-tags";

export const dynamic = "force-dynamic";

export default function TextingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell sidebar={<Sidebar tags={getTextingTags()} basePath="/texting" />}>
      <SessionCredentialsGate requirements={{ gcp: true }}>{children}</SessionCredentialsGate>
    </AppShell>
  );
}
