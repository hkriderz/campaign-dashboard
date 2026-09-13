import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyKnockSupportResponse,
  filterKnockIndexRows,
  isNonContactQuestion,
  isPledgeOrSecondaryQuestion,
  pickSupportOutcome,
  tallyCanvassingOverview,
  type KnockIndexTallyRow,
} from "./overview-tally";

function row(partial: Partial<KnockIndexTallyRow> & Pick<KnockIndexTallyRow, "primaryId" | "occurredAt">): KnockIndexTallyRow {
  return {
    canvasserName: "Sam Door",
    assignmentName: "Nithya Eng 9-5-26",
    question: "Can we count on you to support Nithya Raman for mayor?",
    response: "Strong Support",
    ...partial,
  };
}

test("classifies bilingual support labels and ignores non-contact questions", () => {
  assert.equal(classifyKnockSupportResponse("Strong Support"), "strong_support");
  assert.equal(classifyKnockSupportResponse("STRONG SUPPORT/FUERTE APOYO"), "strong_support");
  assert.equal(classifyKnockSupportResponse("Support"), "support");
  assert.equal(classifyKnockSupportResponse("Undecided"), "undecided");
  assert.equal(classifyKnockSupportResponse("UNDECIDED/INDECISO"), "undecided");
  assert.equal(classifyKnockSupportResponse("Strong Oppose"), "strong_oppose");
  assert.equal(classifyKnockSupportResponse("Oppose"), "oppose");
  assert.equal(classifyKnockSupportResponse("Not Home, Left Flyer"), null);
  assert.equal(isNonContactQuestion("Non-Contact Mobile"), true);
  assert.equal(isPledgeOrSecondaryQuestion("Will you sign to pledge to vote yes on the billionaire tax Prop 40?"), true);
});

test("unique PRIMARYID x day knocks and one support outcome per canvasser per day", () => {
  const tally = tallyCanvassingOverview([
    row({
      primaryId: "ca1",
      occurredAt: "2026-09-05T14:22:36.000-07:00",
      question: "Non-Contact Mobile",
      response: "Not Home, Left Flyer",
    }),
    row({
      primaryId: "CA1",
      occurredAt: "2026-09-05T15:10:00.000-07:00",
      response: "Undecided",
    }),
    row({
      primaryId: "CA1",
      occurredAt: "2026-09-05T16:00:00.000-07:00",
      response: "Strong Support",
    }),
    row({
      primaryId: "CA2",
      occurredAt: "2026-09-06T11:00:00.000-07:00",
      canvasserName: "Other Person",
      response: "Oppose",
    }),
  ]);

  assert.equal(tally.stats.knocks, 2);
  assert.equal(tally.stats.contacts, 2);
  assert.equal(tally.stats.surveyed, 2);
  assert.equal(tally.stats.strongSupport, 1);
  assert.equal(tally.stats.oppose, 1);
  assert.equal(tally.canvassers.length, 2);
  const sam = tally.canvassers.find((item) => item.canvasserName === "Sam Door");
  assert.equal(sam?.knocks, 1);
  assert.equal(sam?.daysWorked, 1);
  assert.equal(sam?.strongSupport, 1);
  assert.equal(sam?.surveyed, 1);
});

test("pledge answers do not steal the ID/support tally unless they are the only classified row", () => {
  const withId = [
    {
      ...row({ primaryId: "CA9", occurredAt: "2026-09-05T14:00:00.000-07:00", response: "Strong Support" }),
      day: "2026-09-05",
      personId: "CA9",
      outcome: "strong_support" as const,
      isContact: true,
    },
    {
      ...row({
        primaryId: "CA9",
        occurredAt: "2026-09-05T14:05:00.000-07:00",
        question: "Will you sign to pledge to vote yes on Prop 40?",
        response: "Undecided",
      }),
      day: "2026-09-05",
      personId: "CA9",
      outcome: "undecided" as const,
      isContact: true,
    },
  ];
  assert.equal(pickSupportOutcome(withId), "strong_support");

  const pledgeOnly = [
    {
      ...row({
        primaryId: "CA8",
        occurredAt: "2026-09-05T14:05:00.000-07:00",
        question: "Will you sign to pledge to vote yes on Prop 40?",
        response: "Undecided",
      }),
      day: "2026-09-05",
      personId: "CA8",
      outcome: "undecided" as const,
      isContact: true,
    },
  ];
  assert.equal(pickSupportOutcome(pledgeOnly), "undecided");
});

test("date filter uses the LA calendar day", () => {
  const rows = [
    row({ primaryId: "CA1", occurredAt: "2026-09-05T14:00:00.000-07:00" }),
    row({ primaryId: "CA2", occurredAt: "2026-09-12T10:00:00.000-07:00" }),
  ];
  const filtered = filterKnockIndexRows(rows, { startDate: "2026-09-07", endDate: "2026-09-12" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.primaryId, "CA2");
});
