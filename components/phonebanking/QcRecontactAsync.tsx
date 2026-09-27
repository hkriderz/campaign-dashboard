import Link from "next/link";
import { summarizeRecontactPairs } from "@/lib/qc-recontact";
import { runServerWithCredentialContext } from "@/lib/credentials";
import {
  loadQcRecontactPairsForPageCached,
  prepareQcRecontactPagePairs,
} from "@/lib/queries/qc-recontact";
import type { SurveyScriptProfile } from "@/lib/types";
import QcRecontactSection from "./QcRecontactSection";

type Props = {
  tagId: string;
  startDate: string;
  endDate: string;
  surveyScriptProfile: SurveyScriptProfile;
};

function recontactHref(tagId: string, startDate: string, endDate: string): string {
  const params = new URLSearchParams({ tab: "overview" });
  if (startDate) {
    params.set("date", startDate);
    if (endDate && endDate !== startDate) params.set("endDate", endDate);
  }
  return `/phonebanking/${tagId}?${params.toString()}#qc-recontacts`;
}

async function loadPreparedPairs(props: Props) {
  return runServerWithCredentialContext(async () => {
    const payload = await loadQcRecontactPairsForPageCached(props.tagId);
    if (!payload) return null;
    return {
      pairs: prepareQcRecontactPagePairs(
        payload.pairs,
        props.startDate,
        props.endDate,
        props.surveyScriptProfile
      ),
      hasSnapshot: payload.hasSnapshot,
    };
  });
}

export function QcRecontactMatchedCardFallback() {
  return (
    <div
      aria-busy="true"
      className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/30 px-3 py-2 text-xs"
    >
      <div className="text-indigo-700 dark:text-indigo-300">Matched</div>
      <div className="mt-1 h-4 w-10 animate-pulse rounded bg-indigo-200/80 dark:bg-indigo-800/80" />
      <div className="mt-1 h-3 w-28 animate-pulse rounded bg-indigo-100 dark:bg-indigo-900/60" />
    </div>
  );
}

export async function QcRecontactMatchedCard(props: Props) {
  const loaded = await loadPreparedPairs(props);
  const stats = summarizeRecontactPairs(loaded?.pairs ?? []);
  const hasSnapshot = Boolean(loaded?.hasSnapshot);
  return (
    <Link
      href={recontactHref(props.tagId, props.startDate, props.endDate)}
      className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/30 px-3 py-2 text-xs hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors"
    >
      <div className="text-indigo-700 dark:text-indigo-300">Matched</div>
      <div className="font-semibold text-gray-900 dark:text-gray-100">
        {hasSnapshot ? stats.matched.toLocaleString() : "—"}
      </div>
      <div className="text-gray-500 dark:text-gray-400 mt-0.5">
        {hasSnapshot
          ? `${stats.flipped.toLocaleString()} flipped · ${stats.unmatched.toLocaleString()} unmatched`
          : "Refresh to match"}
      </div>
    </Link>
  );
}

export function QcRecontactPanelFallback() {
  return (
    <section id="qc-recontacts" className="scroll-mt-24 space-y-3" aria-busy="true">
      <h2 className="text-base font-semibold text-gray-700 dark:text-gray-200">Recontacts</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">Loading recontacts…</p>
    </section>
  );
}

export async function QcRecontactPanel(props: Props) {
  const loaded = await loadPreparedPairs(props);
  if (!loaded) return null;
  return (
    <QcRecontactSection
      tagId={props.tagId}
      pairs={loaded.pairs}
      hasSnapshot={loaded.hasSnapshot}
      surveyScriptProfile={props.surveyScriptProfile}
    />
  );
}
