import Link from "next/link";
import { sessionCredentialsEnabled } from "@/lib/credentials";
import PdiCredentialsSection from "@/components/pdi-tools/PdiCredentialsSection";

const TOOLS = [
  {
    href: "/pdi/mapper",
    icon: "🗺",
    title: "PDI Mapper",
    description:
      "Map Dialer survey Q/A or Text tags to PDI flags. Dialer exports stw_pdi_mapping_*.json; Text exports stw_text_pdi_mapping_*.json.",
  },
  {
    href: "/pdi/syncer",
    icon: "🔄",
    title: "PDI Syncer",
    description:
      "Dialer BigQuery → PDI flag sync with live progress. Dry-run by default; compare counts to Python before your first live post.",
  },
  {
    href: "/pdi/text-syncer",
    icon: "💬",
    title: "PDI Text Syncer",
    description:
      "Nithya STW Text tags → PDI flags. Uses Mapper Text mappings, its own lock and incremental cursor, and the shared people ledger.",
  },
] as const;

export default function PdiPage() {
  return (
    <div className="p-6 lg:p-8 overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">PDI Tools</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Mapping and sync tools for the Scale to Win → PDI pipeline.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm flex flex-col gap-4 hover:ring-2 hover:ring-emerald-300 dark:hover:ring-emerald-700 transition-all"
            >
              <span className="text-3xl" aria-hidden="true">
                {tool.icon}
              </span>
              <div>
                <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1">{tool.title}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{tool.description}</p>
              </div>
              <span className="mt-auto w-full text-center py-2.5 rounded-lg text-sm font-semibold bg-emerald-600 text-white">
                Open →
              </span>
            </Link>
          ))}
        </div>

        <PdiCredentialsSection sessionMode={sessionCredentialsEnabled()} />

        <div className="mt-10 rounded-xl border border-dashed border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-5">
          <p className="font-semibold text-emerald-800 dark:text-emerald-300 text-sm mb-2">How it fits together</p>
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            Use the <strong>Mapper</strong> (Dialer or Text toggle) to build mapping JSON in{" "}
            <code className="px-1 rounded">pdi-mappings/</code>, then run the matching syncer (start with dry-run). Dialer
            files are <code className="bg-emerald-100 dark:bg-emerald-900/40 px-1 rounded">stw_pdi_mapping_*.json</code>;
            Text files are <code className="bg-emerald-100 dark:bg-emerald-900/40 px-1 rounded">stw_text_pdi_mapping_*.json</code>.
            CSV reports land in <code className="px-1 rounded">pdi-sync-exports/</code>. Cached Dialer survey and PDI
            question lists load from <code className="px-1 rounded">PDI_TOOLS_DATA_DIR</code> or{" "}
            <code className="px-1 rounded">../pdiv3</code> when present. Configure{" "}
            <a href="#credentials" className="font-medium text-emerald-800 dark:text-emerald-300 underline">
              credentials
            </a>{" "}
            on this page for live API refresh and sync.
          </p>
        </div>
      </div>
    </div>
  );
}
