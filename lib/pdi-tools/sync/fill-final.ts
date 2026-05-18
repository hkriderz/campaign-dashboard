import type { SyncLogger } from "./logger";
import { getFlagStrict, type MappingMaps } from "./mapping";
import type { SurveyResultRow } from "./types";

function norm(x: unknown): string {
  if (x === null || x === undefined) return "";
  return String(x).trim();
}

function finalResultQuestionNames(maps: MappingMaps): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, qid] of maps.questionMap) {
    void qid;
    const [survey, q] = key.split("\0");
    if (survey && q && q.toLowerCase().includes("final result")) {
      out.set(survey, q);
    }
  }
  return out;
}

/** Port of `fill_final_results` in `stw_to_pdi.py`. */
export function fillFinalResults(
  rows: SurveyResultRow[],
  maps: MappingMaps,
  log: SyncLogger
): { rows: SurveyResultRow[]; synthetic: SurveyResultRow[] } {
  const frByCampaign = finalResultQuestionNames(maps);
  const calls = new Map<string, SurveyResultRow[]>();

  for (const r of rows) {
    const cid = String(r.call_id ?? "");
    const list = calls.get(cid) ?? [];
    list.push(r);
    calls.set(cid, list);
  }

  const synthetic: SurveyResultRow[] = [];

  for (const [, callRows] of calls) {
    const campaign = norm(callRows[0]?.campaign_name);

    let frQname = frByCampaign.get(campaign);
    if (!frQname) {
      for (const r of callRows) {
        const qn = norm(r.question_name);
        if (qn.toLowerCase().includes("final result")) {
          frQname = qn;
          break;
        }
      }
    }
    if (!frQname) continue;

    const hasGoodFinal = callRows.some(
      (r) =>
        norm(r.question_name).toLowerCase().includes("final result") &&
        Boolean(getFlagStrict(maps, campaign, frQname, norm(r.answer_value)))
    );
    if (hasGoodFinal) continue;

    const otherRows = callRows
      .filter((r) => !norm(r.question_name).toLowerCase().includes("final result"))
      .sort((a, b) => norm(a.question_name).localeCompare(norm(b.question_name)));

    let fillRow: SurveyResultRow | null = null;
    for (let i = otherRows.length - 1; i >= 0; i--) {
      const r = otherRows[i]!;
      if (getFlagStrict(maps, campaign, frQname, norm(r.answer_value))) {
        fillRow = r;
        break;
      }
    }
    if (!fillRow) continue;

    const row: SurveyResultRow = { ...fillRow };
    row._fill_source_question = norm(fillRow.question_name);
    row.question_name = frQname;
    row._synthetic_final_result = true;
    synthetic.push(row);
  }

  if (synthetic.length > 0) {
    log.info(
      `Synthesized ${synthetic.length} missing Final Result rows from prior call answers`
    );
  }

  return { rows: [...rows, ...synthetic], synthetic };
}

export function logFinalResultCoverage(
  rows: SurveyResultRow[],
  maps: MappingMaps,
  log: SyncLogger,
  label: string
): void {
  const frByCampaign = finalResultQuestionNames(maps);
  const callsWithFinal = new Map<string, Set<string>>();
  const callsWithSubstantive = new Map<string, Set<string>>();

  for (const r of rows) {
    const campaign = norm(r.campaign_name);
    const callId = String(r.call_id ?? "");
    const question = norm(r.question_name);
    const answer = norm(r.answer_value);
    const frQname = frByCampaign.get(campaign);

    if (question.toLowerCase().includes("final result")) {
      if (answer) {
        const set = callsWithFinal.get(campaign) ?? new Set();
        set.add(callId);
        callsWithFinal.set(campaign, set);
      }
    } else if (frQname && getFlagStrict(maps, campaign, frQname, answer)) {
      const set = callsWithSubstantive.get(campaign) ?? new Set();
      set.add(callId);
      callsWithSubstantive.set(campaign, set);
    }
  }

  const campaigns = [...frByCampaign.keys()].filter(
    (c) => callsWithFinal.has(c) || callsWithSubstantive.has(c)
  );
  if (campaigns.length === 0) return;

  log.info(`Final Result coverage by campaign${label ? ` (${label})` : ""}:`);
  for (const campaign of campaigns.sort()) {
    const total = callsWithSubstantive.get(campaign)?.size ?? 0;
    const covered = callsWithFinal.get(campaign)?.size ?? 0;
    const shortfall = total - covered;
    const status = shortfall === 0 ? "OK" : shortfall > 0 ? `SHORTFALL ${shortfall}` : `SURPLUS ${-shortfall}`;
    log.info(`  ${campaign}: ${covered}/${total} calls have Final Result [${status}]`);
  }
}
