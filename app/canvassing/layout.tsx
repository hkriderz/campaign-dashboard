import SessionPasswordGate from "@/components/access/SessionPasswordGate";
import AppShell from "@/components/layout/AppShell";
import Sidebar from "@/components/layout/Sidebar";
import { getCanvassingTags } from "@/lib/campaign-tags";

export default function CanvassingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell section="canvass" sidebar={<Sidebar tags={getCanvassingTags()} basePath="/canvassing" />}>
      <SessionPasswordGate>{children}</SessionPasswordGate>
    </AppShell>
  );
}
