import TopNav from "@/components/layout/TopNav";
import PdiSubNav from "@/components/pdi-tools/PdiSubNav";
import { getAuthUserFromCookies, userCanEdit } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

export default async function PdiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUserFromCookies();
  return (
    <div className="min-h-screen flex flex-col" data-section="pdi">
      <TopNav />
      <PdiSubNav canEdit={userCanEdit(user)} />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</main>
    </div>
  );
}
