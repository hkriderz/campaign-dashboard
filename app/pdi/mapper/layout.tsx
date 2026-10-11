import { redirect } from "next/navigation";
import SessionCredentialsGate from "@/components/credentials/SessionCredentialsGate";
import { getAuthUserFromCookies, userCanEdit } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

export default async function PdiMapperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUserFromCookies();
  if (!userCanEdit(user)) redirect("/pdi");
  return (
    <SessionCredentialsGate
      requirements={{ gcp: true, pdi: true }}
      title="PDI Mapper credentials required"
      description="Upload your GCP service account and PDI API credentials to load live survey data and PDI questions for mapping."
    >
      {children}
    </SessionCredentialsGate>
  );
}
