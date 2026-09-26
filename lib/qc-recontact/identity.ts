/**
 * Voter name and address from a Scale to Win `callees.data` JSON blob.
 * Keys vary by list upload, so matching is case-insensitive and ignores spaces and underscores.
 */

export type CalleeIdentity = {
  voterName: string;
  voterAddress: string;
};

const FULL_NAME_KEYS = ["fullname", "votername", "voter", "name"];
const FIRST_NAME_KEYS = ["firstname", "fname", "v1firstname", "givenname"];
const LAST_NAME_KEYS = ["lastname", "lname", "v1lastname", "surname", "familyname"];

/** Suffixes such as `contactresaddress1` from `Contact RES_ADDRESS1`. Exact short keys are matched separately. */
const STREET_LINE1_SUFFIXES = [
  "resaddress1",
  "address1",
  "addressline1",
  "streetaddress",
  "residenceaddress",
  "homeaddress",
];
const STREET_LINE2_SUFFIXES = ["resaddress2", "address2", "addressline2"];
const STREET_EXACT_KEYS = ["address", "street"];
const CITY_SUFFIXES = ["rescity"];
const STATE_SUFFIXES = ["resstate"];
const ZIP_SUFFIXES = ["reszip", "zipcode", "postalcode"];

function canonicalKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function scalarText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function indexValues(data: unknown): Map<string, string> {
  const indexed = new Map<string, string>();
  if (!data || typeof data !== "object" || Array.isArray(data)) return indexed;
  for (const [key, value] of Object.entries(data)) {
    const text = scalarText(value);
    if (!text) continue;
    const canon = canonicalKey(key);
    if (!canon || indexed.has(canon)) continue;
    indexed.set(canon, text);
  }
  return indexed;
}

function pickExact(indexed: Map<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = indexed.get(key);
    if (value) return value;
  }
  return "";
}

/** `Contact RES_ADDRESS1` → key ends with `resaddress1`. Short tokens stay exact so `address` does not swallow line 2. */
function pickEnding(indexed: Map<string, string>, suffixes: readonly string[]): string {
  for (const suffix of suffixes) {
    for (const [key, value] of indexed) {
      if (key.endsWith(suffix)) return value;
    }
  }
  return "";
}

function composeName(indexed: Map<string, string>): string {
  const full = pickExact(indexed, FULL_NAME_KEYS);
  if (full) return full;
  return [pickExact(indexed, FIRST_NAME_KEYS), pickExact(indexed, LAST_NAME_KEYS)].filter(Boolean).join(" ");
}

function composeAddress(indexed: Map<string, string>): string {
  const line1 = pickEnding(indexed, STREET_LINE1_SUFFIXES) || pickExact(indexed, STREET_EXACT_KEYS);
  const line2 = pickEnding(indexed, STREET_LINE2_SUFFIXES);
  const street = [line1, line2].filter(Boolean).join(", ");
  const city = pickEnding(indexed, CITY_SUFFIXES) || pickExact(indexed, ["city"]);
  const state = pickEnding(indexed, STATE_SUFFIXES) || pickExact(indexed, ["state"]);
  const zip = pickEnding(indexed, ZIP_SUFFIXES) || pickExact(indexed, ["zip", "postal"]);
  const stateZip = [state, zip].filter(Boolean).join(" ");
  const locality = [city, stateZip].filter(Boolean).join(", ");
  return [street, locality].filter(Boolean).join(", ");
}

/** Parse callee JSON into one name line and one address line. Invalid JSON yields blanks. */
export function extractCalleeIdentity(dataJson: string): CalleeIdentity {
  const raw = dataJson.trim();
  if (!raw) return { voterName: "", voterAddress: "" };
  try {
    const indexed = indexValues(JSON.parse(raw) as unknown);
    return {
      voterName: composeName(indexed),
      voterAddress: composeAddress(indexed),
    };
  } catch {
    return { voterName: "", voterAddress: "" };
  }
}
