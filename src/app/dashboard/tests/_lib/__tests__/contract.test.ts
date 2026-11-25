// The dashboard's wire adapters (src/app/lib/dashboard/contract.ts), as the
// screens read them.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adaptKpis,
  adaptStations,
  adaptStatusHistory,
  boardSummary,
  completionPoints,
  entityHistoryPoints,
  type CompletionHistoryWire,
  type EntityHistoryWire,
  type KpisWire,
  type StationWire,
} from "@/app/lib/dashboard/contract";

test("adapting strips the `_new_` prefix and keeps every value, nulls included", () => {
  const wire = {
    averageQueueTimeMinutes: 12.5,
    totalItemsProcessed: 7,
    _new_averageQueueWorkMinutes: null,
    _new_unitsTouched: 3,
  } as unknown as KpisWire;
  assert.deepEqual(adaptKpis(wire), {
    averageQueueTimeMinutes: 12.5,
    totalItemsProcessed: 7,
    averageQueueWorkMinutes: null,
    unitsTouched: 3,
  });
});

test("a status-history day is adapted down into its statuses", () => {
  const [day] = adaptStatusHistory([
    {
      date: "2026-11-24",
      isToday: true,
      finishedCumulative: 9,
      _new_finishedToday: 1,
      _new_workStartedToday: 2,
      _new_workFinishedToday: 1,
      _new_activeTotal: 5,
      statuses: [
        { status: "1", statusName: "בבדיקה", count: 5, percentage: 100, _new_stateKey: "testing", _new_series: "point_in_time" },
      ],
    },
  ]);
  assert.equal(day.workStartedToday, 2);
  assert.deepEqual(day.statuses[0], {
    status: "1",
    statusName: "בבדיקה",
    count: 5,
    percentage: 100,
    stateKey: "testing",
    series: "point_in_time",
  });
});

function stationWire(patch: Partial<Record<string, unknown>>): StationWire {
  return {
    stationId: 1,
    itemsInTest: 0,
    _new_itemsInResearch: 0,
    _new_researchPoolQueue: 0,
    _new_typeWaitWallHours: null,
    _new_typeWaitAvgWallMinutes: null,
    ...patch,
  } as unknown as StationWire;
}

test("typeWaitRecordCount is the type's wait hours over its average wait", () => {
  const [exact, noAverage, noHours, nothingClosed] = adaptStations([
    stationWire({ _new_typeWaitWallHours: 2, _new_typeWaitAvgWallMinutes: 30 }),
    stationWire({ _new_typeWaitWallHours: 2, _new_typeWaitAvgWallMinutes: 0 }),
    stationWire({ _new_typeWaitWallHours: null, _new_typeWaitAvgWallMinutes: 30 }),
    stationWire({}),
  ]);
  assert.equal(exact.typeWaitRecordCount, 4);
  assert.equal(noAverage.typeWaitRecordCount, null);
  assert.equal(noHours.typeWaitRecordCount, null);
  assert.equal(nothingClosed.typeWaitRecordCount, null);
  assert.equal(exact.typeWaitWallHours, 2);
});

test("boardSummary reads the station-less pool once and counts stations at work", () => {
  assert.deepEqual(boardSummary([]), { researchPool: null, inResearch: 0, activeStations: 0 });
  const rows = adaptStations([
    stationWire({ stationId: 1, itemsInTest: 2, _new_researchPoolQueue: 6 }),
    stationWire({ stationId: 2, _new_itemsInResearch: 3, _new_researchPoolQueue: 6 }),
    stationWire({ stationId: 3, _new_researchPoolQueue: 6 }),
  ]);
  assert.deepEqual(boardSummary(rows), { researchPool: 6, inResearch: 3, activeStations: 2 });
});

test("completionPoints reads the shipment's own series and skips `_new_counts`", () => {
  const rows = [
    { date: "2026-11-01", _new_counts: { "SH-1": { routed: 4, finished: 1 } }, "SH-1": "25.0" },
    { date: "2026-11-02", _new_counts: {}, "SH-1": "50.0" },
    { date: "2026-11-03", _new_counts: {} },
    { date: "2026-11-04", _new_counts: {}, "SH-1": "n/a" },
  ] as unknown as CompletionHistoryWire[];
  assert.deepEqual(completionPoints(rows), [
    { date: "2026-11-01", pct: 25, routed: 4, finished: 1 },
    { date: "2026-11-02", pct: 50, routed: null, finished: null },
  ]);
});

test("entity history: closures under either wire spelling, research and its queue as one band", () => {
  const base = {
    date: "2026-11-24",
    isToday: true,
    itemsInQueue: 2,
    itemsInTest: 3,
    itemsWaitingForResearch: 1,
    itemsInResearch: 4,
    _new_unmapped: 0,
    _new_activeTotal: 10,
    _new_finishedToday: 0,
    _new_waiting_for_package_items: 0,
  };
  const [customer, shipment] = entityHistoryPoints([
    { ...base, finishedItems: 8 },
    { ...base, itemsFinished: 9 },
  ] as EntityHistoryWire[]);
  assert.equal(customer.line, 8);
  assert.equal(shipment.line, 9);
  assert.equal(customer.research, 5);
  assert.deepEqual(customer.wait, { wall: null, work: null });
});
