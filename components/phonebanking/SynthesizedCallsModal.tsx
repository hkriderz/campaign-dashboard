"use client";

import { useEffect, useState } from "react";
import {
  formatSynthesisReason,
  type SynthesizedFinalResultHit,
} from "@/lib/strong-support-from-survey";
import type { FinalResultFamily } from "@/lib/survey-answer-consolidation";

export type SynthesizedCallsScope = {
  tagId: string;
  /** Real candidate tags when the page tag is synthetic (e.g. `_all_campaigns`). */
  tagIds?: string[];
  campaignId?: string;
  callDate?: string;
  endDate?: string;
  phonebanker?: string;
  displayLabel?: string;
  family?: FinalResultFamily;
  title?: string;
};

const MAX_HITS = 500;

function realTagIdsForScope(scope: SynthesizedCallsScope): string[] {
  const raw = scope.tagIds?.length ? scope.tagIds : [scope.tagId];
  return [...new Set(raw.map((id) => id.trim()).filter((id) => id && !id.startsWith("_")))];
}

function hitKey(hit: SynthesizedFinalResultHit): string {
  return `${hit.callId}|${hit.sourceQuestionName}`;
}

async function fetchSynthesizedPayload(
  tagId: string,
  params: URLSearchParams,
  signal: AbortSignal
): Promise<ApiPayload> {
  const res = await fetch(`/api/phonebanking/${encodeURIComponent(tagId)}/synthesized-calls?${params}`, {
    signal,
  });
  const body = (await res.json()) as { ok?: boolean; data?: ApiPayload; error?: string };
  if (!res.ok || !body.ok || !body.data) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body.data;
}

function mergeSynthesizedPayloads(payloads: ApiPayload[]): ApiPayload {
  const seen = new Set<string>();
  const hits: SynthesizedFinalResultHit[] = [];
  let total = 0;
  let truncated = false;
  for (const payload of payloads) {
    total += payload.total;
    truncated = truncated || payload.truncated;
    for (const hit of payload.hits) {
      const key = hitKey(hit);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
  }
  if (hits.length > MAX_HITS) {
    return { hits: hits.slice(0, MAX_HITS), truncated: true, total };
  }
  return { hits, truncated: truncated || total > hits.length, total };
}

type ApiPayload = {
  hits: SynthesizedFinalResultHit[];
  truncated: boolean;
  total: number;
};

type Props = {
  scope: SynthesizedCallsScope | null;
  onClose: () => void;
};

export default function SynthesizedCallsModal({ scope, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ApiPayload | null>(null);

  useEffect(() => {
    if (!scope) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }

    const params = new URLSearchParams();
    if (scope.campaignId) params.set("campaignId", scope.campaignId);
    if (scope.callDate) params.set("callDate", scope.callDate);
    if (scope.endDate) params.set("endDate", scope.endDate);
    if (scope.phonebanker) params.set("phonebanker", scope.phonebanker);
    if (scope.displayLabel) params.set("displayLabel", scope.displayLabel);
    if (scope.family) params.set("family", scope.family);

    const tagIds = realTagIdsForScope(scope);
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setPayload(null);

    void (async () => {
      if (tagIds.length === 0) {
        throw new Error("No candidate tag available for synthesized calls");
      }
      const payloads = await Promise.all(
        tagIds.map((id) => fetchSynthesizedPayload(id, params, ac.signal))
      );
      setPayload(mergeSynthesizedPayloads(payloads));
    })()
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [scope]);

  useEffect(() => {
    if (!scope) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scope, onClose]);

  if (!scope) return null;

  const heading = scope.title ?? "Synthesized Final Result calls";
  const hits = payload?.hits ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="synthesized-calls-title"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
          <h2
            id="synthesized-calls-title"
            className="text-base font-semibold text-gray-900 dark:text-gray-100"
          >
            {heading}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-sm"
          >
            Close
          </button>
        </div>
        <div className="p-4 overflow-auto text-sm text-gray-800 dark:text-gray-200">
          {loading ? (
            <p className="text-gray-500 dark:text-gray-400">Loading synthesized calls…</p>
          ) : error ? (
            <p className="text-rose-600 dark:text-rose-400">{error}</p>
          ) : hits.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No synthesized calls in this scope.</p>
          ) : (
            <>
              {payload?.truncated ? (
                <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                  Showing {hits.length.toLocaleString()} of {payload.total.toLocaleString()} calls.
                </p>
              ) : null}
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                      <th className="px-2 py-2 font-semibold">Call ID</th>
                      <th className="px-2 py-2 font-semibold">Date</th>
                      <th className="px-2 py-2 font-semibold">Phonebanker</th>
                      <th className="px-2 py-2 font-semibold">Source question</th>
                      <th className="px-2 py-2 font-semibold">Source answer</th>
                      <th className="px-2 py-2 font-semibold">Mapped result</th>
                      <th className="px-2 py-2 font-semibold">Why</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {hits.map((h) => (
                      <tr key={`${h.callId}-${h.sourceQuestionName}`}>
                        <td className="px-2 py-1.5 font-mono whitespace-nowrap">{h.callId}</td>
                        <td className="px-2 py-1.5 font-mono whitespace-nowrap">{h.callDate}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{h.phonebankerName}</td>
                        <td className="px-2 py-1.5">{h.sourceQuestionName}</td>
                        <td className="px-2 py-1.5">{h.sourceAnswerValue}</td>
                        <td className="px-2 py-1.5">{h.displayLabel}</td>
                        <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">
                          {formatSynthesisReason(h.reason)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
