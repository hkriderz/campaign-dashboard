import test from "node:test";
import assert from "node:assert/strict";
import { collapseTextRowsToLatestStatus } from "./collapse-text";
import { normalizeTextSyncRow } from "../text-tag-stw-data";
import type { SurveyResultRow } from "./types";

function classified(row: {
  campaign_name: string;
  answer_value: string;
  pdi_id: string;
  call_time: string;
}): SurveyResultRow {
  const out = normalizeTextSyncRow(row);
  assert.ok(out);
  return out;
}

test("same campaign and PDI keeps the latest Support status only", () => {
  const yes = classified({
    campaign_name: "Nithya Endorsement Announcement 9/1/26 - UH Local 11 PAC",
    answer_value: "NithyaMayorYES",
    pdi_id: "CA18678463",
    call_time: "2026-09-02 10:00:00",
  });
  const undecided = classified({
    campaign_name: "Nithya Endorsement Announcement 9/1/26 - UH Local 11 PAC",
    answer_value: "NithyaMayor_Undecided",
    pdi_id: "CA18678463",
    call_time: "2026-09-03 10:00:00",
  });

  const { rows, collapsedCount } = collapseTextRowsToLatestStatus([yes, undecided]);
  assert.equal(collapsedCount, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.answer_value, "Undecided");
  assert.equal(rows[0]?._source_answer, "NithyaMayor_Undecided");
  assert.equal(rows[0]?.pdi_id, "CA18678463");
});

test("same-day tags keep the later timestamp; ties keep the later row", () => {
  const neither = classified({
    campaign_name: "Nithya PAC",
    answer_value: "NithyaMayor_Neither",
    pdi_id: "CA26055546",
    call_time: "2026-09-02 09:00:00",
  });
  const undecided = classified({
    campaign_name: "Nithya PAC",
    answer_value: "NithyaMayor_Undecided",
    pdi_id: "CA26055546",
    call_time: "2026-09-02 15:00:00",
  });
  const { rows } = collapseTextRowsToLatestStatus([neither, undecided]);
  assert.equal(rows[0]?.answer_value, "Undecided");

  const first = classified({
    campaign_name: "Nithya PAC",
    answer_value: "NithyaMayorYES",
    pdi_id: "CA1",
    call_time: "2026-09-02 12:00:00",
  });
  const second = classified({
    campaign_name: "Nithya PAC",
    answer_value: "NithyaMayor_SupportBass",
    pdi_id: "CA1",
    call_time: "2026-09-02 12:00:00",
  });
  const tied = collapseTextRowsToLatestStatus([first, second]);
  assert.equal(tied.rows[0]?.answer_value, "Strong Oppose");
});

test("different campaigns keep their own Support status for the same PDI", () => {
  const pac = classified({
    campaign_name: "Nithya PAC",
    answer_value: "NithyaMayorYES",
    pdi_id: "CA41134777",
    call_time: "2026-09-08 10:00:00",
  });
  const article = classified({
    campaign_name: "Nithya Campaign 9/6/26 Article",
    answer_value: "NithyaMayor_SupportBass",
    pdi_id: "CA41134777",
    call_time: "2026-09-08 11:00:00",
  });

  const { rows, collapsedCount } = collapseTextRowsToLatestStatus([pac, article]);
  assert.equal(collapsedCount, 0);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.answer_value).sort(),
    ["Strong Oppose", "Strong Support"]
  );
});

test("Support and Moved for the same person are both kept", () => {
  const support = classified({
    campaign_name: "Nithya PAC",
    answer_value: "NithyaMayorYES",
    pdi_id: "CA123",
    call_time: "2026-09-02 10:00:00",
  });
  const moved = classified({
    campaign_name: "Nithya PAC",
    answer_value: "Moved2026",
    pdi_id: "CA123",
    call_time: "2026-09-02 09:00:00",
  });

  const { rows, collapsedCount } = collapseTextRowsToLatestStatus([support, moved]);
  assert.equal(collapsedCount, 0);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.question_name).sort(),
    ["Moved", "Support"]
  );
});

test("distinct Other tags for the same person are both kept", () => {
  const optOut = classified({
    campaign_name: "School Board GOTV",
    answer_value: "OptOut",
    pdi_id: "CA123",
    call_time: "2026-09-02 09:00:00",
  });
  const wrong = classified({
    campaign_name: "School Board GOTV",
    answer_value: "WrongNumber",
    pdi_id: "CA123",
    call_time: "2026-09-02 10:00:00",
  });

  const { rows, collapsedCount } = collapseTextRowsToLatestStatus([optOut, wrong]);
  assert.equal(collapsedCount, 0);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.answer_value).sort(),
    ["OptOut", "WrongNumber"]
  );
});
