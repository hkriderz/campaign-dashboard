import test from "node:test";
import assert from "node:assert/strict";
import { extractCalleeIdentity } from "./identity";

test("extractCalleeIdentity composes first and last name with a street line", () => {
  const identity = extractCalleeIdentity(
    JSON.stringify({
      "First Name": "Ada",
      "Last Name": "Lovelace",
      Address: "1 Main St",
      City: "Los Angeles",
      State: "CA",
      Zip: "90001",
    })
  );
  assert.equal(identity.voterName, "Ada Lovelace");
  assert.equal(identity.voterAddress, "1 Main St, Los Angeles, CA 90001");
});

test("extractCalleeIdentity prefers a full name and v1 address keys", () => {
  const identity = extractCalleeIdentity(
    JSON.stringify({
      v1_firstname: "Ignored",
      v1_lastname: "Ignored",
      full_name: "Grace Hopper",
      street_address: "2 Navy Way",
      city: "Arlington",
      state: "VA",
      zip_code: "22201",
    })
  );
  assert.equal(identity.voterName, "Grace Hopper");
  assert.equal(identity.voterAddress, "2 Navy Way, Arlington, VA 22201");
});

test("extractCalleeIdentity joins Contact RES_ADDRESS lines", () => {
  const identity = extractCalleeIdentity(
    JSON.stringify({
      "First Name": "Ada",
      "Last Name": "Lovelace",
      "Contact RES_ADDRESS1": "123 Boyle Ave",
      "Contact RES_ADDRESS2": "Apt 4",
      "Contact RES_CITY": "Los Angeles",
      "Contact RES_STATE": "CA",
      "Contact RES_ZIP": "90033",
    })
  );
  assert.equal(identity.voterName, "Ada Lovelace");
  assert.equal(identity.voterAddress, "123 Boyle Ave, Apt 4, Los Angeles, CA 90033");
});

test("extractCalleeIdentity returns blanks for invalid or empty JSON", () => {
  assert.deepEqual(extractCalleeIdentity(""), { voterName: "", voterAddress: "" });
  assert.deepEqual(extractCalleeIdentity("not-json"), { voterName: "", voterAddress: "" });
  assert.deepEqual(extractCalleeIdentity("{}"), { voterName: "", voterAddress: "" });
});
