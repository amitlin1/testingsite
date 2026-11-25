import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextStationList, nextStopOf, type NextStopRow } from "../nextStation";

const station = { testStationId: 7, testStationDesc: " עמדה 7 ", stationTypeId: 3, routeStep: 2 };

/** What the list says, its markup stripped. */
const textOf = (rows: NextStopRow[]): string => renderToStaticMarkup(createElement(NextStationList, { rows })).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

test("a result answer as the row's next stop", () => {
  assert.deepEqual(nextStopOf({ isLastStation: false, nextStation: station }), { kind: "station", name: "עמדה 7" });
  assert.deepEqual(nextStopOf({ isLastStation: true }), { kind: "end" });
  assert.deepEqual(nextStopOf({ isLastStation: true, nextStation: station }), { kind: "end" }, "the end of the route wins");
  for (const none of [undefined, null, {}, { isLastStation: false }, { nextStation: { ...station, testStationDesc: "  " } }]) {
    assert.deepEqual(nextStopOf(none), { kind: "unknown" }, JSON.stringify(none));
  }
});

test("the done step's list names each row's next station, the end of its route, or that it is not known", () => {
  const text = textOf([
    { key: "box", badge: "00", label: "ערכה", stop: { kind: "station", name: "עמדה 7" }, note: "ממתין לפריטי המארז" },
    { key: "1", badge: "01", label: "מחשב", stop: { kind: "end" } },
    { key: "2", badge: "02", label: "מסך", stop: { kind: "unknown" } },
  ]);
  assert.match(text, /^העמדה הבאה /);
  assert.match(text, /00 ערכה עמדה 7 ממתין לפריטי המארז/);
  assert.match(text, /01 מחשב סוף המסלול/);
  assert.match(text, /02 מסך לא ידוע/);
});

test("when every row ends its route, one line says so instead of the list; no rows, nothing", () => {
  assert.equal(textOf([{ key: "box", badge: "00", label: "ערכה", stop: { kind: "end" } }, { key: "1", badge: "01", label: "מחשב", stop: { kind: "end" } }]),
    "אין עמדה הבאה — המארז והפריטים שבו סיימו את המסלול.");
  assert.equal(renderToStaticMarkup(createElement(NextStationList, { rows: [] })), "");
});
