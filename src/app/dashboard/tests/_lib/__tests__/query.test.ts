// The dashboard's request windows (civil dates from the browser's calendar) and
// query strings.
import { test } from "node:test";
import assert from "node:assert/strict";

import { EMPTY_FILTERS } from "../filters";
import { stateFromParams } from "../state";
import {
  buildDashboardQueryParams,
  completionCurveRange,
  getDateRange,
  previousRange,
  rangeEndingAt,
} from "../query";
import { endpointsFor } from "../useDashboardData";

// Local components, so the "today" under test is the same in every process zone.
const NOW = new Date(2026, 10, 24, 10, 30);

test("today and the rolling presets end today, by the local calendar", () => {
  assert.deepEqual(getDateRange("today", undefined, undefined, NOW), { startDate: "2026-11-24", endDate: "2026-11-24" });
  assert.deepEqual(getDateRange("last7days", undefined, undefined, NOW), { startDate: "2026-11-18", endDate: "2026-11-24" });
  assert.deepEqual(getDateRange("last30days", undefined, undefined, NOW), { startDate: "2026-10-26", endDate: "2026-11-24" });
});

test("a custom range is sent as typed; half picked, it is no window at all", () => {
  assert.deepEqual(getDateRange("custom", "2026-10-01", "2026-10-14", NOW), {
    startDate: "2026-10-01",
    endDate: "2026-10-14",
  });
  assert.deepEqual(getDateRange("custom", "2026-10-01", "", NOW), { startDate: "", endDate: "" });
  assert.deepEqual(getDateRange("custom", undefined, "2026-10-14", NOW), { startDate: "", endDate: "" });
});

test("the comparison window is the same number of days immediately before", () => {
  assert.deepEqual(previousRange({ startDate: "2026-11-24", endDate: "2026-11-24" }), {
    startDate: "2026-11-23",
    endDate: "2026-11-23",
  });
  assert.deepEqual(previousRange({ startDate: "2026-03-01", endDate: "2026-03-31" }), {
    startDate: "2026-01-29",
    endDate: "2026-02-28",
  });
});

test("a week across the October clock change still compares 7 days with 7", () => {
  // Israel leaves summer time on 2026-10-25.
  assert.deepEqual(previousRange({ startDate: "2026-10-22", endDate: "2026-10-28" }), {
    startDate: "2026-10-15",
    endDate: "2026-10-21",
  });
});

test("rangeEndingAt counts back whole days from the window's last day", () => {
  assert.deepEqual(rangeEndingAt("2026-10-28", 14), { startDate: "2026-10-15", endDate: "2026-10-28" });
  assert.deepEqual(rangeEndingAt("2026-03-30", 7), { startDate: "2026-03-24", endDate: "2026-03-30" });
  assert.deepEqual(rangeEndingAt("2026-11-24", 1), { startDate: "2026-11-24", endDate: "2026-11-24" });
});

test("the completion curve's window: the preset's months back from today, JS month overflow kept", () => {
  assert.deepEqual(completionCurveRange("12months", NOW), { startDate: "2025-11-24", endDate: "2026-11-24" });
  assert.deepEqual(completionCurveRange("alldays", NOW), { startDate: "2025-10-24", endDate: "2026-11-24" });
  assert.deepEqual(completionCurveRange("3years", NOW), { startDate: "2023-11-24", endDate: "2026-11-24" });
  // 31 March minus 13 months is "31 February 2025", which Date rolls to 3 March.
  assert.equal(completionCurveRange("alldays", new Date(2026, 2, 31, 12)).startDate, "2025-03-03");
});

test("the query carries the window, every set filter, and always the scope", () => {
  const params = buildDashboardQueryParams(
    { ...EMPTY_FILTERS, customerId: 4, workerId: "77", status: "finished" },
    { startDate: "2026-11-01", endDate: "2026-11-24" },
  );
  assert.equal(
    params.toString(),
    "startDate=2026-11-01&endDate=2026-11-24&customerId=4&workerId=77&status=finished&scope=open_shipments",
  );
  assert.equal(
    buildDashboardQueryParams({ ...EMPTY_FILTERS, showAllHistory: true }, null).toString(),
    "scope=all",
  );
});

test("the item-types request sends no dates and only its five params", () => {
  const state = stateFromParams(
    new URLSearchParams(
      "tab=types&customerId=1&shipmentId=2&itemTypeId=3&itemSerial=S&testStationId=4&testStationTypeId=5&workerId=6&status=queue&itemId=7",
    ),
    true,
  );
  const url = new URL(endpointsFor(state).types!, "http://x");
  assert.equal(url.pathname, "/api/dashboard/tests/item-types");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    customerId: "1",
    shipmentId: "2",
    itemTypeId: "3",
    itemSerial: "S",
    scope: "open_shipments",
  });
});

test("a half-picked custom range asks for nothing but the health endpoint", () => {
  const state = stateFromParams(new URLSearchParams("range=custom&start=2026-11-01"), true);
  assert.deepEqual(endpointsFor(state), { jobs: "/api/health/jobs" });
});
