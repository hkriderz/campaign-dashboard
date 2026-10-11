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
        {children}
      </main>
    </div>
  );
}
