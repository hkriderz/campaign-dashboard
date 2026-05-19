import {
  meetsDataAccessRequirements,
  resolveContextFromCookies,
  sessionCredentialsEnabled,
  type DataAccessRequirements,
} from "@/lib/credentials";
import PdiCredentialsSection from "@/components/pdi-tools/PdiCredentialsSection";

type Props = {
  children: React.ReactNode;
  requirements?: DataAccessRequirements;
  title?: string;
  description?: string;
};

/**
 * Server gate: when session credentials are enabled, show an upload wall until
 * the current browser session has the required keys configured.
 */
export default async function SessionCredentialsGate({
  children,
  requirements = { gcp: true },
  title = "Upload your credentials",
  description = "Each browser session requires its own GCP and PDI credentials. Upload the files below to access dashboard data. Nothing is shared with other visitors.",
}: Props) {
  if (!sessionCredentialsEnabled()) {
    return children;
  }

  const ctx = await resolveContextFromCookies();
  if (ctx.scope === "session" && meetsDataAccessRequirements(ctx, requirements)) {
    return children;
  }

  const needsPdi = Boolean(requirements.pdi);
  const needsGcp = requirements.gcp !== false;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8 rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-6">
        <h1 className="text-xl font-bold text-amber-950 dark:text-amber-100">{title}</h1>
        <p className="text-sm text-amber-900/90 dark:text-amber-200/90 mt-2">{description}</p>
        <ul className="mt-3 text-sm text-amber-800 dark:text-amber-300 list-disc list-inside space-y-1">
          {needsGcp ? <li>GCP service account JSON (BigQuery access)</li> : null}
          {needsPdi ? <li>PDI username, password, and API token</li> : null}
        </ul>
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Credentials are stored only for this browser session on the server and are not visible to other users.
        </p>
      </div>
      <PdiCredentialsSection sessionMode />
    </div>
  );
}
