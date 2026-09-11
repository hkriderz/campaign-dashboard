"use client";

import { Fragment, useState } from "react";
import type { TextCampaignSummary } from "@/lib/types";
import type { TextTagQuestionBlock } from "@/lib/texting-tag-rollups";
import TextTagRollup from "./TextTagRollup";

const DEFAULT_NEUTRAL_DOT = "#64748b";

type Props = {
  campaigns: TextCampaignSummary[];
  tagColor?: string;
  emptyMessage?: string;
  rollupsByCampaignId: Record<string, TextTagQuestionBlock[]>;
};

function fmt(n: number) {
  return n.toLocaleString();
}

function StatusPill({ status }: { status: TextCampaignSummary["status"] }) {
  const complete = status === "Complete";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        complete
          ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
          : "bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
      }`}
    >
      {status}
    </span>
  );
}

export default function TextCampaignTable({
  campaigns,
  tagColor = DEFAULT_NEUTRAL_DOT,
  emptyMessage,
  rollupsByCampaignId,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (!campaigns.length) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-sm py-10 text-center">
        {emptyMessage ?? "No text campaigns found for this candidate."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-900">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Campaign Name</th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Status</th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">Contacts</th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-center">Tags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {campaigns.map((campaign) => {
            const isOpen = openId === campaign.campaignId;
            const blocks = rollupsByCampaignId[campaign.campaignId] ?? [];
            return (
              <Fragment key={campaign.campaignId}>
                <tr className="hover:bg-teal-50/40 dark:hover:bg-gray-800 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 max-w-xs">
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: tagColor }}
                      />
                      {campaign.campaignName}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={campaign.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-800 dark:text-gray-200">
                    {fmt(campaign.contactCount)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => setOpenId(isOpen ? null : campaign.campaignId)}
                      aria-expanded={isOpen}
                      className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-300 hover:text-teal-900 dark:hover:text-teal-100 font-medium text-xs px-3 py-1.5 rounded-md border border-teal-200 dark:border-teal-800 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors"
                    >
                      {isOpen ? "Hide tags" : blocks.length ? "View tags" : "No tags"}
                    </button>
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="bg-gray-50/80 dark:bg-gray-800/60">
                    <td colSpan={4} className="px-4 py-4">
                      <TextTagRollup blocks={blocks} contactCount={campaign.contactCount} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
