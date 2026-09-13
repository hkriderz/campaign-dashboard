"use client";

import { useEffect, useMemo, useState } from "react";
import { formatShortUsDate } from "@/lib/slice-key";
import { formatSurveyColumnHeader, questionCanonicalGroupKey } from "@/lib/survey-i18n/column-label-gloss";
import { questionLooksLikeDisclaimer } from "@/lib/survey-i18n/rules";
import type { SurveyScriptProfile } from "@/lib/types";
import {
  changeKindLabel,
  recontactChannelLabel,
  type QcRecontactDetailPayload,
  type QcRecontactPair,
  type QcRecontactSurveyAnswer,
} from "@/lib/qc-recontact";

type AlignedRow = {
  key: string;
  question: string;
  priorAnswer: string;
  qcAnswer: string;
};

function usableAnswers(rows: readonly QcRecontactSurveyAnswer[]): QcRecontactSurveyAnswer[] {
  return rows.filter((row) => {
    if (questionLooksLikeDisclaimer(row.questionName)) return false;
    const av = row.answerValue.trim();
    return Boolean(row.questionName.trim()) && av && av.toLowerCase() !== "[no answer recorded]";
  });
}

function alignAnswers(
  prior: readonly QcRecontactSurveyAnswer[],
  qc: readonly QcRecontactSurveyAnswer[],
  profile: SurveyScriptProfile
): AlignedRow[] {
  const priorByKey = new Map<string, QcRecontactSurveyAnswer>();
  const qcByKey = new Map<string, QcRecontactSurveyAnswer>();
  const order: string[] = [];

  function remember(row: QcRecontactSurveyAnswer, into: Map<string, QcRecontactSurveyAnswer>) {
    const key = questionCanonicalGroupKey(row.questionName, profile) || row.questionName.trim();
    if (!key) return;
    if (!into.has(key) && !order.includes(key)) order.push(key);
    into.set(key, row);
  }

  for (const row of usableAnswers(prior)) remember(row, priorByKey);
  for (const row of usableAnswers(qc)) remember(row, qcByKey);

  return order.map((key) => {
    const priorRow = priorByKey.get(key);
    const qcRow = qcByKey.get(key);
    const questionName = qcRow?.questionName || priorRow?.questionName || key;
    return {
      key,
      question: formatSurveyColumnHeader(questionName, { spanishSlice: false, role: "question", profile }),
      priorAnswer: priorRow
        ? formatSurveyColumnHeader(priorRow.answerValue, { spanishSlice: false, role: "answer", profile })
        : "—",
      qcAnswer: qcRow
        ? formatSurveyColumnHeader(qcRow.answerValue, { spanishSlice: false, role: "answer", profile })
        : "—",
    };
  });
}

type Props = {
  tagId: string;
  pair: QcRecontactPair | null;
  surveyScriptProfile: SurveyScriptProfile;
  onClose: () => void;
};

export default function QcRecontactModal({ tagId, pair, surveyScriptProfile, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<QcRecontactDetailPayload | null>(null);

  useEffect(() => {
    if (!pair) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setDetail(null);

    const pdi = encodeURIComponent(pair.qc.pdiId || "none");
    const params = new URLSearchParams({ qcCallId: pair.qc.callId });
    void fetch(`/api/phonebanking/${encodeURIComponent(tagId)}/recontact/${pdi}?${params}`, {
      signal: ac.signal,
    })
      .then(async (res) => {
        const body = (await res.json()) as { ok?: boolean; data?: QcRecontactDetailPayload; error?: string };
        if (!res.ok || !body.ok || !body.data) {
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        setDetail(body.data);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [pair, tagId]);

  useEffect(() => {
    if (!pair) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pair, onClose]);

  const aligned = useMemo(
    () => (detail ? alignAnswers(detail.priorAnswers, detail.qcAnswers, surveyScriptProfile) : []),
    [detail, surveyScriptProfile]
  );

  if (!pair) return null;

  const priors = pair.priors;
  const latestPrior = priors[0] ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qc-recontact-title"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
          <h2 id="qc-recontact-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Recontact {pair.qc.pdiId || "—"} · {changeKindLabel(pair.changeKind)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-sm"
          >
            Close
          </button>
        </div>
        <div className="p-4 overflow-auto text-sm text-gray-800 dark:text-gray-200 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Prior {latestPrior ? recontactChannelLabel(latestPrior.channel) : "—"}
              </div>
              {priors.length ? (
                priors.map((item, index) => (
                  <dl
                    key={`${item.channel}-${item.callId ?? item.callAt ?? item.occurredOn}-${index}`}
                    className={index > 0 ? "space-y-1 text-sm border-t border-gray-100 dark:border-gray-800 pt-3" : "space-y-1 text-sm"}
                  >
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Channel</dt>
                      <dd className="font-medium">{recontactChannelLabel(item.channel)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Who</dt>
                      <dd className="font-medium">{item.actorName || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">When</dt>
                      <dd>{formatShortUsDate(item.occurredOn)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">List</dt>
                      <dd>{item.listOrAssignment || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Result</dt>
                      <dd>{item.resultLabel || "—"}</dd>
                    </div>
                  </dl>
                ))
              ) : (
                <p className="mt-2 text-gray-500 dark:text-gray-400">No prior phone bank or canvass for this PDI.</p>
              )}
            </div>
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/50 p-3 bg-indigo-50/40 dark:bg-indigo-950/20">
              <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                QC call
              </div>
              <dl className="mt-2 space-y-1 text-sm">
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">Who</dt>
                  <dd className="font-medium">{pair.qc.phonebankerName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">When</dt>
                  <dd>{formatShortUsDate(pair.qc.callDate)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">List</dt>
                  <dd>{pair.qc.campaignName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">Result</dt>
                  <dd>{pair.qc.finalResultLabel || "—"}</dd>
                </div>
              </dl>
            </div>
          </div>

          {loading ? (
            <p className="text-gray-500 dark:text-gray-400">Loading survey answers…</p>
          ) : error ? (
            <p className="text-rose-600 dark:text-rose-400">{error}</p>
          ) : aligned.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No survey answers on file for this pair.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-2 py-2 font-semibold">Question</th>
                    <th className="px-2 py-2 font-semibold">Prior</th>
                    <th className="px-2 py-2 font-semibold">QC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {aligned.map((row) => {
                    const changed = row.priorAnswer !== row.qcAnswer;
                    return (
                      <tr key={row.key} className={changed ? "bg-amber-50/70 dark:bg-amber-950/20" : undefined}>
                        <td className="px-2 py-1.5 align-top">{row.question}</td>
                        <td className="px-2 py-1.5 align-top">{row.priorAnswer}</td>
                        <td className="px-2 py-1.5 align-top">{row.qcAnswer}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
