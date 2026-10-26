import { test } from "node:test";
import assert from "node:assert/strict";
import { NEXT_STATION_TEXT, nextStopOf, nextStopText } from "../nextStation";

const station = { testStationId: 7, testStationDesc: " עמדה 7 ", stationTypeId: 3, routeStep: 2 };

test("a result answer as the row's next stop", () => {
  assert.deepEqual(nextStopOf({ isLastStation: false, nextStation: station }), { kind: "station", name: "עמדה 7" });
  assert.deepEqual(nextStopOf({ isLastStation: true }), { kind: "end" });
  assert.deepEqual(nextStopOf({ isLastStation: true, nextStation: station }), { kind: "end" }, "the end of the route wins");
  for (const none of [undefined, null, {}, { isLastStation: false }, { nextStation: { ...station, testStationDesc: "  " } }]) {
    assert.deepEqual(nextStopOf(none), { kind: "unknown" }, JSON.stringify(none));
  }
});

test("the words of each stop", () => {
  assert.equal(nextStopText({ kind: "station", name: "עמדה 7" }), "עמדה 7");
  assert.equal(nextStopText({ kind: "end" }), NEXT_STATION_TEXT.end);
  assert.equal(nextStopText({ kind: "unknown" }), NEXT_STATION_TEXT.unknown);
});
