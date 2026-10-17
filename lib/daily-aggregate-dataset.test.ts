import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAggregateDatasetTitle,
  parseAggregateViewParam,
  resolveAggregateDateRange,
} from "./daily-aggregate-dataset";

test("parseAggregateViewParam recognizes total", () => {
  assert.equal(parseAggregateViewParam("total"), "total");
  assert.equal(parseAggregateViewParam("TOTAL"), "total");
  assert.equal(parseAggregateViewParam("today"), null);
  assert.equal(parseAggregateViewParam(""), null);
});

test("resolveAggregateDateRange defaults to Pacific today", () => {
  const r = resolveAggregateDateRange({
    viewTotal: false,
    requestedStart: "",
    requestedEnd: "",
    todayYmd: "2026-10-17",
  });
  assert.equal(r.mode, "today");
  assert.equal(r.startDate, "2026-10-17");
  assert.equal(r.endDate, "2026-10-17");
});

test("resolveAggregateDateRange view=total clears dates", () => {
  const r = resolveAggregateDateRange({
    viewTotal: true,
    requestedStart: "2026-10-01",
    requestedEnd: "2026-10-02",
    todayYmd: "2026-10-17",
  });
  assert.equal(r.mode, "total");
  assert.equal(r.startDate, "");
  assert.equal(r.endDate, "");
});

test("resolveAggregateDateRange keeps a custom range", () => {
  const r = resolveAggregateDateRange({
    viewTotal: false,
    requestedStart: "2026-10-01",
    requestedEnd: "2026-10-03",
    todayYmd: "2026-10-17",
  });
  assert.equal(r.mode, "custom");
  assert.equal(r.startDate, "2026-10-01");
  assert.equal(r.endDate, "2026-10-03");
});

test("formatAggregateDatasetTitle renders Today Total and ranges", () => {
  assert.equal(
    formatAggregateDatasetTitle("Nithya Raman", {
      startDate: "2026-10-17",
      endDate: "2026-10-17",
      mode: "today",
      todayYmd: "2026-10-17",
    }),
    "Nithya Raman | Today (10/17/26)"
  );
  assert.equal(
    formatAggregateDatasetTitle("Nithya Raman", {
      startDate: "",
      endDate: "",
      mode: "total",
      todayYmd: "2026-10-17",
    }),
    "Nithya Raman | Total"
  );
  assert.equal(
    formatAggregateDatasetTitle("All Campaigns", {
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      mode: "custom",
      todayYmd: "2026-10-17",
    }),
    "All Campaigns | 10/1/26 – 10/3/26"
  );
});
