import test from "node:test";
import assert from "node:assert/strict";
import { classifyTextContactTag } from "./texting-tag-labels";

test("Nithya support tags map to Strong Support / Oppose / Undecided / Neither", () => {
  assert.deepEqual(classifyTextContactTag("NithyaMayorYES", "nithya"), {
    question: "Support",
    answer: "Strong Support",
    kind: "support",
  });
  assert.deepEqual(classifyTextContactTag("NithyaMayor_YES", "nithya"), {
    question: "Support",
    answer: "Strong Support",
    kind: "support",
  });
  assert.deepEqual(classifyTextContactTag("NithyaMayor_SupportBass", "nithya"), {
    question: "Support",
    answer: "Strong Oppose",
    kind: "support",
  });
  assert.deepEqual(classifyTextContactTag("NithyaMayor_Undecided", "nithya"), {
    question: "Support",
    answer: "Undecided",
    kind: "support",
  });
  assert.deepEqual(classifyTextContactTag("NithyaMayor_Neither", "nithya"), {
    question: "Support",
    answer: "Neither",
    kind: "support",
  });
});

test("Nithya Moved tags are a separate block", () => {
  assert.deepEqual(classifyTextContactTag("Moved2026", "nithya"), {
    question: "Moved",
    answer: "Recently moved",
    kind: "moved",
  });
  assert.deepEqual(classifyTextContactTag("Moved", "qc-nithya"), {
    question: "Moved",
    answer: "Recently moved",
    kind: "moved",
  });
});

test("unmapped Nithya tags fall through to Other", () => {
  assert.deepEqual(classifyTextContactTag("SomeNewFlag", "nithya"), {
    question: "Other",
    answer: "SomeNewFlag",
    kind: "other",
  });
});

test("generic candidates split on underscore", () => {
  const got = classifyTextContactTag("FaizahPitch_StrongSupport", "faizah");
  assert.equal(got.question, "Faizah Pitch");
  assert.equal(got.answer, "Strong Support");
  assert.equal(got.kind, "other");
});
