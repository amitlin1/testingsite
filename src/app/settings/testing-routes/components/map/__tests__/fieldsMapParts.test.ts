import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { filterCounts, getColumn, getRow, mapErrorBar } from "../../../lib/mapModel";
import type { FieldsMapModel } from "../../../lib/mapModel";
import { ELEC, MECH, VISU, artboard1, artboard11, cellAt, getCell, mapFor } from "../../../lib/__tests__/fixtures";
import FieldsMapCell, { cellAccessibleName, cellState, naTooltip } from "../FieldsMapCell";
import type { FieldsMapCellProps } from "../FieldsMapCell";
import FieldsMapErrorBar, { MAP_ERROR_ACTION_ID } from "../FieldsMapErrorBar";
import FieldsMapFooter from "../FieldsMapFooter";
import FieldsMapToolbar from "../FieldsMapToolbar";

/**
 * The fields map's parts as markup (route-fields spec §5.4.3–§5.4.5; artboards 1, 11): every cell
 * state with its accessible name and text, the error bar, the toolbar's chips, the footer of each
 * artboard — what a user and a screen reader get, not the class names that style it. FieldsMap
 * itself imports its stylesheet and is not rendered here.
 */

const html = (el: ReactElement): string => renderToStaticMarkup(createElement(TooltipProvider, null, el));
const decode = (s: string): string =>
  s.replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const textOf = (markup: string): string => decode(markup.replace(/<[^>]*>/g, ""));
/** The text of the aria-hidden parts — what only the eye gets. */
const hiddenTextOf = (markup: string): string =>
  [...markup.matchAll(/aria-hidden="true"[^>]*>((?:(?!<\/span>|<\/div>).)*)/g)].map((x) => textOf(x[1])).filter(Boolean).join("|");

function cellHtml(m: FieldsMapModel, rowKey: string, columnKey: string, extra: Partial<FieldsMapCellProps> = {}): string {
  const cell = getCell(m, rowKey, columnKey)!;
  const props: FieldsMapCellProps = {
    cell,
    row: getRow(m, rowKey)!,
    column: getColumn(m, columnKey)!,
    firstRow: rowKey === m.rows[0].key,
    lastRow: rowKey === m.rows[m.rows.length - 1].key,
    sharedState: m.onboarding,
    setName: null,
    navKey: cell.key,
    tabIndex: -1,
    onActivate: () => {},
    ...extra,
  };
  return html(createElement(FieldsMapCell, props));
}

const elec = `step:${ELEC}:1`;
const mech = `step:${MECH}:1`;
const visu = `step:${VISU}:1`;

test("a defined cell: a gridcell holding one button named '{station} · {row}', its count, its tones, the unpublished dot", () => {
  const m = mapFor(artboard1());
  const cell = cellAt(m, "line:1", elec);
  const out = cellHtml(m, "line:1", elec, { tabIndex: 0 });
  assert.match(out, /^<div role="gridcell"/);
  assert.match(out, /<button type="button" data-nav-key="line:1\|step:12:1" tabindex="0"[^>]* aria-label="חשמל · מחשב" aria-describedby="[^"]+"/);
  assert.equal(cellState(cell), "defined");
  assert.deepEqual(cell.tones, ["pass", "warn", "fail", "neutral"]);
  // The one unpublished cell: the corner dot, named for a screen reader and titled for the mouse.
  assert.match(out, /role="img" aria-label="שינוי שלא פורסם" title="שינוי שלא פורסם"/);
  assert.equal(textOf(out), "5 שדות");
});

test("'שדה אחד'; the kit column's first row carries the frame caption, for the eye only", () => {
  const m = mapFor(artboard1());
  assert.equal(textOf(cellHtml(m, "each_item", "kit:1")), "שדה אחד");
  // Hidden from a screen reader: the column header's Tag says it.
  assert.equal(hiddenTextOf(cellHtml(m, "box", "kit:0")), "כרטיס אחד לכל המארז");
  assert.doesNotMatch(cellHtml(m, "each_item", "kit:0"), /כרטיס אחד לכל המארז/);
});

test("an empty cell: 'ללא שדות', 'הגדר שדות' for the eye on hover / focus, named '… · ללא שדות'", () => {
  const m = mapFor(artboard1());
  const out = cellHtml(m, "line:4", "kit:0");
  assert.equal(cellState(cellAt(m, "line:4", "kit:0")), "empty");
  assert.match(out, /aria-label="פתיחת מארז · עכבר · ללא שדות"/);
  assert.doesNotMatch(out, /aria-describedby/);
  assert.equal(textOf(out), "ללא שדותהגדר שדות");
  assert.equal(hiddenTextOf(out), "הגדר שדות");
});

test("an error cell: the count and 'שגיאה אחת'", () => {
  const m = mapFor(artboard1());
  const out = cellHtml(m, "line:2", mech);
  assert.equal(cellState(cellAt(m, "line:2", mech)), "error");
  assert.match(out, /aria-label="מכניקה · מסך"/);
  assert.equal(textOf(out), "2 שדותשגיאה אחת");
});

test("a set: 'ערכה: {name}' when the name is known; 'הערכה עודכנה' when the set moved on", () => {
  const m = mapFor(artboard1(), { setVersions: { 7: 2 } });
  const mouse = cellHtml(m, "line:4", visu, { setName: "חזותית בסיסית" });
  assert.match(mouse, /title="ערכה: חזותית בסיסית">ערכה: חזותית בסיסית</);
  assert.match(textOf(mouse), /הערכה עודכנה/);
  assert.doesNotMatch(textOf(cellHtml(m, "line:1", visu, { setName: "חזותית בסיסית" })), /הערכה עודכנה/);
  // The fields context carries no set names: without one, no tag (never an invented name).
  assert.doesNotMatch(cellHtml(m, "line:1", visu), /ערכה:/);
});

test("'—': aria-label 'לא במסלול', out of the tab order, artboard 1's tooltip only where an item skips the station", () => {
  const m = mapFor(artboard1());
  const kb = getCell(m, "line:3", elec)!;
  assert.ok(kb.na);
  assert.equal(naTooltip(kb), "עמדת חשמל לא נמצאת במסלול 1 של מקלדת");
  const out = cellHtml(m, "line:3", elec);
  assert.match(out, /^<div role="gridcell" aria-label="לא במסלול"/);
  assert.equal(textOf(out), "—");
  assert.doesNotMatch(out, /tabindex|<button/);
  assert.match(out, /data-state="closed"/, "the dash is a tooltip trigger");
  const box = getCell(m, "box", elec)!;
  assert.ok(box.na);
  assert.equal(naTooltip(box), null);
  assert.doesNotMatch(cellHtml(m, "box", elec), /data-state/, "no tooltip");
});

test("artboard 11: a filled cell of a shared route is drawn as the other kit's — its name and description say so", () => {
  const m = mapFor(artboard11());
  assert.equal(m.onboarding, true);
  const cell = cellAt(m, "line:11", elec);
  assert.equal(cellAccessibleName(cell, true), "חשמל · מסך · 3 שדות משותפים");
  const out = cellHtml(m, "line:11", elec);
  assert.match(out, /aria-label="חשמל · מסך · 3 שדות משותפים"/);
  assert.match(textOf(out), /הוגדר במסלול 1 של מסך · משותף עם מארז עמדת עבודה/);
  // Artboard 1 draws the same kind of cell (a route another kit runs) without it.
  const m1 = mapFor(artboard1());
  const monElec = cellAt(m1, "line:2", elec);
  assert.ok(monElec.sharedWith.length > 0);
  assert.equal(cellAccessibleName(monElec, m1.onboarding), "חשמל · מסך");
  assert.doesNotMatch(textOf(cellHtml(m1, "line:2", elec)), /משותף עם/);
});

test("the error bar: an alert with artboard 1's text and 'עבור לשדה' (its id is the header's focus target)", () => {
  const ctx = artboard1();
  const bar = mapErrorBar(mapFor(ctx), ctx)!;
  const out = html(createElement(FieldsMapErrorBar, { error: bar, onGoToField: () => {} }));
  assert.match(out, /^<div role="alert"/);
  assert.match(out, new RegExp(`<button[^>]*id="${MAP_ERROR_ACTION_ID}"[^>]*>עבור לשדה</button>`));
  assert.equal(textOf(out), "מכניקה · מסך: אפשרות ריקה בשדה 'ברגי VESA'עבור לשדה");
  // An error on no cell: no "עבור לשדה".
  const noCell = html(createElement(FieldsMapErrorBar, { error: { ...bar, cell: null, fieldId: null }, onGoToField: () => {} }));
  assert.doesNotMatch(noCell, /<button/);
});

test("the toolbar: a group named 'סינון תאים', four chips, one pressed; an empty chip is disabled", () => {
  const m = mapFor(artboard1());
  const out = html(createElement(FieldsMapToolbar, { filter: "all", counts: filterCounts(m), onFilterChange: () => {} }));
  assert.match(out, /<div role="group" aria-label="סינון תאים"/);
  assert.deepEqual([...out.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((x) => [x[1], x[2]]), [
    ["true", "הכל · 20"], ["false", "ללא שדות · 5"], ["false", "שגיאות · 1"], ["false", "לא פורסמו · 1"],
  ]);
  assert.doesNotMatch(out, /disabled/);
  const quiet = html(createElement(FieldsMapToolbar, { filter: "all", counts: { all: 16, empty: 13, errors: 0, unpublished: 0 }, onFilterChange: () => {} }));
  assert.equal([...quiet.matchAll(/disabled=""/g)].length, 2);
});

test("the footer: artboard 1's summary, legend and keys; artboard 11's shared summary, legend and hint", () => {
  const legendOf = (out: string) => [...out.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((x) => textOf(x[1]));
  const one = html(createElement(FieldsMapFooter, { model: mapFor(artboard1()) }));
  assert.deepEqual(legendOf(one), [
    "מוגדר", "ללא שדות — העובד יראה את החלון הקבוע", "לא במסלול", "שגיאה", "שינוי שלא פורסם", "עמדה ברמת מארז · כרטיס אחד",
  ]);
  assert.equal(
    textOf(one.replace(/<ul.*<\/ul>/, " | ")),
    "37 שדות · 5 תאים ללא שדות · שגיאה אחת | חיצים לניווט · Shift לבחירת טווח · Enter לעריכה · Ctrl C / Ctrl V",
  );

  const eleven = html(createElement(FieldsMapFooter, { model: mapFor(artboard11()) }));
  assert.deepEqual(legendOf(eleven), [
    "מוגדר", "ללא שדות — העובד יראה את החלון הקבוע", "לא במסלול", "משותף עם מארז אחר", "עמדה ברמת מארז · כרטיס אחד",
  ]);
  assert.equal(textOf(eleven.replace(/<ul.*<\/ul>/, " | ")), "8 שדות משותפים · 13 תאים ללא שדות | לחיצה על תא פותחת את עורך השדות");
});
