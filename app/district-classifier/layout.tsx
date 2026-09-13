import SessionPasswordGate from "@/components/access/SessionPasswordGate";
import TopNav from "@/components/layout/TopNav";

export default function DistrictClassifierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col" data-section="districts">
      <TopNav />
      <main className="flex-1 bg-[var(--section-paper)]">
        <SessionPasswordGate>{children}</SessionPasswordGate>
      </main>
    </div>
  );
}
