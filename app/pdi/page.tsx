import Link from "next/link";
import { sessionCredentialsEnabled } from "@/lib/credentials";
import PdiCredentialsSection from "@/components/pdi-tools/PdiCredentialsSection";
import SectionHero from "@/components/brand/SectionHero";

const TOOLS = [
  {
    href: "/pdi/mapper",
    index: "01",
    title: "PDI Mapper",
    description:
      "Map Dialer survey Q/A or Text tags to PDI flags. Dialer exports stw_pdi_mapping_*.json; Text exports stw_text_pdi_mapping_*.json.",
  },
  {
    href: "/pdi/syncer",
    index: "02",
    title: "PDI Syncer",
    description:
      "Dialer BigQuery → PDI flag sync with live progress. Dry-run by default; compare counts to Python before your first live post.",
  },
  {
    href: "/pdi/text-syncer",
    index: "03",
    title: "PDI Text Syncer",
    description:
      "Nithya STW Text tags → PDI flags. Uses Mapper Text mappings, its own lock and incremental cursor, and the shared people ledger.",
  },
] as const;

export default function PdiPage() {
  return (
    <div className="p-6 lg:p-8 overflow-y-auto bg-[var(--section-paper)]">
      <div className="max-w-3xl mx-auto">
        <SectionHero
          kicker="Console / Pipeline"
          title="PDI Tools"
          lede="Mapping and sync tools for the Scale to Win → PDI pipeline."
        />

        <ol className="divide-y divide-[var(--section-rule)] border-y border-[var(--section-rule)]">
          {TOOLS.map((tool) => (
            <li key={tool.href}>
              <Link
                href={tool.href}
                className="group grid grid-cols-[auto_1fr_auto] gap-4 items-baseline py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]"
              >
                <span className="font-display text-2xl text-[var(--section-accent)] tabular-nums w-10">
                  {tool.index}
                </span>
                <span className="min-w-0">
                  <span className="font-display text-xl font-semibold text-[var(--section-ink)] group-hover:underline underline-offset-4">
                    {tool.title}
                  </span>
                  <span className="block text-sm text-[var(--section-muted)] mt-1">
                    {tool.description}
                  </span>
                </span>
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--section-muted)] group-hover:text-[var(--section-accent)]">
                  Open
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <PdiCredentialsSection sessionMode={sessionCredentialsEnabled()} />

        <div className="mt-10 border border-dashed border-[var(--section-accent)] bg-[color-mix(in_srgb,var(--section-accent)_8%,transparent)] p-5">
          <p className="section-kicker mb-2">How it fits together</p>
          <p className="text-sm text-[var(--section-ink)]">
            Use the <strong>Mapper</strong> (Dialer or Text toggle) to build mapping JSON in{" "}
            <code className="px-1 border border-[var(--section-rule)]">pdi-mappings/</code>, then run the matching syncer (start with dry-run). Dialer
            files are <code className="px-1 border border-[var(--section-rule)]">stw_pdi_mapping_*.json</code>;
            Text files are <code className="px-1 border border-[var(--section-rule)]">stw_text_pdi_mapping_*.json</code>.
            CSV reports land in <code className="px-1 border border-[var(--section-rule)]">pdi-sync-exports/</code>. Cached Dialer survey and PDI
            question lists load from <code className="px-1 border border-[var(--section-rule)]">PDI_TOOLS_DATA_DIR</code> or{" "}
            <code className="px-1 border border-[var(--section-rule)]">../pdiv3</code> when present. Configure{" "}
            <a href="#credentials" className="font-medium text-[var(--section-accent)] underline">
              credentials
            </a>{" "}
            on this page for live API refresh and sync.
          </p>
        </div>
      </div>
    </div>
  );
}
