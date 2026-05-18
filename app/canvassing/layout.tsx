import TopNav from "@/components/layout/TopNav";
import Sidebar from "@/components/layout/Sidebar";
import { getCanvassingTags } from "@/lib/campaign-tags";

export default function CanvassingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar tags={getCanvassingTags()} basePath="/canvassing" />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8 bg-gray-50/50 dark:bg-gray-950">{children}</main>
      </div>
    </div>
  );
}
