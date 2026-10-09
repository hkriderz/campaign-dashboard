import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPhonebankerRepresentativeMap,
  phonebankerLabelsLikelySamePerson,
} from "./phonebanker-dedupe";

test("Brenda is not Freyda Natzmer (fuzzy first-name false positive)", () => {
  assert.equal(phonebankerLabelsLikelySamePerson("Brenda", "Freyda Natzmer"), false);
});

test("first-only does not merge with first+last", () => {
  assert.equal(phonebankerLabelsLikelySamePerson("Brenda", "Brenda Salas"), false);
  assert.equal(phonebankerLabelsLikelySamePerson("Tatianna", "Tatianna S"), false);
  assert.equal(phonebankerLabelsLikelySamePerson("Gabriel", "Gabriel Guerrero"), false);
});

test("same first name with different last names do not merge", () => {
  assert.equal(phonebankerLabelsLikelySamePerson("Maria Garcia", "Maria Lopez"), false);
});

test("typo last names with same first name still merge", () => {
  assert.equal(
    phonebankerLabelsLikelySamePerson("Gabriel Guerrero", "Gabriel Guerroro"),
    true
  );
});

test("identical single-token names merge; similar single-token names do not", () => {
  assert.equal(phonebankerLabelsLikelySamePerson("Hugo", "Hugo"), true);
  assert.equal(phonebankerLabelsLikelySamePerson("Brenda", "Freyda"), false);
});

test("representative map keeps Brenda and Freyda distinct and merges Guerrero typo", () => {
  const map = buildPhonebankerRepresentativeMap([
    "Brenda",
    "Brenda Salas",
    "Freyda Natzmer",
    "Gabriel Guerrero",
    "Gabriel Guerroro",
  ]);
  assert.equal(map.get("Brenda"), "Brenda");
  assert.equal(map.get("Brenda Salas"), "Brenda Salas");
  assert.equal(map.get("Freyda Natzmer"), "Freyda Natzmer");
  assert.equal(map.get("Gabriel Guerroro"), "Gabriel Guerrero");
  assert.equal(map.get("Gabriel Guerrero"), "Gabriel Guerrero");
});
