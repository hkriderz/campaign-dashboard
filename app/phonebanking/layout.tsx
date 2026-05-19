import AppShell from "@/components/layout/AppShell";
import Sidebar from "@/components/layout/Sidebar";
import SessionCredentialsGate from "@/components/credentials/SessionCredentialsGate";
import { getPhonebankingTags } from "@/lib/campaign-tags";

export const dynamic = "force-dynamic";

export default function PhoneBankingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell sidebar={<Sidebar tags={getPhonebankingTags()} basePath="/phonebanking" />}>
      <SessionCredentialsGate requirements={{ gcp: true }}>{children}</SessionCredentialsGate>
    </AppShell>
  );
}
