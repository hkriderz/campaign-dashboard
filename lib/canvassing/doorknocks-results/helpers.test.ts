import test from "node:test";
import assert from "node:assert/strict";
import {
  answerMatches,
  fixedNonContactThreshold,
  GATED_FLAG_MIN,
  isGatedNonContactLabel,
  isHostileNonContactLabel,
  isLanguageBarrierNonContactLabel,
  LANGUAGE_BARRIER_FLAG_MIN,
} from "./helpers";
import { summarizeDoorknockCampaigns } from "./analyzer";
import { DEFAULT_DOORKNOCK_SUMMARY_SETTINGS, type DoorknockCampaignReport } from "./types";

test("answerMatches bilingual strong support / undecided segments", () => {
  assert.equal(answerMatches("STRONG SUPPORT/FUERTE APOYO", ["strong support"]), true);
  assert.equal(answerMatches("UNDECIDED/INDECISO", ["undecided"]), true);
  assert.equal(answerMatches("STRONG OPPOSE/FUERTE OPOSICIÓN", ["strong support"]), false);
  assert.equal(answerMatches("STRONG SUPPORT/FUERTE APOYO", ["support"]), false);
  assert.equal(answerMatches("support", ["support"]), true);
});

test("isHostileNonContactLabel detects hostile/DNC bilingual headers", () => {
  assert.equal(
    isHostileNonContactLabel("HOSTILE/DO NOT CONTACT/HOSTIL"),
    true
  );
  assert.equal(isHostileNonContactLabel("NOT HOME"), false);
  assert.equal(isHostileNonContactLabel("GATED"), false);
});

test("fixed thresholds for gated and language barrier", () => {
  assert.equal(isGatedNonContactLabel("GATED"), true);
  assert.equal(isLanguageBarrierNonContactLabel("LANGUAGE BARRIER"), true);
  assert.equal(fixedNonContactThreshold("GATED"), GATED_FLAG_MIN);
  assert.equal(fixedNonContactThreshold("LANGUAGE BARRIER"), LANGUAGE_BARRIER_FLAG_MIN);
  assert.equal(fixedNonContactThreshold("HOSTILE/DO NOT CONTACT/HOSTIL"), 1);
  assert.equal(fixedNonContactThreshold("MOVED"), null);
});

test("summarize flags gated at 25+ and language barrier at 10+", () => {
  const campaign: DoorknockCampaignReport = {
    id: "nc-thresh",
    campaignId: "test",
    campaignName: "test",
    reportDate: "2026-07-21",
    sourceFile: {
      id: "src",
      originalName: "t.csv",
      relativePath: "t.csv",
      sizeBytes: 1,
      checksum: "x",
      rowCount: 3,
      columns: [],
    },
    detection: {
      campaignId: "test",
      campaignName: "test",
      confidence: 1,
      evidence: [],
      candidateMentions: [],
      campaignCode: null,
    },
    surveyGroups: [],
    nonContactColumns: [
      { key: "nc:gated", label: "GATED", sourceHeader: "NON-CONTACT MOBILE | GATED" },
      {
        key: "nc:lang",
        label: "LANGUAGE BARRIER",
        sourceHeader: "NON-CONTACT MOBILE | LANGUAGE BARRIER",
      },
    ],
    rows: [
      {
        canvasserName: "High Gated",
        doorsKnocked: 100,
        contacts: 10,
        contactRate: 0.1,
        surveyAnswers: {},
        nonContacts: { "nc:gated": 25, "nc:lang": 5 },
      },
      {
        canvasserName: "Mid Lang",
        doorsKnocked: 100,
        contacts: 10,
        contactRate: 0.1,
        surveyAnswers: {},
        nonContacts: { "nc:gated": 10, "nc:lang": 10 },
      },
      {
        canvasserName: "Below Both",
        doorsKnocked: 100,
        contacts: 10,
        contactRate: 0.1,
        surveyAnswers: {},
        nonContacts: { "nc:gated": 24, "nc:lang": 9 },
      },
    ],
    totals: {
      doorsKnocked: 300,
      contacts: 30,
      contactRate: 0.1,
      surveyAnswers: {},
      nonContacts: { "nc:gated": 59, "nc:lang": 24 },
    },
  };

  const summary = summarizeDoorknockCampaigns([campaign], DEFAULT_DOORKNOCK_SUMMARY_SETTINGS);
  const gated = summary.flags.non_contact_outlier.filter((f) => String(f.metrics.column) === "GATED");
  const lang = summary.flags.non_contact_outlier.filter(
    (f) => String(f.metrics.column) === "LANGUAGE BARRIER"
  );
  assert.equal(gated.length, 1);
  assert.equal(gated[0]?.canvasserName, "High Gated");
  assert.equal(lang.length, 1);
  assert.equal(lang[0]?.canvasserName, "Mid Lang");
});

test("summarize flags bilingual survey SS and any hostile count", () => {
  const campaign: DoorknockCampaignReport = {
    id: "test",
    campaignId: "eng721",
    campaignName: "eng721",
    reportDate: "2026-07-21",
    sourceFile: {
      id: "src",
      originalName: "eng721.csv",
      relativePath: "eng721.csv",
      sizeBytes: 1,
      checksum: "x",
      rowCount: 2,
      columns: [],
    },
    detection: {
      campaignId: "eng721",
      campaignName: "eng721",
      confidence: 1,
      evidence: [],
      candidateMentions: [],
      campaignCode: null,
    },
    surveyGroups: [
      {
        question: "WILL YOU SIGN THE REFERENDUM PETITION?",
        columns: [
          {
            key: "qa:ss",
            question: "WILL YOU SIGN THE REFERENDUM PETITION?",
            answer: "STRONG SUPPORT/FUERTE APOYO",
          },
          {
            key: "qa:u",
            question: "WILL YOU SIGN THE REFERENDUM PETITION?",
            answer: "UNDECIDED/INDECISO",
          },
          {
            key: "qa:so",
            question: "WILL YOU SIGN THE REFERENDUM PETITION?",
            answer: "STRONG OPPOSE/FUERTE OPOSICIÓN",
          },
        ],
      },
    ],
    nonContactColumns: [
      {
        key: "nc:hostile",
        label: "HOSTILE/DO NOT CONTACT/HOSTIL",
        sourceHeader: "NON-CONTACT MOBILE | HOSTILE/DO NOT CONTACT/HOSTIL",
      },
      {
        key: "nc:home",
        label: "NOT HOME",
        sourceHeader: "NON-CONTACT MOBILE | NOT HOME",
      },
    ],
    rows: [
      {
        canvasserName: "Frankenfeld William",
        doorsKnocked: 165,
        contacts: 11,
        contactRate: 11 / 165,
        surveyAnswers: { "qa:ss": 11, "qa:u": 0, "qa:so": 0 },
        nonContacts: { "nc:hostile": 63, "nc:home": 242 },
      },
      {
        canvasserName: "Anderson Ashia",
        doorsKnocked: 115,
        contacts: 11,
        contactRate: 11 / 115,
        surveyAnswers: { "qa:ss": 10, "qa:u": 0, "qa:so": 1 },
        nonContacts: { "nc:hostile": 0, "nc:home": 214 },
      },
      {
        canvasserName: "Melendez Tina",
        doorsKnocked: 23,
        contacts: 1,
        contactRate: 1 / 23,
        surveyAnswers: { "qa:ss": 1, "qa:u": 0, "qa:so": 0 },
        nonContacts: { "nc:hostile": 13, "nc:home": 46 },
      },
    ],
    totals: {
      doorsKnocked: 303,
      contacts: 23,
      contactRate: 23 / 303,
      surveyAnswers: { "qa:ss": 22, "qa:u": 0, "qa:so": 1 },
      nonContacts: { "nc:hostile": 76, "nc:home": 502 },
    },
  };

  const summary = summarizeDoorknockCampaigns([campaign], DEFAULT_DOORKNOCK_SUMMARY_SETTINGS);

  const frankenfeldSurvey = summary.flags.survey_support_struggle.find(
    (flag) => flag.canvasserName === "Frankenfeld William"
  );
  // 11 SS / 11 contacts = 100% — should not struggle
  assert.equal(frankenfeldSurvey, undefined);

  const hostileFlags = summary.flags.non_contact_outlier.filter(
    (flag) => String(flag.metrics.column).toLowerCase().includes("hostile")
  );
  assert.equal(hostileFlags.length, 2);
  assert.ok(hostileFlags.some((flag) => flag.canvasserName === "Frankenfeld William" && flag.metrics.value === 63));
  assert.ok(hostileFlags.some((flag) => flag.canvasserName === "Melendez Tina" && flag.metrics.value === 13));
  assert.ok(!hostileFlags.some((flag) => flag.canvasserName === "Anderson Ashia"));

  // Melendez: 1 SS / 1 contact = 100% support — not a survey struggle; low doors may flag
  const melendezSurvey = summary.flags.survey_support_struggle.find(
    (flag) => flag.canvasserName === "Melendez Tina"
  );
  assert.equal(melendezSurvey, undefined);

  // Low-support canvasser with bilingual SS counts non-zero
  const lowSupportCampaign: DoorknockCampaignReport = {
    ...campaign,
    rows: [
      {
        canvasserName: "Low Support",
        doorsKnocked: 100,
        contacts: 20,
        contactRate: 0.2,
        surveyAnswers: { "qa:ss": 2, "qa:u": 10, "qa:so": 8 },
        nonContacts: { "nc:hostile": 0, "nc:home": 80 },
      },
    ],
    totals: {
      doorsKnocked: 100,
      contacts: 20,
      contactRate: 0.2,
      surveyAnswers: { "qa:ss": 2, "qa:u": 10, "qa:so": 8 },
      nonContacts: { "nc:hostile": 0, "nc:home": 80 },
    },
  };
  const lowSummary = summarizeDoorknockCampaigns([lowSupportCampaign], DEFAULT_DOORKNOCK_SUMMARY_SETTINGS);
  const struggle = lowSummary.flags.survey_support_struggle[0];
  assert.ok(struggle);
  assert.equal(struggle.metrics.strongSupport, 2);
  assert.equal(struggle.metrics.undecided, 10);
  assert.equal(struggle.metrics.support, 2);
});
