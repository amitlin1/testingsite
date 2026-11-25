import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FILTER_PARAM } from "@/app/lib/dashboard/contract";
import { sampleDays } from "../completion-series";
import { filtersFromSearchParams, qualify, unhonoured, type MetricFilters } from "../filters";

describe("filtersFromSearchParams", () => {
  it("reads every filter parameter of the contract", () => {
    const p = FILTER_PARAM;
    const params = new URLSearchParams({
      startDate: "2026-08-01",
      endDate: "2026-08-28",
      [p.customerId]: "4",
      [p.shipmentId]: "5",
      [p.itemTypeId]: "6",
      [p.stationId]: "7",
      [p.stationTypeId]: "8",
      [p.workerId]: "9",
      [p.itemSerial]: " SN-1 ",
      [p.status]: "queue",
      [p.scope]: "all",
    });
    assert.deepEqual(filtersFromSearchParams(params), {
      customerId: 4,
      shipmentId: 5,
      itemTypeId: 6,
      stationId: 7,
      stationTypeId: 8,
      workerId: 9,
      itemSerial: "SN-1",
      packagesOnly: false,
      states: ["queued", "queued_research", "waiting_for_package_items"],
      scope: "all",
    });
  });

  it("an empty query string is open shipments, no states, nothing else", () => {
    const f = filtersFromSearchParams(new URLSearchParams());
    assert.equal(f.scope, "open_shipments");
    assert.equal(f.states, null);
    assert.equal(f.customerId, null);
    assert.equal(f.packagesOnly, false);
  });

  it("an unknown status is no filter, and only scope=all widens the scope", () => {
    const f = filtersFromSearchParams(new URLSearchParams("status=bogus&scope=everything"));
    assert.equal(f.states, null);
    assert.equal(f.scope, "open_shipments");
  });
});

describe("unhonoured — the filters each anchor cannot express (§5.0(1))", () => {
  const every: MetricFilters = {
    customerId: 1,
    shipmentId: 2,
    itemTypeId: 3,
    stationId: 4,
    stationTypeId: 5,
    workerId: 6,
    itemSerial: "S",
    packagesOnly: true,
    scope: "open_shipments",
    states: ["queued"],
  };

  it("route_run cannot express the per-step dimensions", () => {
    assert.deepEqual(unhonoured("runs", every), ["stationId", "stationTypeId", "workerId", "states"]);
  });

  it("entity progress cannot express them either, nor a serial", () => {
    assert.deepEqual(unhonoured("entityProgress", every), ["stationId", "stationTypeId", "workerId", "itemSerial", "states"]);
  });

  it("the live board honours only station, station type and the status projection", () => {
    assert.deepEqual(unhonoured("liveBoard", every), [
      "customerId",
      "shipmentId",
      "itemTypeId",
      "workerId",
      "itemSerial",
      "packagesOnly",
      "scope",
    ]);
    // `all` is not a narrowing the board would have to apply.
    assert.deepEqual(unhonoured("liveBoard", { scope: "all" }), []);
  });

  it("names nothing when nothing is asked for, and qualifies by source", () => {
    assert.deepEqual(unhonoured("runs", {}), []);
    assert.deepEqual(qualify("finishedCumulative", ["stationId"]), ["finishedCumulative:stationId"]);
  });
});

describe("sampleDays — where the completion curve is reported", () => {
  it("daily is every day of the window", () => {
    assert.deepEqual(sampleDays("2026-08-27", "2026-08-29", "daily"), ["2026-08-27", "2026-08-28", "2026-08-29"]);
  });

  it("monthly is each month's last day inside the window, plus the window's last day", () => {
    assert.deepEqual(sampleDays("2026-01-15", "2026-04-10", "monthly"), [
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-10",
    ]);
  });

  it("quarterly buckets end on the quarter's last day", () => {
    assert.deepEqual(sampleDays("2026-02-01", "2026-08-15", "quarterly"), ["2026-03-31", "2026-06-30", "2026-08-15"]);
  });

  it("an inverted window has no days", () => {
    assert.deepEqual(sampleDays("2026-08-02", "2026-08-01", "daily"), []);
  });
});
