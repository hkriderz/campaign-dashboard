import { redirect } from "next/navigation";
import { getAuthUserFromCookies } from "@/lib/auth/current";
import { safeNextPath } from "@/lib/auth/public-paths";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const user = await getAuthUserFromCookies();
  if (user) redirect(next);
  return <LoginForm next={next} />;
}
