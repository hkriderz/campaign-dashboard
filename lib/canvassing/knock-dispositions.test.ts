import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKnockDispositionFlags,
  buildKnockSupportCounts,
  firstKnockSupportQuestion,
  isLikelyContactKnock,
} from "./knock-dispositions";
import type { CanvassingKnockEvent } from "./types";

function event(partial: Partial<CanvassingKnockEvent> & Pick<CanvassingKnockEvent, "question" | "response">): CanvassingKnockEvent {
  return {
    canvasserName: "Smith, John Smith",
    assignmentName: "",
    voter: "Voter",
    primaryId: "1",
    phone: "",
    dateTimeRaw: "",
    occurredAt: "2026-10-26T20:00:00.000Z",
    parseConfidence: 1,
    sourceFileId: "f",
    sourceFileName: "f.csv",
    sourceRowNumber: 2,
    ...partial,
  };
}

test("non-contact question rows are not contacts, and hostile flags by response", () => {
  assert.equal(isLikelyContactKnock("Non-Contact Mobile", "Talked"), false);
  assert.equal(isLikelyContactKnock("Lit Observation", "Saw lit"), true);
  const flags = buildKnockDispositionFlags([
    event({ question: "Non-Contact Mobile", response: "HOSTILE/DANGEROUS/DO NOT CONTACT", primaryId: "1" }),
    event({
      canvasserName: "John Smith",
      question: "Non-Contact Mobile",
      response: "Moved",
      primaryId: "2",
      occurredAt: "2026-10-26T20:05:00.000Z",
    }),
    event({ question: "Lit Observation", response: "Saw lit", primaryId: "3" }),
  ]);
  assert.deepEqual(
    flags.map((flag) => `${flag.canvasserName}:${flag.label}:${flag.count}`),
    ["John Smith:Hostile:1", "John Smith:Moved:1"]
  );
});

test("support counts use the first question that records strong support", () => {
  const events = [
    event({ question: "Lit Observation", response: "Saw lit", occurredAt: "2026-10-26T20:00:00.000Z", primaryId: "1" }),
    event({
      question: "Did you receive our flyer?",
      response: "Undecided",
      occurredAt: "2026-10-26T20:01:00.000Z",
      primaryId: "1",
    }),
    event({
      question: "Can we count on you to support Nithya?",
      response: "Strong Support",
      occurredAt: "2026-10-26T20:02:00.000Z",
      primaryId: "1",
    }),
  ];
  const question = firstKnockSupportQuestion(events);
  assert.equal(question, "Can we count on you to support Nithya?");
  const counts = buildKnockSupportCounts(events, question);
  assert.equal(counts[0]?.canvasserName, "John Smith");
  assert.equal(counts[0]?.strongSupport, 1);
  assert.equal(counts[0]?.undecided, 0);
});
