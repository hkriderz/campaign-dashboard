import test from "node:test";
import assert from "node:assert/strict";
import {
  LIT_QC_UNMATCHED,
  buildLitQc,
  buildLitQcDetailTsv,
  classifyFlyerAnswer,
  classifyLitObservation,
  filterLitQc,
  filterLitQcCanvasserRows,
  findLitQcCanvasser,
  flattenLitQcDetails,
  isFlyerReceiptQuestion,
  knockOccurredBefore,
  litQcCanvasserOptions,
  litQcSummaryCanvassers,
  priorDatesFromAssignment,
  withoutLitQcHouseholds,
} from "./lit-qc";
import type { LitQcSourceRow } from "./lit-qc";
import { recontactNamesMatch } from "../qc-recontact/names";

function row(partial: Partial<LitQcSourceRow> & Pick<LitQcSourceRow, "question" | "response">): LitQcSourceRow {
  return {
    primaryId: "p1",
    canvasserName: "Quinn, Casey",
    assignmentName: "NH QC",
    occurredAt: "2026-10-27T18:00:00.000Z",
    voterName: "Ada Lopez",
    ...partial,
  };
}

test("lit and flyer answers use the doorknocks labels; USA flag is blank", () => {
  assert.equal(classifyLitObservation("DIDN'T SEE LIT: NO HAY VOLANTE"), "didnt");
  assert.equal(classifyLitObservation("SAW LIT: SÍHAY VOLANTE"), "saw");
  assert.equal(classifyLitObservation("HH HAS USA FLAG"), null);
  assert.equal(classifyFlyerAnswer("GOT A FLYER/RECIBÍ UN FOLLETO"), "got");
  assert.equal(classifyFlyerAnswer("DIDN'T GET FLYER/NO RECIBÍ EL FOLLETO."), "didnt");
  assert.equal(classifyFlyerAnswer("UNDECIDED"), "undecided");
});

test("two voters at one timestamp are one household under the canvasser who left the lit", () => {
  const tally = buildLitQc([
    row({
      canvasserName: "Delavigne Matthew",
      assignmentName: "Boyle Heights 10-26",
      occurredAt: "2026-10-26T17:00:00.000Z",
      question: "Non-Contact Mobile",
      response: "NOT HOMELEFT FLYER/DEJÓ VOLANTE",
      primaryId: "a",
      voterName: "Ada Lopez",
    }),
    row({
      canvasserName: "Delavigne, Matthew",
      assignmentName: "Boyle Heights 10-26",
      occurredAt: "2026-10-26T17:00:00.000Z",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "b",
      voterName: "Ben Lopez",
    }),
    row({
      canvasserName: "Quinn, Casey",
      question: "LIT OBSERVATION",
      response: "SAW LIT: SÍHAY VOLANTE",
      occurredAt: "2026-10-27T20:15:00.000Z",
      primaryId: "a",
      voterName: "Ada Lopez",
    }),
    row({
      canvasserName: "Quinn, Casey",
      question: "DID YOU RECEIVE OUR FLYER YESTERDAY?/¿RECIBIÓ NUESTRO FOLLETO AYER?",
      response: "GOT A FLYER/RECIBÍ UN FOLLETO",
      occurredAt: "2026-10-27T20:15:00.000Z",
      primaryId: "a",
    }),
    row({
      canvasserName: "Quinn, Casey",
      question: "LIT OBSERVATION",
      response: "SAW LIT",
      occurredAt: "2026-10-27T20:15:00.000Z",
      primaryId: "b",
      voterName: "Ben Lopez",
    }),
    row({
      canvasserName: "Quinn, Casey",
      question: "DID YOU RECEIVE OUR FLYER YESTERDAY?",
      response: "DIDN'T GET FLYER",
      occurredAt: "2026-10-27T20:15:00.000Z",
      primaryId: "b",
    }),
  ]);

  assert.equal(tally.canvassers.length, 1);
  const canvasser = tally.canvassers[0]!;
  assert.equal(canvasser.canvasserName, "Delavigne Matthew");
  assert.equal(canvasser.householdsChecked, 1);
  assert.equal(canvasser.votersChecked, 2);
  assert.equal(canvasser.households[0]!.voters.length, 2);
  assert.equal(canvasser.households[0]!.sameDoorGroup, true);
  assert.equal(canvasser.households[0]!.qcCanvasser, "Quinn, Casey");
  assert.equal(canvasser.sawLit, 1);
  assert.equal(canvasser.gotFlyer, 1);
  assert.equal(canvasser.didntGetFlyer, 1);
  assert.equal(canvasser.flyerUndecided, 0);
  // got ÷ (got + undecided + didn't get)
  assert.equal(canvasser.receivedRate, 0.5);
  assert.ok(canvasser.rowId);
});

test("a QC visit with no earlier not-home stays unmatched", () => {
  const tally = buildLitQc([
    row({
      question: "LIT OBSERVATION",
      response: "DIDN'T SEE LIT",
      primaryId: "solo",
    }),
  ]);
  assert.equal(tally.canvassers[0]?.canvasserName, LIT_QC_UNMATCHED);
  assert.equal(tally.canvassers[0]?.didntSeeLit, 1);
});

test("USA flag is blank lit; disagreeing door is left out of saw-lit rate", () => {
  const tally = buildLitQc([
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk",
      occurredAt: "2026-10-25T16:00:00.000Z",
      question: "Non-Contact Mobile",
      response: "Not Home - Left Flyer",
      primaryId: "flag",
    }),
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk",
      occurredAt: "2026-10-25T16:00:00.000Z",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "saw",
    }),
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk",
      occurredAt: "2026-10-25T16:05:00.000Z",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "mix-a",
    }),
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk",
      occurredAt: "2026-10-25T16:05:00.000Z",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "mix-b",
    }),
    row({
      question: "LIT OBSERVATION",
      response: "HH HAS USA FLAG",
      occurredAt: "2026-10-27T19:00:00.000Z",
      primaryId: "flag",
    }),
    row({
      question: "LIT OBSERVATION",
      response: "SAW LIT",
      occurredAt: "2026-10-27T19:05:00.000Z",
      primaryId: "saw",
    }),
    row({
      question: "LIT OBSERVATION",
      response: "SAW LIT",
      occurredAt: "2026-10-27T19:10:00.000Z",
      primaryId: "mix-a",
    }),
    row({
      question: "LIT OBSERVATION",
      response: "DIDN'T SEE LIT",
      occurredAt: "2026-10-27T19:10:00.000Z",
      primaryId: "mix-b",
    }),
  ]);

  const canvasser = tally.canvassers[0]!;
  assert.equal(canvasser.sawLit, 1);
  assert.equal(canvasser.didntSeeLit, 0);
  assert.equal(canvasser.householdsChecked, 3);
  // USA-flag door has blank lit; only the saw door counts in the rate → 1/1.
  assert.equal(canvasser.sawLitRate, 1);
  const blank = canvasser.households.find((household) => household.lit === null && !household.litDisagreement);
  assert.ok(blank);
  const mixed = canvasser.households.find((household) => household.litDisagreement);
  assert.ok(mixed);
  assert.equal(mixed.voters.length, 2);
});

test("received % includes undecided in the denominator", () => {
  const tally = buildLitQc([
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk",
      occurredAt: "2026-10-25T16:00:00.000Z",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "a",
    }),
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk",
      occurredAt: "2026-10-25T16:00:00.000Z",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "b",
    }),
    row({
      question: "DID YOU RECEIVE OUR FLYER YESTERDAY?",
      response: "GOT A FLYER",
      occurredAt: "2026-10-27T19:00:00.000Z",
      primaryId: "a",
    }),
    row({
      question: "DID YOU RECEIVE OUR FLYER YESTERDAY?",
      response: "UNDECIDED",
      occurredAt: "2026-10-27T19:05:00.000Z",
      primaryId: "b",
    }),
  ]);
  assert.equal(tally.canvassers[0]?.gotFlyer, 1);
  assert.equal(tally.canvassers[0]?.flyerUndecided, 1);
  assert.equal(tally.canvassers[0]?.receivedRate, 0.5);
});

test("previous-day NH by a different person beats same-day NH by the QC canvasser", () => {
  const tally = buildLitQc([
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk A",
      occurredAt: "2026-10-23T16:00:00.000-07:00",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "p1",
    }),
    row({
      canvasserName: "Quinn, Casey",
      assignmentName: "Mistaken same-day NH",
      occurredAt: "2026-10-24T10:00:00.000-07:00",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "p1",
    }),
    row({
      canvasserName: "Quinn, Casey",
      assignmentName: "Nithya NH Lit QC for 10-23-26 - abc",
      occurredAt: "2026-10-24T14:00:00.000-07:00",
      question: "Lit Observation",
      response: "Saw Lit",
      primaryId: "p1",
    }),
  ]);
  assert.equal(tally.canvassers[0]?.canvasserName, "Original, Pat");
  assert.equal(tally.canvassers[0]?.households[0]?.voters[0]?.originalCanvasser, "Original, Pat");
  assert.equal(tally.canvassers[0]?.households[0]?.projectDate, "2026-10-23");
});

test("detail rows and copy TSV use the selected columns", () => {
  const tally = buildLitQc([
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk",
      occurredAt: "2026-10-25T16:00:00.000Z",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "a",
      voterName: "Ada Lopez",
    }),
    row({
      question: "LIT OBSERVATION",
      response: "SAW LIT",
      occurredAt: "2026-10-27T19:00:00.000Z",
      primaryId: "a",
      voterName: "Ada Lopez",
    }),
    row({
      question: "DID YOU RECEIVE OUR FLYER YESTERDAY?",
      response: "GOT A FLYER",
      occurredAt: "2026-10-27T19:00:00.000Z",
      primaryId: "a",
    }),
  ]);
  const details = flattenLitQcDetails(tally.canvassers);
  assert.equal(details.length, 1);
  assert.equal(details[0]!.flyer, "Got flyer");
  assert.equal(details[0]!.originalMark, "Not Home");
  const tsv = buildLitQcDetailTsv(tally.canvassers, ["voterName", "originalMark", "flyer", "litObservation"]);
  assert.match(tsv, /^Voter\tOriginal mark\tFlyer\tLit observation/);
  assert.match(tsv, /Ada Lopez\tNot Home\tGot flyer\tSaw lit/);
});

test("flyer-only QC visits leave lit observation blank instead of No lit observation", () => {
  const tally = buildLitQc([
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk",
      occurredAt: "2026-10-25T16:00:00.000Z",
      question: "Non-Contact Mobile",
      response: "NOT HOMELEFT FLYER/DEJÓ VOLANTE",
      primaryId: "a",
    }),
    row({
      question: "DID YOU RECEIVE OUR FLYER YESTERDAY?",
      response: "GOT A FLYER",
      occurredAt: "2026-10-27T19:00:00.000Z",
      primaryId: "a",
    }),
  ]);
  const detail = flattenLitQcDetails(tally.canvassers)[0]!;
  assert.equal(detail.originalMark, "Not Home");
  assert.equal(detail.litObservation, "");
  assert.equal(detail.flyer, "Got flyer");
});

test("gated counts as an earlier lit-drop prior, not only not home", () => {
  const tally = buildLitQc([
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk",
      occurredAt: "2026-10-25T16:00:00.000-07:00",
      question: "Non-Contact Mobile",
      response: "Gated/ no flyer at door/ No dejó volante",
      primaryId: "CA-GATE",
    }),
    row({
      canvasserName: "Quinn, Casey",
      assignmentName: "Lit QC for 10-25-26",
      occurredAt: "2026-10-26T12:00:00.000-07:00",
      question: "Did you receive our flyer yesterday?/¿Recibió nuestro folleto ayer?",
      response: "Didn't get Flyer",
      primaryId: "CA-GATE",
    }),
  ]);
  assert.equal(tally.canvassers[0]?.canvasserName, "Original, Pat");
  assert.equal(tally.canvassers[0]?.households[0]?.voters[0]?.originalMark, "Gated");
});

test("mixed Z and offset timestamps still match an earlier not-home", () => {
  // 11:00 LA prior stored as Z, noon LA QC stored with offset — string compare says prior is later.
  assert.equal(knockOccurredBefore("2026-10-26T18:00:00.000Z", "2026-10-26T12:00:00.000-07:00"), true);
  assert.equal(isFlyerReceiptQuestion("Did you receive our nithya flyer?"), true);

  const tally = buildLitQc([
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk 10-25-26",
      occurredAt: "2026-10-26T18:00:00.000Z",
      question: "Non-Contact Mobile",
      response: "Not Home, Left Flyer/Dejó Volante",
      primaryId: "ca 123",
    }),
    row({
      canvasserName: "Quinn, Casey",
      assignmentName: "Outreach Lit QC of 10-25-26",
      occurredAt: "2026-10-26T12:00:00.000-07:00",
      question: "Did you receive our nithya flyer?",
      response: "Got a Flyer",
      primaryId: "CA123",
    }),
  ]);

  assert.equal(tally.canvassers.length, 1);
  assert.equal(tally.canvassers[0]?.canvasserName, "Original, Pat");
  assert.equal(tally.canvassers[0]?.gotFlyer, 1);
  assert.equal(tally.canvassers[0]?.households[0]?.voters[0]?.originalMark, "Not Home");
});

test("assignment-named prior days recover a not-home on that calendar day", () => {
  assert.deepEqual(priorDatesFromAssignment("Nithya NH's Check for 9-15-26 - 199000897"), ["2026-09-15"]);
  assert.deepEqual(priorDatesFromAssignment("Outreach Lit and Contact QC of 10-24 and 10-25", 2026), [
    "2026-10-24",
    "2026-10-25",
  ]);

  const tally = buildLitQc([
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Turf",
      occurredAt: "2026-09-15T20:00:00.000-07:00",
      question: "Non-Contact Lit Drop",
      response: "Lit Drop",
      primaryId: "CA9",
    }),
    row({
      canvasserName: "Quinn, Casey",
      assignmentName: "Nithya NH's Check for 9-15-26 - 1",
      occurredAt: "2026-09-16T12:00:00.000-07:00",
      question: "Did you receive our flyer yesterday?/¿Recibió nuestro folleto ayer?",
      response: "Got a Flyer",
      primaryId: "CA9",
    }),
  ]);
  assert.equal(tally.canvassers[0]?.canvasserName, "Original, Pat");
  assert.equal(tally.canvassers[0]?.households[0]?.voters[0]?.originalMark, "Lit Drop");
});

test("date range and project filters use the original lit-drop day", () => {
  const tally = buildLitQc([
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Keep",
      occurredAt: "2026-10-20T16:00:00.000Z",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "keep",
    }),
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Drop",
      occurredAt: "2026-10-01T16:00:00.000Z",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "drop",
    }),
    row({
      question: "LIT OBSERVATION",
      response: "SAW LIT",
      occurredAt: "2026-10-27T19:00:00.000Z",
      primaryId: "keep",
    }),
    row({
      question: "LIT OBSERVATION",
      response: "SAW LIT",
      occurredAt: "2026-10-28T19:30:00.000Z",
      primaryId: "drop",
    }),
  ]);

  // Lit-drop range uses the original day (10-20), not the QC walk day (10-27).
  const filtered = filterLitQc(tally, { startDate: "2026-10-20", endDate: "2026-10-20", projects: ["Keep"] });
  assert.equal(filtered.canvassers.length, 1);
  assert.equal(filtered.canvassers[0]!.householdsChecked, 1);
  assert.equal(filtered.canvassers[0]!.households[0]!.project, "Keep");
  assert.equal(filtered.canvassers[0]!.households[0]!.projectDate, "2026-10-20");
  assert.equal(filtered.canvassers[0]!.households[0]!.voters[0]!.originalAt, "2026-10-20T16:00:00.000Z");

  const byDropMisreadAsQc = filterLitQc(tally, { startDate: "2026-10-27", endDate: "2026-10-27" });
  assert.equal(byDropMisreadAsQc.canvassers.length, 0);

  const byQcWalkDay = filterLitQc(tally, { qcStartDate: "2026-10-27", qcEndDate: "2026-10-27" });
  assert.equal(byQcWalkDay.canvassers.length, 1);
  assert.equal(byQcWalkDay.canvassers[0]!.households[0]!.project, "Keep");
  assert.equal(byQcWalkDay.canvassers[0]!.households[0]!.qcDate, "2026-10-27");

  const both = filterLitQc(tally, {
    startDate: "2026-10-20",
    endDate: "2026-10-20",
    qcStartDate: "2026-10-28",
    qcEndDate: "2026-10-28",
  });
  assert.equal(both.canvassers.length, 0);

  assert.equal(tally.minQcDate, "2026-10-27");
  assert.equal(tally.maxQcDate, "2026-10-28");

  const details = flattenLitQcDetails(filtered.canvassers);
  assert.equal(details[0]!.originalTime, "2026-10-20T16:00:00.000Z");
});

test("one lit and one flyer per PDI per QC day merge even a minute apart", () => {
  const tally = buildLitQc([
    row({
      canvasserName: "Meza, Max",
      assignmentName: "10-18-26 Nithya Latino East LA GOTV - 101826NL-208",
      occurredAt: "2026-10-23T20:00:00.000-07:00",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "CA12721125",
      voterName: "NORMA MONTERROSO",
    }),
    row({
      canvasserName: "Castro, Kenny",
      assignmentName: "Nithya NH Lit QC for 10-23-26 - abc",
      occurredAt: "2026-10-24T14:47:00.000-07:00",
      question: "Did you receive our flyer yesterday?",
      response: "Got a Flyer",
      primaryId: "CA12721125",
      voterName: "NORMA MONTERROSO",
    }),
    row({
      canvasserName: "Kenny Castro",
      assignmentName: "Nithya NH Lit QC for 10-23-26 - abc",
      occurredAt: "2026-10-24T14:48:00.000-07:00",
      question: "Lit Observation",
      response: "Didn't See Lit",
      primaryId: "CA12721125",
    }),
  ]);

  assert.equal(tally.canvassers.length, 1);
  const canvasser = tally.canvassers[0]!;
  assert.equal(canvasser.canvasserName, "Meza, Max");
  assert.equal(canvasser.householdsChecked, 1);
  assert.equal(canvasser.votersChecked, 1);
  const household = canvasser.households[0]!;
  assert.equal(household.lit, "didnt");
  assert.equal(household.voters[0]?.flyer, "got");
  assert.equal(household.qcCanvasser, "Kenny Castro");
  assert.equal(household.sameDoorGroup, false);
  assert.ok(litQcCanvasserOptions(tally.canvassers).includes("Kenny Castro"));

  const byQc = filterLitQcCanvasserRows(tally.canvassers, {
    qcCanvassers: ["Castro, Kenny"],
    namesMatch: recontactNamesMatch,
  });
  assert.equal(byQc.length, 1);

  const byPdi = filterLitQcCanvasserRows(tally.canvassers, { pdiQuery: "12721125" });
  assert.equal(byPdi.length, 1);
  assert.equal(filterLitQcCanvasserRows(tally.canvassers, { pdiQuery: "NOPE" }).length, 0);

  assert.equal(
    filterLitQcCanvasserRows(tally.canvassers, { litObservations: ["Didn't see lit"] }).length,
    1
  );
  assert.equal(filterLitQcCanvasserRows(tally.canvassers, { litObservations: ["Saw lit"] }).length, 0);
  assert.equal(filterLitQcCanvasserRows(tally.canvassers, { flyerAnswers: ["Got flyer"] }).length, 1);
  assert.equal(filterLitQcCanvasserRows(tally.canvassers, { flyerAnswers: ["Didn't get flyer"] }).length, 0);

  const summaryOnly = litQcSummaryCanvassers(tally.canvassers);
  assert.deepEqual(summaryOnly[0]?.households, []);
  assert.equal(filterLitQcCanvasserRows(summaryOnly, {}).length, 1);
  assert.equal(filterLitQcCanvasserRows(summaryOnly, {})[0]?.householdsChecked, 1);
  // Detail filters stay open until households are present (summary → details fetch).
  assert.equal(filterLitQcCanvasserRows(summaryOnly, { pdiQuery: "12721125" }).length, 1);
});

test("same PDI on two QC days stays two visits; same-time PDIs are one household", () => {
  const tally = buildLitQc([
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk",
      occurredAt: "2026-10-23T16:00:00.000-07:00",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "CA1",
    }),
    row({
      canvasserName: "Original, Pat",
      assignmentName: "Walk",
      occurredAt: "2026-10-23T16:00:00.000-07:00",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "CA2",
    }),
    row({
      canvasserName: "QC, One",
      occurredAt: "2026-10-24T14:00:00.000-07:00",
      question: "Lit Observation",
      response: "Saw Lit",
      primaryId: "CA1",
    }),
    row({
      canvasserName: "QC, One",
      occurredAt: "2026-10-24T14:00:00.000-07:00",
      question: "Lit Observation",
      response: "Didn't See Lit",
      primaryId: "CA2",
    }),
    row({
      canvasserName: "QC, Two",
      occurredAt: "2026-10-25T15:00:00.000-07:00",
      question: "Lit Observation",
      response: "USA Flag",
      primaryId: "CA1",
    }),
  ]);

  const canvasser = tally.canvassers.find((row) => row.canvasserName === "Original, Pat");
  assert.ok(canvasser);
  assert.equal(canvasser!.householdsChecked, 2);
  assert.equal(canvasser!.votersChecked, 3);
  const sameTime = canvasser!.households.find((household) => household.sameDoorGroup);
  assert.ok(sameTime);
  assert.equal(sameTime!.voters.length, 2);
  assert.equal(sameTime!.litDisagreement, true);
  const laterDay = canvasser!.households.find((household) => household.voters.length === 1);
  assert.ok(laterDay);
  assert.equal(laterDay!.lit, null);
});

test("summary canvassers drop households; findLitQcCanvasser keeps details by rowId", () => {
  const tally = buildLitQc([
    row({
      canvasserName: "Original, Pat",
      assignmentName: "NH Walk 10-20-26",
      occurredAt: "2026-10-20T16:00:00.000Z",
      question: "Non-Contact Mobile",
      response: "Not Home",
      primaryId: "CA1",
    }),
    row({
      canvasserName: "QC, One",
      occurredAt: "2026-10-27T18:00:00.000Z",
      question: "Lit Observation",
      response: "Saw Lit",
      primaryId: "CA1",
    }),
  ]);
  const full = tally.canvassers[0];
  assert.ok(full);
  assert.ok(full!.households.length > 0);
  const summary = litQcSummaryCanvassers(tally.canvassers)[0];
  assert.ok(summary);
  assert.equal(summary!.rowId, full!.rowId);
  assert.equal(summary!.householdsChecked, full!.householdsChecked);
  assert.deepEqual(summary!.households, []);
  assert.deepEqual(withoutLitQcHouseholds(full!).households, []);
  const found = findLitQcCanvasser(tally.canvassers, full!.rowId);
  assert.equal(found?.households.length, full!.households.length);
  assert.equal(findLitQcCanvasser(tally.canvassers, "missing"), null);
});
