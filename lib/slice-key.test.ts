import test from "node:test";
import assert from "node:assert/strict";
import {
  csvSliceKeyAgainstBq,
  dailyCallerSliceKey,
  makeBqSliceKey,
  makeSliceKey,
} from "./slice-key";

test("same display name on one date yields two BQ slice keys when ids differ", () => {
  const date = "2026-09-02";
  const name = "Nithya PB 9.2 PDI supporters";
  const a = makeBqSliceKey("campaign-a", name, date);
  const b = makeBqSliceKey("campaign-b", name, date);
  assert.notEqual(a, b);
  assert.equal(a, "id:campaign-a|2026-09-02");
  assert.equal(b, "id:campaign-b|2026-09-02");
  assert.equal(makeSliceKey(name, date), makeSliceKey(name, date));
});

test("dailyCallerSliceKey uses campaign id when present", () => {
  assert.equal(
    dailyCallerSliceKey({
      campaignId: "abc",
      campaignName: "Nithya PB 9.2 PDI supporters",
      callDate: "2026-09-02",
    }),
    "id:abc|2026-09-02"
  );
  assert.equal(
    dailyCallerSliceKey({
      campaignId: "",
      campaignName: "CSV Only Bank",
      callDate: "2026-09-02",
    }),
    makeSliceKey("CSV Only Bank", "2026-09-02")
  );
});

test("CSV attaches to BQ slice only when exactly one id uses that name", () => {
  const date = "2026-09-02";
  const name = "Nithya PB 9.2 PDI supporters";
  const one = csvSliceKeyAgainstBq(name, date, [
    { campaignId: "a", campaignName: name, callDate: date },
  ]);
  assert.equal(one, "id:a|2026-09-02");

  const two = csvSliceKeyAgainstBq(name, date, [
    { campaignId: "a", campaignName: name, callDate: date },
    { campaignId: "b", campaignName: name, callDate: date },
  ]);
  assert.equal(two, makeSliceKey(name, date));
  assert.notEqual(two, "id:a|2026-09-02");
});
