import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import type { CanvassingKnockEvent } from "../types";
import { analyzeNonContactPatternEvents, detectTimestampResolution } from "./analyzer";
import { computeTeamBaseline, scoreCanvassersAgainstBaseline } from "./baseline";
import type { HistoricalReportDay } from "./historical";
import {
  classifyHouseholdMatch,
  shouldSuppressAsHousehold,
  isSameHousehold,
  voterLastName,
  deriveStratumTag,
  isNonContactMobile,
  dominantResponseShare,
} from "./helpers";
import { emptyGapHistogram } from "./histogram";
import { METRICS_SCHEMA_VERSION, type CanvasserMetricsSnapshot } from "./types";

function event(partial: Partial<CanvassingKnockEvent> & Pick<CanvassingKnockEvent, "canvasserName" | "voter" | "occurredAt" | "question">): CanvassingKnockEvent {
  return {
    assignmentName: partial.assignmentName ?? "Eng GG Walk 7-22-26 - 1",
    primaryId: partial.primaryId ?? "",
    phone: partial.phone ?? "",
    dateTimeRaw: partial.dateTimeRaw ?? partial.occurredAt,
    parseConfidence: 0.95,
    response: partial.response ?? "Not Home",
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

test("classifyHouseholdMatch: phone, last name, or none", () => {
  assert.equal(
    classifyHouseholdMatch(
      { phone: "714-638-0647", voter: "ALI LANDEROS LOPEZ" },
      { phone: "7146380647", voter: "LUCILA LANDEROS" }
    ),
    "phone"
  );
  assert.equal(
    classifyHouseholdMatch(
      { phone: "", voter: "GARY GONG" },
      { phone: "", voter: "WU GONG" }
    ),
    "last_name"
  );
  assert.equal(
    classifyHouseholdMatch(
      { phone: "", voter: "BRANDON BERMEO" },
      { phone: "7145346403", voter: "KAREN MILLAN" }
    ),
    "none"
  );
});

test("shouldSuppressAsHousehold: phone or last_name always suppress", () => {
  assert.equal(shouldSuppressAsHousehold("phone", 10), true);
  assert.equal(shouldSuppressAsHousehold("last_name", 0), true);
  assert.equal(shouldSuppressAsHousehold("last_name", 10), true);
  assert.equal(shouldSuppressAsHousehold("none", 0), false);
  assert.equal(shouldSuppressAsHousehold("none", 10), false);
});

test("isSameHousehold still true for phone or last name (legacy)", () => {
  assert.equal(
    isSameHousehold(
      { phone: "", voter: "GARY GONG" },
      { phone: "", voter: "WU GONG" }
    ),
    true
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
  assert.equal(result.flaggedNonContactRows.filter((r) => r.rapidNonContactFlag).length, 4);
  const streaks = result.flaggedNonContactRows
    .filter((r) => r.rapidNonContactFlag)
    .map((r) => r.streakLength);
  assert.deepEqual(streaks, [1, 2, 3, 4]);
  assert.equal(result.canvasserSummaries[0]?.longestRapidNonContactStreak, 4);
  assert.equal(result.canvasserSummaries[0]?.streakAlert, true);
  assert.equal(result.canvasserSummaries[0]?.burstAlert, true);
  assert.ok((result.canvasserSummaries[0]?.maxBurstCount ?? 0) >= 5);
});

test("same-second different households are not flagged (gap 0 is not a PDI rapid mark)", () => {
  const ts = "2026-07-21T13:20:52.000-07:00";
  const events = [
    event({
      canvasserName: "Fast, Marker",
      voter: "ALPHA ONE",
      phone: "111",
      occurredAt: ts,
      question: "Non-Contact Mobile",
      sourceRowNumber: 1,
    }),
    event({
      canvasserName: "Fast, Marker",
      voter: "BETA TWO",
      phone: "222",
      occurredAt: ts,
      question: "Non-Contact Mobile",
      sourceRowNumber: 2,
    }),
  ];
  const result = analyzeNonContactPatternEvents(events);
  assert.equal(result.enrichedRows[0]?.gapToNextSeconds, 0);
  assert.equal(result.enrichedRows[0]?.rapidNonContactFlag, false);
  assert.equal(result.flaggedNonContactRows.filter((r) => r.rapidNonContactFlag).length, 0);
  assert.equal(result.canvasserSummaries[0]?.maxBurstCount, 1);
  assert.equal(result.canvasserSummaries[0]?.burstAlert, false);
});

test("same-timestamp same last-name household batch is not flagged", () => {
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
      voter: "MARIA LANDEROS",
      phone: "7146380647",
      occurredAt: ts,
      question: "Non-Contact Mobile",
      sourceRowNumber: 2,
    }),
    event({
      canvasserName: "Acosta, Carmen",
      voter: "LUCILA LANDEROS",
      phone: "5550001111",
      occurredAt: ts,
      question: "Non-Contact Mobile",
      sourceRowNumber: 3,
    }),
  ];
  const result = analyzeNonContactPatternEvents(events);
  assert.equal(result.flaggedNonContactRows.filter((r) => r.rapidNonContactFlag).length, 0);
  for (const row of result.enrichedRows) {
    if (row.sameHouseholdAsNext) {
      assert.equal(row.rapidNonContactFlag, false);
      assert.equal(row.householdMatchKind, "last_name");
    }
  }
});

test("same last name with positive gap and different phones is not flagged", () => {
  const events = [
    event({
      canvasserName: "Street, Common",
      voter: "ANA GARCIA",
      phone: "111",
      occurredAt: "2026-07-21T13:00:00.000-07:00",
      question: "Non-Contact Mobile",
      sourceRowNumber: 1,
    }),
    event({
      canvasserName: "Street, Common",
      voter: "LUIS GARCIA",
      phone: "222",
      occurredAt: "2026-07-21T13:00:10.000-07:00",
      question: "Non-Contact Mobile",
      sourceRowNumber: 2,
    }),
  ];
  const result = analyzeNonContactPatternEvents(events);
  assert.equal(result.enrichedRows[0]?.householdMatchKind, "last_name");
  assert.equal(result.enrichedRows[0]?.sameHouseholdAsNext, true);
  assert.equal(result.enrichedRows[0]?.rapidNonContactFlag, false);
});

test("burst alerts across a 20s internal gap that breaks pairwise streak", () => {
  // Gaps: 10, 10, 20, 10 — pairwise streak breaks at the 20s gap (>15),
  // but all 5 marks fit in a 90s window.
  const times = [
    "2026-07-21T13:00:00.000-07:00",
    "2026-07-21T13:00:10.000-07:00",
    "2026-07-21T13:00:20.000-07:00",
    "2026-07-21T13:00:40.000-07:00",
    "2026-07-21T13:00:50.000-07:00",
  ];
  const events = times.map((occurredAt, i) =>
    event({
      canvasserName: "Burst, Case",
      voter: `VOTER ${i}`,
      phone: String(i + 1),
      occurredAt,
      question: "Non-Contact Mobile",
      sourceRowNumber: i + 1,
      response: "Not Home",
    })
  );
  const result = analyzeNonContactPatternEvents(events);
  const summary = result.canvasserSummaries[0]!;
  assert.equal(summary.burstAlert, true);
  assert.equal(summary.maxBurstCount, 5);
  assert.ok(result.enrichedRows.every((r) => r.inBurstFlag));
  // Pairwise rapid flags exist for 10s gaps but streak resets at 20s
  assert.ok(summary.longestRapidNonContactStreak < 4);
  assert.equal(summary.dominantRapidResponseShare, 1);
  assert.equal(summary.rapidOrBurstResponseSample, 5);
});

test("dominantResponseShare helper", () => {
  assert.equal(dominantResponseShare(["Not Home", "Not Home", "Moved"]), 2 / 3);
  assert.equal(dominantResponseShare([]), null);
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
  assert.equal(result.flaggedNonContactRows.filter((r) => r.rapidNonContactFlag).length, 0);
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

test("metrics snapshot includes nonContactRate and maxBurstCount (schema v2)", () => {
  const events = Array.from({ length: 5 }, (_, i) =>
    event({
      canvasserName: "Snap, Shot",
      voter: `V${i}`,
      phone: String(i + 1),
      occurredAt: `2026-07-21T13:00:${String(i * 2).padStart(2, "0")}.000-07:00`,
      question: "Non-Contact Mobile",
      sourceRowNumber: i + 1,
    })
  );
  const result = analyzeNonContactPatternEvents(events);
  assert.ok(result.metricsSnapshot);
  assert.equal(result.metricsSnapshot!.schemaVersion, METRICS_SCHEMA_VERSION);
  const snap = result.metricsSnapshot!.canvassers[0]!;
  assert.equal(snap.totalRows, 5);
  assert.equal(snap.nonContactRate, 1);
  assert.ok(snap.maxBurstCount >= 5);
});

test("baseline medianNonContactRate from history; burst and uniformity tier signals", () => {
  function daySnap(
    reportDate: string,
    canvassers: CanvasserMetricsSnapshot[]
  ): HistoricalReportDay {
    return {
      reportId: reportDate,
      reportDate,
      name: reportDate,
      rapidNonContactFlagCount: 0,
      flaggedCanvasserCount: 0,
      metricsSnapshot: {
        schemaVersion: METRICS_SCHEMA_VERSION,
        reportDate,
        analyzedAt: `${reportDate}T12:00:00.000Z`,
        timestampResolution: "second",
        stratumTag: "eng",
        sourceChecksum: "x",
        teamGapHistogram: emptyGapHistogram(),
        canvassers,
      },
    };
  }

  const peer = (name: string, ncRate: number): CanvasserMetricsSnapshot => ({
    canvasserName: name,
    totalRows: 100,
    nonContactRowCount: Math.round(ncRate * 100),
    nonContactRate: ncRate,
    nonContactGapCount: 20,
    rapidNonContactCount: 1,
    rapidNonContactRate: 0.05,
    longestStreak: 1,
    rapidContactCount: 0,
    maxBurstCount: 2,
    gapHistogram: { ...emptyGapHistogram(), "30-60": 20 },
    knocksPerHour: 20,
    stratumTag: "eng",
  });

  const history = [
    daySnap("2026-07-18", [peer("A", 0.4), peer("B", 0.5), peer("C", 0.45)]),
    daySnap("2026-07-19", [peer("A", 0.42), peer("B", 0.48), peer("C", 0.5)]),
    daySnap("2026-07-20", [peer("A", 0.41), peer("B", 0.49), peer("C", 0.46)]),
  ];

  const baseline = computeTeamBaseline(history);
  assert.ok(baseline.medianNonContactRate !== null);
  assert.ok(baseline.medianNonContactRate! > 0.3 && baseline.medianNonContactRate! < 0.6);

  const burstEvents = Array.from({ length: 5 }, (_, i) =>
    event({
      canvasserName: "Burst, Peer",
      voter: `V${i}`,
      phone: String(i + 1),
      occurredAt: `2026-07-21T14:00:${String(i * 3).padStart(2, "0")}.000-07:00`,
      question: "Non-Contact Mobile",
      response: "Not Home",
      sourceRowNumber: i + 1,
    })
  );
  const analyzed = analyzeNonContactPatternEvents(burstEvents);
  const scores = scoreCanvassersAgainstBaseline({
    summaries: analyzed.canvasserSummaries,
    baseline,
    history,
  });
  const score = scores[0]!;
  assert.equal(score.anomalyTier, 1);
  assert.ok(score.signals.some((s) => /Burst alert/i.test(s)));
  assert.ok(score.signals.some((s) => /Response uniformity/i.test(s)));
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

  // Same-household suppressions should never carry a rapid NC flag
  for (const row of result.enrichedRows.filter((r) => /LANDEROS/i.test(r.voter))) {
    if (row.sameHouseholdAsNext) {
      assert.equal(row.rapidNonContactFlag, false);
    }
  }

  assert.ok(
    result.canvasserSummaries.some((s) => s.rapidNonContactCount > 0),
    "expected at least one canvasser with rapid flags"
  );
  assert.ok(
    result.canvasserSummaries.some((s) => s.maxBurstCount > 0),
    "expected burst counts computed"
  );
  assert.ok(result.metricsSnapshot, "expected metrics snapshot");
  assert.equal(result.metricsSnapshot!.schemaVersion, METRICS_SCHEMA_VERSION);
  assert.ok(
    result.metricsSnapshot!.canvassers.some((c) => typeof c.nonContactRate === "number")
  );
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
