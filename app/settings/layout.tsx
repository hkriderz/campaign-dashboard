import { redirect } from "next/navigation";
import TopNav from "@/components/layout/TopNav";
import { getAuthUserFromCookies, userCanAdmin } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUserFromCookies();
  if (!userCanAdmin(user)) redirect("/");

  return (
    <div className="min-h-screen flex flex-col" data-section="home">
      <TopNav />
      <main className="flex-1 bg-[var(--section-paper)]">{children}</main>
    </div>
  );
}
