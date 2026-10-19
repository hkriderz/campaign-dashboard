import test from "node:test";
import assert from "node:assert/strict";
import { analyzePendingApprovalUploads } from "./analyzer";
import { assignmentCampaignPrefix, isGenericPendingApprovalName, parsePendingApprovalCsv } from "./parser";

function csvFile(name: string, body: string) {
  return { fileName: name, relativePath: name, buffer: Buffer.from(body, "utf-8") };
}

const THREE_THEN_FOUR = [
  ",,,,,,,,Non-Contact Mobile,,Will you support Ada Lovelace?,,,Will you support a later question,,,",
  "CanvasserName,AssignmentName,TotalHouses,NonContactCount,ContactCount,GeoCheck,TimingCheck,LastSyn,NH,HOSTILE,SS,U,SO,SS,LS,U,SO",
  '"Ada, Countess","10-18-26 Sample GOTV - Turf 1",40,30,10,No,Yes,undefined,28,2,2,4,4,1,8,0,1',
  "Total,,,,,,,,,,,,,",
].join("\n");

const FOUR_FIRST = [
  ",,,,,,,,Non-Contact Mobile,Will you support Ada Lovelace?,,,,",
  "CanvasserName,AssignmentName,TotalHouses,NonContactCount,ContactCount,GeoCheck,TimingCheck,LastSyn,NH,SS,LS,U,SO",
  '"Ada, Countess","10-18-26 Sample GOTV - 101826NL-4",20,10,10,Yes,Yes,ok,10,2,4,2,2',
].join("\n");

test("assignment prefix drops a turf suffix", () => {
  assert.equal(
    assignmentCampaignPrefix("10-18-26 Nithya Latino East LA GOTV - 101826NL-81"),
    "10-18-26 Nithya Latino East LA GOTV"
  );
  assert.equal(assignmentCampaignPrefix("CA48 10-18-26 Pass - CD48 Turf 32"), "CA48 10-18-26 Pass");
  assert.equal(isGenericPendingApprovalName("PendingApprovalReport (11).csv"), true);
  assert.equal(isGenericPendingApprovalName("CA48 October.csv"), false);
});

test("parser maps doors, contacts, forward-filled groups, and assignment campaign name", () => {
  const parsed = parsePendingApprovalCsv(csvFile("PendingApprovalReport (1).csv", THREE_THEN_FOUR));
  assert.equal(parsed.report?.campaignName, "10-18-26 Sample GOTV");
  assert.equal(parsed.report?.reportDate, "2026-10-18");
  assert.equal(parsed.report?.rows.length, 1);
  const row = parsed.report?.rows[0];
  assert.equal(row?.canvasserName, "Ada, Countess");
  assert.equal(row?.doorsKnocked, 40);
  assert.equal(row?.contacts, 10);
  assert.equal(row?.geoCheck, "No");
  assert.equal(row?.timingCheck, "Yes");
  assert.equal(parsed.report?.surveyGroups.length, 2);
  assert.deepEqual(
    parsed.report?.surveyGroups[0]?.columns.map((column) => column.answer),
    ["Strong Support", "Undecided", "Strong Oppose"]
  );
  assert.deepEqual(
    parsed.report?.surveyGroups[1]?.columns.map((column) => column.answer),
    ["Strong Support", "Lean Support", "Undecided", "Strong Oppose"]
  );
  assert.deepEqual(
    parsed.report?.nonContactColumns.map((column) => column.label),
    ["Not Home", "Hostile"]
  );
});

test("named files use the filename as the campaign", () => {
  const parsed = parsePendingApprovalCsv(csvFile("CA48 October.csv", FOUR_FIRST));
  assert.equal(parsed.report?.campaignName, "CA48 October");
});

test("three-answer first question uses SS only, and a later LS column does not change the struggle rate", async () => {
  const report = await analyzePendingApprovalUploads([csvFile("PendingApprovalReport (2).csv", THREE_THEN_FOUR)]);
  const struggle = report.summary.flags.survey_support_struggle;
  assert.equal(struggle.length, 1);
  assert.equal(struggle[0]?.metrics.support, 2);
  assert.equal(struggle[0]?.metrics.strongSupport, 2);
  const lowDoors = report.summary.flags.low_doors_low_support.find((flag) => flag.canvasserName === "Ada, Countess");
  assert.equal(lowDoors?.metrics.strongSupport, 2);
  assert.equal(report.summary.flags.geo_timing_check.length, 1);
  assert.match(report.summary.flags.geo_timing_check[0]?.message ?? "", /Geo No/);
  assert.equal(
    report.summary.flags.non_contact_outlier.some((flag) => String(flag.metrics.column) === "Hostile"),
    true
  );
  assert.equal(
    report.summary.flags.non_contact_outlier.some((flag) => String(flag.metrics.column) === "Not Home"),
    false
  );
});

const SHIFTED_HEADERS = [
  ',,,,,,,,"Non-Contact Mobile",,,,,"Will you support Ada Lovelace?",,"Will you text your friends right now and tell them to vote?","Will you vote NO on Prop 39?","Vote Right Now?","Will you donate?"',
  "CanvasserName,AssignmentName,TotalHouses,NonContactCount,ContactCount,GeoCheck,TimingCheck,LastSyn,NH,MV,HOSTILE,GTD,D,DECL,SS,U,SO,SS,WTL8R,SO,SS,U,SO,VRN,LAT,VIP,No,AV,DRN,WDL,U,WND",
  '"Ada, Countess","10-18-26 Sample GOTV - Turf 9",80,70,10,Yes,No,ok,40,1,0,2,0,3,2,4,4,1,6,1,8,1,1,1,2,3,0,4,0,1,2,3',
].join("\n");

test("shifted group headers still follow flag families", () => {
  const parsed = parsePendingApprovalCsv(csvFile("PendingApprovalReport (9).csv", SHIFTED_HEADERS));
  assert.deepEqual(
    parsed.report?.nonContactColumns.map((column) => column.label),
    ["Not Home", "Moved", "Hostile", "Gated", "Deceased", "Declined Conversation"]
  );
  assert.deepEqual(
    parsed.report?.surveyGroups.map((group) => ({
      question: group.question,
      answers: group.columns.map((column) => column.answer),
    })),
    [
      {
        question: "Will you support Ada Lovelace?",
        answers: ["Strong Support", "Undecided", "Strong Oppose"],
      },
      {
        question: "Will you text your friends right now and tell them to vote?",
        answers: ["Strong Support", "Will Text Later", "Strong Oppose"],
      },
      {
        question: "Will you vote NO on Prop 39?",
        answers: ["Strong Support", "Undecided", "Strong Oppose"],
      },
      {
        question: "Vote Right Now?",
        answers: ["Vote Right Now", "Will Vote Later", "Vote In Person", "No Plan/Won't Vote", "Already Voted"],
      },
      {
        question: "Will you donate?",
        answers: ["Donate Now", "Will Donate Later", "Undecided", "Will Not Donate"],
      },
    ]
  );
});

test("four-answer first question counts SS + LS toward the struggle rate and SS alone as strong support", async () => {
  const report = await analyzePendingApprovalUploads([csvFile("PendingApprovalReport (3).csv", FOUR_FIRST)]);
  assert.equal(report.summary.flags.survey_support_struggle.length, 0);
  const lowDoors = report.summary.flags.low_doors_low_support[0];
  assert.ok(lowDoors);
  assert.equal(lowDoors?.metrics.strongSupport, 2);
  assert.equal(report.summary.flags.geo_timing_check.length, 0);
});
