import Link from "next/link";
import FeatureIconBox from "@/components/brand/FeatureIconBox";
import WhaleMark from "@/components/brand/WhaleMark";
import ThemeToggle from "@/components/layout/ThemeToggle";

const MODES = [
  {
    href: "/phonebanking",
    icon: "📞",
    title: "Phone Banking",
    description:
      "View dials, hours, and phonebanker stats for every STW campaign, organized by candidate.",
    color: "indigo",
  },
  {
    href: "/canvassing",
    icon: "🚶",
    title: "Canvassing",
    description:
      "Track door-to-door canvassing results from Google Sheets and uploaded campaign files.",
    color: "violet",
    badge: "Coming soon",
  },
  {
    href: "/pdi",
    icon: "🔧",
    title: "PDI Tools",
    description:
      "Map STW survey answers to PDI flags and run the BigQuery → PDI sync workflow.",
    color: "mint",
  },
] as const;

const colorMap = {
  indigo: {
    ring: "ring-indigo-400/50 dark:ring-indigo-500/40",
    glow: "from-indigo-500/20",
    icon: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20",
    btn: "dash-btn-primary",
  },
  violet: {
    ring: "ring-violet-400/50 dark:ring-violet-500/40",
    glow: "from-violet-500/20",
    icon: "bg-violet-500/15 text-violet-600 dark:text-violet-300 border border-violet-500/20",
    btn: "bg-violet-600 hover:bg-violet-500 text-white rounded-full font-semibold",
  },
  mint: {
    ring: "ring-mint-500/40",
    glow: "from-mint-500/25",
    icon: "bg-mint-500/15 text-mint-600 dark:text-mint-400 border border-mint-500/25",
    btn: "bg-mint-600 hover:bg-mint-500 text-white rounded-full font-semibold shadow-[0_0_24px_rgba(69,211,153,0.35)]",
  },
};

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center px-4 py-16">
      <div className="fixed top-4 right-4 sm:top-6 sm:right-6 z-50">
        <ThemeToggle />
      </div>

      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_20%_0%,rgba(124,108,240,0.18),transparent_55%),radial-gradient(ellipse_50%_40%_at_80%_100%,rgba(69,211,153,0.12),transparent_50%)]"
        aria-hidden
      />

      <div className="relative max-w-4xl w-full">
        <div className="text-center mb-12">
          <WhaleMark
            variant="boxed"
            size="hero"
            className="mx-auto mb-5"
            alt=""
          />
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-50 mb-3">
            Campaign Operations Dashboard
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-base sm:text-lg max-w-xl mx-auto">
            Phone banking analytics, canvassing tracking, and PDI tools — all
            in one place.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {MODES.map((mode) => {
            const c = colorMap[mode.color];
            return (
              <div
                key={mode.href}
                className={`relative dash-card dash-card-glow flex flex-col gap-4 transition-all duration-200 ${
                  "badge" in mode
                    ? "opacity-75"
                    : `hover:ring-2 ${c.ring} hover:shadow-[0_0_40px_rgba(124,108,240,0.15)]`
                }`}
              >
                {"badge" in mode ? (
                  <span className="absolute top-4 right-4 text-xs font-semibold bg-white/10 text-gray-400 px-2.5 py-1 rounded-full border border-white/10">
                    {mode.badge}
                  </span>
                ) : null}

                <FeatureIconBox toneClassName={c.icon}>{mode.icon}</FeatureIconBox>

                <div className="flex-1 relative z-[1]">
                  <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-50 mb-1">
                    {mode.title}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{mode.description}</p>
                </div>

                {"badge" in mode ? (
                  <button
                    disabled
                    className="w-full py-2.5 rounded-full text-sm font-semibold bg-white/5 text-gray-500 border border-white/10 cursor-not-allowed"
                  >
                    Coming Soon
                  </button>
                ) : (
                  <Link
                    href={mode.href}
                    className={`block text-center w-full py-2.5 text-sm ${c.btn} transition-colors relative z-[1]`}
                  >
                    Open {mode.title} →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
