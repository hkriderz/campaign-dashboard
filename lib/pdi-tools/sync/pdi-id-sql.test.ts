import test from "node:test";
import assert from "node:assert/strict";
import {
  PDI_ID_SHAPE,
  PRIMARY_ID_KEY_PATTERNS,
  TRUSTED_PDI_KEY_PATTERNS,
  pdiIdExtractSql,
  selectPdiIdFromJson,
} from "./pdi-id-sql";

test("selectPdiIdFromJson prefers a PDI column over primary id", () => {
  const raw = JSON.stringify({
    V1_PDIID: "CA30203",
    v1_primaryid: "CA999",
    last_name: "Carlos",
  });
  assert.equal(selectPdiIdFromJson(raw), "CA30203");
});

test("selectPdiIdFromJson uses v1_primaryid when pdi_id is blank", () => {
  const raw = JSON.stringify({
    pdi_id: "",
    v1_primaryid: "ca18678463",
    first_name: "Carlos",
    last_name: "Cabrera",
    email: "carla@example.com",
  });
  assert.equal(selectPdiIdFromJson(raw), "CA18678463");
});

test("selectPdiIdFromJson keeps an explicit pdi_id that is not CA-shaped", () => {
  const raw = JSON.stringify({
    pdi_id: "notacaid1",
    v1_primaryid: "CA111",
  });
  assert.equal(selectPdiIdFromJson(raw), "NOTACAID1");
});

test("selectPdiIdFromJson accepts primary_id and contact primary id only when CA plus digits", () => {
  assert.equal(selectPdiIdFromJson(JSON.stringify({ primary_id: "ca12" })), "CA12");
  assert.equal(
    selectPdiIdFromJson(JSON.stringify({ "contact primary id": "CA55" })),
    "CA55"
  );
  assert.equal(selectPdiIdFromJson(JSON.stringify({ v1_primaryid: "CARLOS" })), "");
  assert.equal(selectPdiIdFromJson(JSON.stringify({ last_name: "Carlos" })), "");
  assert.equal(selectPdiIdFromJson(JSON.stringify({ "contact pdi id": "Ca9" })), "CA9");
});

test("pdiIdExtractSql checks PDI keys before primary-id keys and guards primary ids", () => {
  const sql = pdiIdExtractSql("callees.data");
  const guardAt = sql.indexOf("IF(REGEXP_CONTAINS");
  assert.ok(guardAt > 0);
  const trustedSql = sql.slice(0, guardAt);
  const primarySql = sql.slice(guardAt);

  for (const pattern of TRUSTED_PDI_KEY_PATTERNS) {
    assert.ok(trustedSql.includes(`"${pattern}"`), pattern);
    assert.equal(primarySql.includes(`"${pattern}"`), false);
  }
  for (const pattern of PRIMARY_ID_KEY_PATTERNS) {
    assert.ok(primarySql.includes(`"${pattern}"`), pattern);
    assert.ok(primarySql.includes("r'(?i)^CA[0-9]+$'"));
  }
  assert.match(sql, /callees\.data/);
  assert.match(sql, /^UPPER\(TRIM\(IFNULL\(COALESCE\(/);
  assert.equal(pdiIdExtractSql("campaign_contacts.data").includes("campaign_contacts.data"), true);
});

test("PDI id shape is the whole value", () => {
  assert.equal(PDI_ID_SHAPE.test("CA18678463"), true);
  assert.equal(PDI_ID_SHAPE.test("ca18678463"), true);
  assert.equal(PDI_ID_SHAPE.test("Carlos"), false);
  assert.equal(PDI_ID_SHAPE.test("CA123 extra"), false);
});

test("pdiIdExtractSql rejects a column expression that is not an identifier", () => {
  assert.throws(() => pdiIdExtractSql("callees.data; DROP TABLE t"), /Unsafe JSON column/);
});
