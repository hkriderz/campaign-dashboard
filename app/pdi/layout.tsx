import TopNav from "@/components/layout/TopNav";
import PdiSubNav from "@/components/pdi-tools/PdiSubNav";

export default function PdiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <PdiSubNav />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</main>
    </div>
  );
}
