import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import { LA_TIME_ZONE, parseDateTime } from "./knock-details-parser";

function laHourMinuteSecond(iso: string | null): string {
  assert.ok(iso);
  const dt = DateTime.fromISO(iso, { zone: LA_TIME_ZONE });
  assert.equal(dt.isValid, true);
  return dt.toFormat("h:mm:ss a");
}

describe("parseDateTime PDI afternoon correction", () => {
  it("treats exact unmarked 1:00:00 as 1:00 PM, not AM", () => {
    const parsed = parseDateTime("09/11/2026 01:00:00");
    assert.equal(laHourMinuteSecond(parsed.iso), "1:00:00 PM");
    assert.equal(parsed.warning, undefined);
  });

  it("still shifts 1:00:02 and other early-afternoon unmarked times", () => {
    assert.equal(laHourMinuteSecond(parseDateTime("09/11/2026 01:00:02").iso), "1:00:02 PM");
    assert.equal(laHourMinuteSecond(parseDateTime("09/11/2026 03:29:01").iso), "3:29:01 PM");
    assert.equal(laHourMinuteSecond(parseDateTime("09/11/2026 04:25:49").iso), "4:25:49 PM");
  });

  it("leaves 12:xx unmarked times as noon (shift start)", () => {
    assert.equal(laHourMinuteSecond(parseDateTime("09/11/2026 12:31:09").iso), "12:31:09 PM");
    assert.equal(laHourMinuteSecond(parseDateTime("09/11/2026 12:46:03").iso), "12:46:03 PM");
  });

  it("includes 8:29 and excludes 8:30 from the +12 window", () => {
    assert.equal(laHourMinuteSecond(parseDateTime("09/11/2026 08:29:00").iso), "8:29:00 PM");
    assert.equal(laHourMinuteSecond(parseDateTime("09/11/2026 08:30:00").iso), "8:30:00 AM");
  });

  it("does not shift timestamps that already have AM/PM", () => {
    assert.equal(laHourMinuteSecond(parseDateTime("09/11/2026 1:00:00 AM").iso), "1:00:00 AM");
    assert.equal(laHourMinuteSecond(parseDateTime("09/11/2026 1:00:00 PM").iso), "1:00:00 PM");
  });
});
