import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PERCENT_COLOR_SCALE,
  percentColorScaleClass,
  resolvePercentBandTone,
  sanitizePercentColorScaleConfig,
} from "./percent-color-scale";

test("default bands match the legacy warm / none / green cutoffs", () => {
  const config = DEFAULT_PERCENT_COLOR_SCALE;
  assert.equal(resolvePercentBandTone(0, config), "darkWarm");
  assert.equal(resolvePercentBandTone(0.2, config), "darkWarm");
  assert.equal(resolvePercentBandTone(0.2001, config), "lightWarm");
  assert.equal(resolvePercentBandTone(0.4, config), "lightWarm");
  assert.equal(resolvePercentBandTone(0.5, config), "none");
  assert.equal(resolvePercentBandTone(0.7, config), "lightGreen");
  assert.equal(resolvePercentBandTone(0.9, config), "darkGreen");
  assert.equal(percentColorScaleClass(0.5, config), "");
  assert.match(percentColorScaleClass(0.1, config), /bg-red/);
});

test("disabled config returns no tone", () => {
  const config = { ...DEFAULT_PERCENT_COLOR_SCALE, enabled: false };
  assert.equal(resolvePercentBandTone(0.1, config), null);
  assert.equal(percentColorScaleClass(0.1, config), "");
});

test("sanitize keeps band count and valid tones", () => {
  const next = sanitizePercentColorScaleConfig({
    enabled: false,
    bands: [
      { id: "0-20", minInclusive: 0, maxInclusive: 20, tone: "lightGreen" },
      { id: "21-40", minInclusive: 21, maxInclusive: 40, tone: "not-a-tone" },
    ],
  });
  assert.equal(next.enabled, false);
  assert.equal(next.bands.length, 5);
  assert.equal(next.bands[0]?.tone, "lightGreen");
  assert.equal(next.bands[1]?.tone, "lightWarm");
});
