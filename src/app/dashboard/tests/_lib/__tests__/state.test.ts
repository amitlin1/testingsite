// The dashboard state's projection onto the URL (state.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

import { EMPTY_FILTERS, activeChips, countActiveFilters } from "../filters";
import { paramsFromState, stateFromParams, type DashboardState } from "../state";

const DEFAULT_STATE = stateFromParams(new URLSearchParams(), true);

test("an empty query string is the default view, and the default view writes nothing", () => {
  assert.deepEqual(DEFAULT_STATE, {
    tab: "overview",
    datePreset: "today",
    customStart: "",
    customEnd: "",
    filters: EMPTY_FILTERS,
    period: "daily",
    stuckHours: 48,
    railOpen: true,
  });
  assert.equal(paramsFromState(DEFAULT_STATE).toString(), "");
});

test("every field survives a round trip through the URL", () => {
  const state: DashboardState = {
    tab: "slow",
    datePreset: "custom",
    customStart: "2026-10-01",
    customEnd: "2026-10-14",
    filters: {
      customerId: 4821,
      shipmentId: 7,
      itemSerial: "SN-1",
      itemTypeId: 3,
      testStationId: 12,
      testStationTypeId: 4,
      workerId: "1234",
      status: "processing",
      showAllHistory: true,
    },
    period: "quarterly",
    stuckHours: 72,
    railOpen: false,
  };
  const url = paramsFromState(state).toString();
  assert.deepEqual(stateFromParams(new URLSearchParams(url), false), state);
});

test("'show every stuck item' is written as stuck=all", () => {
  const state: DashboardState = { ...DEFAULT_STATE, stuckHours: null };
  assert.equal(paramsFromState(state).toString(), "stuck=all");
  assert.equal(stateFromParams(new URLSearchParams("stuck=all"), true).stuckHours, null);
});

test("custom dates are written only for the custom range", () => {
  const state: DashboardState = { ...DEFAULT_STATE, datePreset: "last7days", customStart: "2026-10-01" };
  assert.equal(paramsFromState(state).toString(), "range=last7days");
});

test("unknown values fall back to the defaults", () => {
  const state = stateFromParams(
    new URLSearchParams("tab=nope&range=forever&period=weekly&stuck=13&status=lost&customerId=x&shipmentId=0&itemSerial=%20%20"),
    true,
  );
  assert.equal(state.tab, "overview");
  assert.equal(state.datePreset, "today");
  assert.equal(state.period, "daily");
  assert.equal(state.stuckHours, 48);
  assert.equal(state.filters.status, "all");
  assert.equal(state.filters.customerId, null);
  assert.equal(state.filters.shipmentId, null);
  assert.equal(state.filters.itemSerial, null);
  assert.equal(countActiveFilters(state.filters), 0);
});

test("header chips name the filters, falling back to the raw id without a label", () => {
  const filters = { ...EMPTY_FILTERS, customerId: 5, shipmentId: 9, status: "queue" as const, showAllHistory: true };
  assert.deepEqual(activeChips(filters, { customer: "אלפא" }), [
    { key: "customerId", text: "לקוח אלפא" },
    { key: "shipmentId", text: "משלוח 9" },
    { key: "status", text: "סטטוס בתור" },
    { key: "showAllHistory", text: "כולל משלוחים שנשלחו" },
  ]);
  assert.equal(countActiveFilters(filters), 4);
  assert.equal(countActiveFilters(EMPTY_FILTERS), 0);
});

test("the chips walk the rail's order, and the page URL carries what the request carries", () => {
  const filters = {
    ...EMPTY_FILTERS,
    customerId: 1,
    shipmentId: 2,
    itemTypeId: 3,
    testStationId: 4,
    testStationTypeId: 5,
    workerId: "6",
    itemSerial: "S",
    status: "finished" as const,
    showAllHistory: true,
  };
  assert.deepEqual(
    activeChips(filters, { station: "עמדה א" }).map((c) => c.text),
    ["לקוח 1", "משלוח 2", "סוג פריט 3", "עמדה עמדה א", "סוג עמדה 5", "עובד 6", "סריאלי S", "סטטוס הסתיים", "כולל משלוחים שנשלחו"],
  );
  const url = paramsFromState({ ...stateFromParams(new URLSearchParams(), true), filters });
  assert.equal(
    url.toString(),
    "customerId=1&shipmentId=2&itemTypeId=3&testStationId=4&testStationTypeId=5&workerId=6&itemSerial=S&status=finished&showAllHistory=true",
  );
});
