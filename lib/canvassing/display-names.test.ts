import test from "node:test";
import assert from "node:assert/strict";
import { buildDisplayNameMap, splitDisplayName } from "./display-names";

test("splitDisplayName handles First Last and Last, First", () => {
  assert.deepEqual(splitDisplayName("Ashia Anderson"), {
    first: "Ashia",
    last: "Anderson",
    full: "Ashia Anderson",
  });
  assert.deepEqual(splitDisplayName("Anderson, Ashia"), {
    first: "Ashia",
    last: "Anderson",
    full: "Anderson, Ashia",
  });
});

test("buildDisplayNameMap abbreviates until collision", () => {
  const map = buildDisplayNameMap(["Ashia Anderson", "Tina Melendez", "Ashia Alvarez"]);
  assert.equal(map.get("Tina Melendez"), "Tina M.");
  assert.equal(map.get("Ashia Anderson"), "Ashia Anderson");
  assert.equal(map.get("Ashia Alvarez"), "Ashia Alvarez");
});
