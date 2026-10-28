import test from "node:test";
import assert from "node:assert/strict";
import { buildDisplayNameMap, cleanCanvasserName, splitDisplayName } from "./display-names";

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

test("cleanCanvasserName collapses a repeated surname and a doubled full name", () => {
  assert.equal(cleanCanvasserName("Smith, John Smith"), "John Smith");
  assert.equal(cleanCanvasserName("John Smith, John Smith"), "John Smith");
  assert.equal(cleanCanvasserName("John Smith John Smith"), "John Smith");
  assert.equal(cleanCanvasserName("Davila, Dilan"), "Davila, Dilan");
  const map = buildDisplayNameMap(["Smith, John Smith"]);
  assert.equal(map.get("Smith, John Smith"), "John S.");
  const collided = buildDisplayNameMap(["Smith, John Smith", "Smyth, John"]);
  assert.equal(collided.get("Smith, John Smith"), "John Smith");
  assert.equal(collided.get("Smyth, John"), "John Smyth");
});

test("buildDisplayNameMap abbreviates until collision", () => {
  const map = buildDisplayNameMap(["Ashia Anderson", "Tina Melendez", "Ashia Alvarez"]);
  assert.equal(map.get("Tina Melendez"), "Tina M.");
  assert.equal(map.get("Ashia Anderson"), "Ashia Anderson");
  assert.equal(map.get("Ashia Alvarez"), "Ashia Alvarez");
});
