import Link from "next/link";
import WhaleMark from "@/components/brand/WhaleMark";
import ThemeToggle from "@/components/layout/ThemeToggle";

const MODES = [
  {
    href: "/phonebanking",
    index: "01",
    title: "Phone Banking",
    description:
      "View hours, surveys, and phonebanker stats for every STW campaign, organized by candidate.",
    kicker: "War room",
  },
  {
    href: "/texting",
    index: "02",
    title: "Texting",
    description:
      "View Scale to Win Text campaigns, send status, contacts, and support / moved tags by candidate.",
    kicker: "Dispatch",
  },
  {
    href: "/canvassing/overview",
    index: "03",
    title: "Canvassing",
    description:
      "Count unique PDI / PRIMARY IDs labeled Strong support, Undecided, or Strong oppose from phone, text, and knocks. Knock Analysis and Doorknocks Results stay under Canvassing tools.",
    kicker: "Field",
  },
  {
    href: "/district-classifier",
    index: "04",
    title: "District Classifier",
    description:
      "Upload address CSVs and classify signups into political districts with a Python GIS pipeline.",
    kicker: "Atlas",
  },
  {
    href: "/pdi",
    index: "05",
    title: "PDI Tools",
    description:
      "Map STW survey answers to PDI flags and run the BigQuery → PDI sync workflow.",
    kicker: "Console",
  },
] as const;

export default function LandingPage() {
  return (
    <main
      data-section="home"
      className="relative min-h-screen bg-[var(--section-paper)] text-[var(--section-ink)] px-4 py-10 sm:px-8 sm:py-16"
    >
      <div className="fixed top-4 right-4 sm:top-6 sm:right-6 z-50">
        <ThemeToggle />
      </div>

      <div className="mx-auto w-full max-w-5xl">
        <header className="border-b border-[var(--section-rule)] pb-8 mb-10">
          <div className="flex items-end justify-between gap-4 mb-8">
            <WhaleMark variant="plain" size="hero" alt="" />
            <p className="section-kicker hidden sm:block" style={{ color: "var(--section-gold)" }}>
              Operations
            </p>
          </div>
          <p className="section-kicker mb-3">Campaign HQ</p>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.1] max-w-3xl">
            Campaign Operations Dashboard
          </h1>
          <hr className="section-hero__rule" style={{ background: "var(--section-gold)", width: "6rem" }} />
          <p className="section-hero__lede text-base">
            Phone banking, texting, canvassing, and PDI tools — all in one place.
          </p>
        </header>

        <ol className="divide-y divide-[var(--section-rule)] border-y border-[var(--section-rule)]">
          {MODES.map((mode) => (
            <li key={mode.href}>
              <Link
                href={mode.href}
                className="group grid grid-cols-[auto_1fr_auto] gap-4 sm:gap-8 items-baseline py-6 sm:py-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]"
              >
                <span className="font-display text-2xl sm:text-3xl text-[var(--section-gold)] tabular-nums w-10">
                  {mode.index}
                </span>
                <span className="min-w-0">
                  <span className="section-kicker block mb-1">{mode.kicker}</span>
                  <span className="font-display text-xl sm:text-2xl font-semibold group-hover:underline underline-offset-4 decoration-[var(--section-gold)]">
                    {mode.title}
                  </span>
                  <span className="block text-sm text-[var(--section-muted)] mt-1 max-w-xl">
                    {mode.description}
                  </span>
                </span>
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--section-muted)] group-hover:text-[var(--section-ink)] whitespace-nowrap">
                  Open
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
