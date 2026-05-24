import TopNav from "@/components/layout/TopNav";

export default function DistrictClassifierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <main className="flex-1 bg-gray-50/50 dark:bg-gray-950">{children}</main>
    </div>
  );
}
