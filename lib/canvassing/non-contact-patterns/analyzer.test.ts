import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import type { CanvassingKnockEvent } from "../types";
import { analyzeNonContactPatternEvents, detectTimestampResolution } from "./analyzer";
import {
  isSameHousehold,
  voterLastName,
  deriveStratumTag,
  isNonContactMobile,
} from "./helpers";

function event(partial: Partial<CanvassingKnockEvent> & Pick<CanvassingKnockEvent, "canvasserName" | "voter" | "occurredAt" | "question">): CanvassingKnockEvent {
  return {
    assignmentName: partial.assignmentName ?? "Eng GG Walk 7-22-26 - 1",
    primaryId: partial.primaryId ?? "",
    phone: partial.phone ?? "",
    dateTimeRaw: partial.dateTimeRaw ?? partial.occurredAt,
    parseConfidence: 0.95,
    response: partial.response ?? "",
    sourceFileId: "test",
    sourceFileName: "test.csv",
    sourceRowNumber: partial.sourceRowNumber ?? 1,
    ...partial,
  };
}

test("voterLastName takes last whitespace token", () => {
  assert.equal(voterLastName("ALI LANDEROS LOPEZ"), "LOPEZ");
  assert.equal(voterLastName("  BRANDON BERMEO "), "BERMEO");
});

test("isSameHousehold matches shared phone or last name", () => {
  assert.equal(
    isSameHousehold(
      { phone: "714-638-0647", voter: "ALI LANDEROS LOPEZ" },
      { phone: "7146380647", voter: "LUCILA LANDEROS" }
    ),
    true
  );
  assert.equal(
    isSameHousehold(
      { phone: "", voter: "GARY GONG" },
      { phone: "", voter: "WU GONG" }
    ),
    true
  );
  assert.equal(
    isSameHousehold(
      { phone: "", voter: "BRANDON BERMEO" },
      { phone: "7145346403", voter: "KAREN MILLAN" }
    ),
    false
  );
});

test("blended-family edge: different last names and phones are not same household", () => {
  assert.equal(
    isSameHousehold(
      { phone: "111", voter: "JANE SMITH" },
      { phone: "222", voter: "JOHN DOE" }
    ),
    false
  );
});

test("deriveStratumTag from assignment prefix", () => {
  assert.equal(deriveStratumTag("Esp GG Walk 7-9-26 - 3014018"), "esp");
  assert.equal(deriveStratumTag("Eng GG Walk 7-21-26 - 3014316"), "eng");
});

test("streak accumulation and non-contact flags", () => {
  const base = "2026-07-21T13:00:00.000-07:00";
  const events = [
    event({
      canvasserName: "Test, Canvasser",
      voter: "A ONE",
      occurredAt: base,
      question: "Non-Contact Mobile",
      sourceRowNumber: 1,
      phone: "1",
    }),
    event({
      canvasserName: "Test, Canvasser",
      voter: "B TWO",
      occurredAt: "2026-07-21T13:00:05.000-07:00",
      question: "Non-Contact Mobile",
      sourceRowNumber: 2,
      phone: "2",
    }),
    event({
      canvasserName: "Test, Canvasser",
      voter: "C THREE",
      occurredAt: "2026-07-21T13:00:10.000-07:00",
      question: "Non-Contact Mobile",
      sourceRowNumber: 3,
      phone: "3",
    }),
    event({
      canvasserName: "Test, Canvasser",
      voter: "D FOUR",
      occurredAt: "2026-07-21T13:00:12.000-07:00",
      question: "Non-Contact Mobile",
      sourceRowNumber: 4,
      phone: "4",
    }),
    event({
      canvasserName: "Test, Canvasser",
      voter: "E FIVE",
      occurredAt: "2026-07-21T13:00:14.000-07:00",
      question: "Non-Contact Mobile",
      sourceRowNumber: 5,
      phone: "5",
    }),
  ];

  const result = analyzeNonContactPatternEvents(events);
  assert.equal(result.summary.timestampResolution, "second");
  assert.equal(result.flaggedNonContactRows.length, 4);
  const streaks = result.flaggedNonContactRows.map((r) => r.streakLength);
  assert.deepEqual(streaks, [1, 2, 3, 4]);
  assert.equal(result.canvasserSummaries[0]?.longestRapidNonContactStreak, 4);
  assert.equal(result.canvasserSummaries[0]?.streakAlert, true);
});

test("same-timestamp household batch is not flagged", () => {
  const ts = "2026-07-21T13:20:52.000-07:00";
  const events = [
    event({
      canvasserName: "Acosta, Carmen",
      voter: "IGNACIO LANDEROS",
      phone: "9164128338",
      occurredAt: ts,
      question: "Non-Contact Mobile",
      sourceRowNumber: 1,
    }),
    event({
      canvasserName: "Acosta, Carmen",
      voter: "ALI LANDEROS LOPEZ",
      phone: "7146380647",
      occurredAt: ts,
      question: "Non-Contact Mobile",
      sourceRowNumber: 2,
    }),
    event({
      canvasserName: "Acosta, Carmen",
      voter: "LUCILA LANDEROS",
      phone: "7146380647",
      occurredAt: ts,
      question: "Non-Contact Mobile",
      sourceRowNumber: 3,
    }),
  ];
  const result = analyzeNonContactPatternEvents(events);
  // gap 0 between same-timestamp rows → not flagged (requires 0 < gap)
  assert.equal(result.flaggedNonContactRows.length, 0);
});

test("rapid contact flag for different contact voters within 30s", () => {
  const events = [
    event({
      canvasserName: "X, Y",
      voter: "VOTER A",
      occurredAt: "2026-07-21T13:30:00.000-07:00",
      question: "Will you sign?",
      response: "Yes",
      phone: "1",
      sourceRowNumber: 1,
    }),
    event({
      canvasserName: "X, Y",
      voter: "VOTER B",
      occurredAt: "2026-07-21T13:30:10.000-07:00",
      question: "Will you sign?",
      response: "Yes",
      phone: "2",
      sourceRowNumber: 2,
    }),
  ];
  const result = analyzeNonContactPatternEvents(events);
  assert.equal(result.flaggedContactRows.length, 1);
  assert.equal(result.flaggedNonContactRows.length, 0);
});

test("minimum-denominator guard marks insufficient sample", () => {
  const events = [
    event({
      canvasserName: "Small, Sample",
      voter: "A",
      occurredAt: "2026-07-21T13:00:00.000-07:00",
      question: "Non-Contact Mobile",
      phone: "1",
      sourceRowNumber: 1,
    }),
    event({
      canvasserName: "Small, Sample",
      voter: "B",
      occurredAt: "2026-07-21T13:00:05.000-07:00",
      question: "Non-Contact Mobile",
      phone: "2",
      sourceRowNumber: 2,
    }),
  ];
  const result = analyzeNonContactPatternEvents(events);
  const summary = result.canvasserSummaries[0]!;
  assert.equal(summary.rapidNonContactCount, 1);
  assert.equal(summary.rateSampleInsufficient, true);
  assert.equal(summary.rapidNonContactRate, null);
});

test("fixture integration: 7_22 CSV", async () => {
  const fixture = path.join(process.cwd(), "canvassref", "Canvasser Details - (7_22_2026).csv");
  assert.ok(fs.existsSync(fixture), `missing fixture ${fixture}`);

  const { analyzeNonContactPatternFile } = await import("./analyzer");
  const buffer = fs.readFileSync(fixture);
  const ingestion = await analyzeNonContactPatternFile({
    fileName: path.basename(fixture),
    buffer,
  });

  assert.equal(ingestion.splitByDate, false);
  assert.equal(ingestion.results.length, 1);
  const result = ingestion.results[0]!;

  assert.equal(result.summary.timestampResolution, "second");
  assert.ok(result.summary.totalRows > 1000);
  assert.ok(result.canvasserSummaries.length > 5);

  // Brandon BERMEO → Karen MILLAN (1s gap) should be flagged
  const bermeoFlag = result.flaggedNonContactRows.find(
    (r) => /BERMEO/i.test(r.voter) && r.canvasserName.includes("Acosta")
  );
  assert.ok(bermeoFlag, "expected BERMEO rapid non-contact flag");
  assert.ok(
    bermeoFlag!.gapToNextSeconds !== null && bermeoFlag!.gapToNextSeconds <= 15
  );

  // LANDEROS family shared phone / last name at same timestamp should not flag between members
  const landerosFlags = result.flaggedNonContactRows.filter((r) =>
    /LANDEROS/i.test(r.voter)
  );
  // May still appear if transitioning TO a non-household next row; ensure no LANDEROS→LANDEROS same-household rapid flags
  for (const row of result.enrichedRows.filter((r) => /LANDEROS/i.test(r.voter))) {
    if (row.sameHouseholdAsNext) {
      assert.equal(row.rapidNonContactFlag, false);
    }
  }
  void landerosFlags;

  assert.ok(
    result.canvasserSummaries.some((s) => s.rapidNonContactCount > 0),
    "expected at least one canvasser with rapid flags"
  );
  assert.ok(result.metricsSnapshot, "expected metrics snapshot");
  assert.equal(result.metricsSnapshot!.schemaVersion, 1);
});

test("isNonContactMobile ignores RESPONSE emptiness", () => {
  assert.equal(isNonContactMobile("Non-Contact Mobile"), true);
  assert.equal(isNonContactMobile("non-contact mobile"), true);
  assert.equal(isNonContactMobile("Will you sign?"), false);
});

test("detectTimestampResolution returns second for second-level events", () => {
  const events = [
    event({
      canvasserName: "A",
      voter: "V1",
      occurredAt: "2026-07-21T13:00:24.000-07:00",
      dateTimeRaw: "07/21/2026 01:00:24",
      question: "Non-Contact Mobile",
      sourceRowNumber: 1,
    }),
    event({
      canvasserName: "A",
      voter: "V2",
      occurredAt: "2026-07-21T13:01:37.000-07:00",
      dateTimeRaw: "07/21/2026 01:01:37",
      question: "Non-Contact Mobile",
      sourceRowNumber: 2,
    }),
  ];
  assert.equal(detectTimestampResolution(events).resolution, "second");
});
