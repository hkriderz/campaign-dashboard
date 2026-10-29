import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFlyerFlagAnswer,
  classifyLitFlagAnswer,
  classifyLitFlagCode,
  parseLitFlagsCsv,
} from "./lit-flags-parser";
import { classifyFlyerAnswer, classifyLitObservation, isFlyerReceiptQuestion } from "./lit-qc";

const SAMPLE = `PDIID,STATEID,USERNAME,FLAGNAME,FLAGENTRYDATE,RESPONSECODE,RESPONSEDESCRIPTION,CANDIDATEDESCRIPTION,SURVEYQUESTIONSHORTTEXT,CANVASSERNAME,MOBILEPROJECTASSIGMENT,PHONEBANK,COUNTYASSIGNEDID,PRECINCT
CA53089227,41354042,Hari Yirga,Mobile Canvassing,2026-10-24T13:22:22.230,NHNL,Didn't See Lit,,Lit Observation,Curtis Forshey,Nithya NH Lit QC for 10-23-26 - abc==,day 1 pt 2,19530602195,199000825B
CA10834560,10893449,Hari Yirga,Mobile Canvassing,2026-10-24T17:07:18.793,NHYL,Not Home Saw Lit,,Lit Observation,Mario Zarceno,Nithya NH Lit QC for 10-23-26 - def==,,19338547871,199002134B
CA1050358,42632011,Hari Yirga,Mobile Canvassing,2026-10-26T18:56:41.683,USA Flag,HH has USA Flag,,Lit Observation,Abigail Garcia,Outreach Lit and Contact QC of 10-24 and 10-25 - ghi==,,19530975115,199001692C
CA12721125,1,Hari Yirga,Mobile Canvassing,2026-10-24T14:47:00.000,GF,Got a Flyer,,Did you receive our flyer yesterday?,Kenny Castro,Nithya NH Lit QC for 10-23-26 - xyz==,,1,1
CA999,1,Hari Yirga,Mobile Canvassing,2026-10-24T12:00:00.000,SS,Strong Support,,Support?,Someone Else,Other project,,1,1
`;

test("classifyLitFlagCode maps NHNL / NHYL; USA Flag is blank", () => {
  assert.equal(classifyLitFlagCode("NHNL"), "didnt");
  assert.equal(classifyLitFlagCode("NHYL"), "saw");
  assert.equal(classifyLitFlagCode("USA Flag"), null);
});

test("classifyLitObservation accepts flag descriptions and codes; USA flag is blank", () => {
  assert.equal(classifyLitObservation("Didn't See Lit"), "didnt");
  assert.equal(classifyLitObservation("Not Home Saw Lit"), "saw");
  assert.equal(classifyLitObservation("HH has USA Flag"), null);
  assert.equal(classifyLitObservation("NHNL"), "didnt");
  assert.equal(classifyLitObservation("NHYL"), "saw");
});

test("classifyLitFlagAnswer falls back to RESPONSECODE", () => {
  assert.equal(classifyLitFlagAnswer("", "NHYL"), "saw");
  assert.equal(classifyLitFlagAnswer("garbage", "NHNL"), "didnt");
});

test("classifyFlyerFlagAnswer maps flyer codes and descriptions", () => {
  assert.equal(classifyFlyerFlagAnswer("Got a Flyer", "GF"), "got");
  assert.equal(classifyFlyerFlagAnswer("", "DGF"), "didnt");
  assert.equal(classifyFlyerAnswer("DIDN'T GET FLYER"), "didnt");
  assert.equal(isFlyerReceiptQuestion("Did you receive our flyer yesterday?"), true);
});

test("parseLitFlagsCsv maps lit and flyer rows; USA flag is skipped as unclassified", () => {
  const parsed = parseLitFlagsCsv(SAMPLE, "lit observation qc flags.csv");
  assert.equal(parsed.litRows, 2);
  assert.equal(parsed.flyerRows, 1);
  assert.equal(parsed.skippedOther, 1);
  assert.equal(parsed.skippedUnclassified, 1);
  assert.equal(parsed.rows.length, 3);

  const byId = new Map(parsed.rows.map((row) => [row.primaryId, row]));
  assert.equal(byId.get("CA53089227")?.canvasserName, "Curtis Forshey");
  assert.equal(byId.get("CA53089227")?.response, "Didn't See Lit");
  assert.equal(byId.get("CA53089227")?.question, "Lit Observation");
  assert.ok(byId.get("CA53089227")?.assignmentName.includes("10-23-26"));

  assert.equal(byId.get("CA10834560")?.response, "Not Home Saw Lit");
  assert.equal(classifyLitObservation(byId.get("CA10834560")!.response), "saw");
  assert.equal(byId.has("CA1050358"), false);

  assert.equal(byId.get("CA12721125")?.question, "Did you receive our flyer yesterday?");
  assert.equal(byId.get("CA12721125")?.response, "Got a Flyer");
  assert.equal(classifyFlyerAnswer(byId.get("CA12721125")!.response), "got");
});

test("parseLitFlagsCsv dedupes identical lit rows", () => {
  const dup = `${SAMPLE.split("\n")[0]}
CA53089227,41354042,Hari Yirga,Mobile Canvassing,2026-10-24T13:22:22.230,NHNL,Didn't See Lit,,Lit Observation,Curtis Forshey,Nithya NH Lit QC for 10-23-26 - abc==,day 1 pt 2,19530602195,199000825B
CA53089227,41354042,Hari Yirga,Mobile Canvassing,2026-10-24T13:22:22.230,NHNL,Didn't See Lit,,Lit Observation,Curtis Forshey,Nithya NH Lit QC for 10-23-26 - abc==,day 1 pt 2,19530602195,199000825B
`;
  const parsed = parseLitFlagsCsv(dup);
  assert.equal(parsed.rows.length, 1);
});

test("parseLitFlagsCsv rejects missing headers", () => {
  assert.throws(() => parseLitFlagsCsv("FOO,BAR\n1,2\n"), /missing required columns/i);
});
