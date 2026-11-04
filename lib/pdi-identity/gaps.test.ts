import assert from "node:assert/strict";
import test from "node:test";
import {
  countPdiIdentityGaps,
  eventInDateRange,
  peopleNamesFromEvents,
} from "./gaps";
import type { PdiIdentityRecord } from "./types";

test("countPdiIdentityGaps tallies missing name and address", () => {
  const byPdiId: Record<string, PdiIdentityRecord> = {
    CA1: {
      pdiId: "CA1",
      voterName: "Ada",
      voterAddress: "1 Main",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    CA2: {
      pdiId: "CA2",
      voterName: "Grace",
      voterAddress: "",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };

  const gaps = countPdiIdentityGaps(
    [
      { personId: "ca 1", voterName: "" },
      { personId: "CA2", voterName: "Grace" },
      { personId: "CA3", voterName: "" },
      { personId: "CA3", voterName: "" },
    ],
    byPdiId
  );

  assert.equal(gaps.uniqueIdCount, 3);
  assert.equal(gaps.missingName, 1); // CA3
  assert.equal(gaps.missingAddress, 2); // CA2 + CA3
  assert.equal(gaps.missingBoth, 1); // CA3
  assert.equal(gaps.identitiesSaved, 2);
});

test("peopleNamesFromEvents prefers a nonempty name", () => {
  const people = peopleNamesFromEvents([
    { personId: "CA1", voterName: "", occurredOn: "2026-01-01" },
    { personId: "CA1", voterName: "Ada", occurredOn: "2026-01-02" },
  ]);
  assert.equal(people.length, 1);
  assert.equal(people[0]?.voterName, "Ada");
});

test("eventInDateRange respects inclusive bounds", () => {
  assert.equal(eventInDateRange("2026-01-02", "2026-01-01", "2026-01-03"), true);
  assert.equal(eventInDateRange("2026-01-01", "2026-01-02", ""), false);
  assert.equal(eventInDateRange("2026-01-05", "", "2026-01-03"), false);
});
