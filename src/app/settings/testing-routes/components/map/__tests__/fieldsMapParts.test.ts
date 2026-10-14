import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/Tooltip";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { buildFieldsMap, filterCounts, getCell, getColumn, getRow, mapErrorBar } from "../../../lib/mapModel";
import type { FieldsMapModel, MapCell } from "../../../lib/mapModel";
import { EMPTY_DRAFT_MODEL, currentConfigs, draftReducer, summarize } from "../../../lib/draftModel";
import { ELEC, MECH, VISU, artboard1, artboard11 } from "../../../lib/__tests__/fixtures";
import FieldsMapCell, { cellAccessibleName, cellState, naTooltip } from "../FieldsMapCell";
import type { FieldsMapCellProps } from "../FieldsMapCell";
import FieldsMapErrorBar, { MAP_ERROR_ACTION_ID } from "../FieldsMapErrorBar";
import FieldsMapFooter from "../FieldsMapFooter";
import FieldsMapToolbar from "../FieldsMapToolbar";

/**
 * The fields map's parts as markup (route-fields spec §5.4.3–§5.4.5; artboards 1, 11): every cell
 * state with its accessible name, the error bar, the toolbar's chips, the footer of each artboard.
 * FieldsMap itself imports its stylesheet and is not rendered here.
 */

function mapOf(ctx: FieldsContextJson, setVersions?: Record<number, number>): FieldsMapModel {
  const model = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  return buildFieldsMap({ context: ctx, configs: currentConfigs(model), issues: summarize(model).issuesByRoute, setVersions });
}

const html = (el: ReactElement): string => renderToStaticMarkup(createElement(TooltipProvider, null, el));
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, "")
  .replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

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

test("a defined cell: '{N} שדות', its tone dots in order, named '{station} · {row}'", () => {
  const m = mapOf(artboard1());
  const out = cellHtml(m, "line:1", elec, { tabIndex: 0 });
  assert.match(out, /^<div role="gridcell" class="rf-map__slot">/);
  assert.match(out, /<button type="button" data-nav-key="line:1\|step:12:1" tabindex="0" class="rf-cell rf-cell--defined" aria-label="חשמל · מחשב" aria-describedby="[^"]+"/);
  assert.match(out, /rf-cell__dot--pass.*rf-cell__dot--warn.*rf-cell__dot--fail.*rf-cell__dot--neutral/);
  // The one unpublished cell: the corner dot, named for a screen reader and titled for the mouse.
  assert.match(out, /<span class="rf-cell__unpub" role="img" aria-label="שינוי שלא פורסם" title="שינוי שלא פורסם"><\/span>/);
  assert.equal(textOf(out), "5 שדות");
  assert.equal(cellState(getCell(m, "line:1", elec) as MapCell), "defined");
});

test("'שדה אחד', and the kit column's tiles sit inside the frame", () => {
  const m = mapOf(artboard1());
  const out = cellHtml(m, "each_item", "kit:1");
  assert.match(out, /class="rf-map__slot rf-map__slot--kit"/);
  assert.match(out, /class="rf-cell rf-cell--defined rf-cell--kit"/);
  assert.equal(textOf(out), "שדה אחד");
  // The frame's first row carries "כרטיס אחד לכל המארז" (hidden from a screen reader: the header's
  // Tag says it).
  const top = cellHtml(m, "box", "kit:0");
  assert.match(top, /class="rf-map__slot rf-map__slot--kit rf-map__slot--first"/);
  assert.match(top, /<span class="rf-map__frame-caption" aria-hidden="true">כרטיס אחד לכל המארז<\/span>/);
  assert.match(cellHtml(m, "line:4", "kit:1"), /rf-map__slot--kit rf-map__slot--last/);
});

test("an empty cell: 'ללא שדות', 'הגדר שדות' for hover / focus, named '… · ללא שדות'", () => {
  const m = mapOf(artboard1());
  const out = cellHtml(m, "line:4", "kit:0");
  assert.match(out, /class="rf-cell rf-cell--empty rf-cell--kit" aria-label="פתיחת מארז · עכבר · ללא שדות"/);
  assert.doesNotMatch(out, /aria-describedby/);
  assert.match(out, /<span class="rf-cell__empty">ללא שדות<\/span><span class="rf-cell__define" aria-hidden="true"><svg[^>]*>.*<\/svg>הגדר שדות<\/span>/);
});

test("an error cell: the count and 'שגיאה אחת' (CircleAlert); no dots", () => {
  const m = mapOf(artboard1());
  const out = cellHtml(m, "line:2", mech);
  assert.match(out, /class="rf-cell rf-cell--error" aria-label="מכניקה · מסך"/);
  assert.match(out, /<span class="rf-cell__error"><svg[^>]*>.*<\/svg>שגיאה אחת<\/span>/);
  assert.doesNotMatch(out, /rf-cell__dot/);
  assert.equal(textOf(out), "2 שדותשגיאה אחת");
});

test("a set: 'ערכה: {name}' when the name is known; 'הערכה עודכנה' when the set moved on", () => {
  const m = mapOf(artboard1(), { 7: 2 });
  const mouse = cellHtml(m, "line:4", visu, { setName: "חזותית בסיסית" });
  assert.match(mouse, /<span class="rf-cell__set" title="ערכה: חזותית בסיסית">ערכה: חזותית בסיסית<\/span>/);
  assert.match(mouse, /<span class="rf-cell__set-updated">הערכה עודכנה<\/span>/);
  const pc = cellHtml(m, "line:1", visu, { setName: "חזותית בסיסית" });
  assert.doesNotMatch(pc, /הערכה עודכנה/);
  // The fields context carries no set names: without one, no tag (never an invented name).
  assert.doesNotMatch(cellHtml(m, "line:1", visu), /rf-cell__set"/);
});

test("'—': aria-label 'לא במסלול', out of the tab order, artboard 1's tooltip only where an item skips the station", () => {
  const m = mapOf(artboard1());
  const kb = getCell(m, "line:3", elec)!;
  assert.ok(kb.na);
  assert.equal(naTooltip(kb), "מקלדת לא עוברת בעמדת חשמל במסלול 1");
  const out = cellHtml(m, "line:3", elec);
  assert.match(out, /^<div role="gridcell" aria-label="לא במסלול" class="rf-map__slot"><div class="rf-map__na" aria-hidden="true" data-state="closed">—<\/div><\/div>$/);
  assert.doesNotMatch(out, /tabindex/);
  const box = getCell(m, "box", elec)!;
  assert.ok(box.na);
  assert.equal(naTooltip(box), null);
  assert.equal(cellHtml(m, "box", elec), '<div role="gridcell" aria-label="לא במסלול" class="rf-map__slot"><div class="rf-map__na" aria-hidden="true">—</div></div>');
});

test("artboard 11: a filled cell of a shared route is drawn as the other kit's — Link2, the tooltip, '… שדות משותפים'", () => {
  const m = mapOf(artboard11());
  assert.equal(m.onboarding, true);
  const cell = getCell(m, "line:11", elec) as MapCell;
  assert.equal(cellAccessibleName(cell, true), "חשמל · מסך · 3 שדות משותפים");
  const out = cellHtml(m, "line:11", elec);
  assert.match(out, /aria-label="חשמל · מסך · 3 שדות משותפים"/);
  assert.match(out, /class="lucide lucide-link2[^"]*rf-cell__shared-icon"/);
  assert.match(out, /<span class="sh-visually-hidden">הוגדר במסלול 1 של מסך · משותף עם מארז עמדת עבודה<\/span>/);
  // Artboard 1 draws the same kind of cell (a route another kit runs) without it.
  const m1 = mapOf(artboard1());
  const monElec = getCell(m1, "line:2", elec) as MapCell;
  assert.ok(monElec.sharedWith.length > 0);
  assert.equal(cellAccessibleName(monElec, m1.onboarding), "חשמל · מסך");
  assert.doesNotMatch(cellHtml(m1, "line:2", elec), /rf-cell__shared-icon|sh-visually-hidden/);
});

test("the error bar: artboard 1's text and 'עבור לשדה' (its id is the header's focus target)", () => {
  const ctx = artboard1();
  const bar = mapErrorBar(mapOf(ctx), ctx)!;
  const out = html(createElement(FieldsMapErrorBar, { error: bar, onGoToField: () => {} }));
  assert.match(out, /^<div role="alert" class="rf-map-error"/);
  assert.match(out, new RegExp(`<button[^>]*id="${MAP_ERROR_ACTION_ID}"[^>]*>עבור לשדה</button>`));
  assert.equal(textOf(out), "מכניקה · מסך: אפשרות ריקה בשדה 'ברגי VESA'עבור לשדה");
  // An error on no cell: no "עבור לשדה".
  const noCell = html(createElement(FieldsMapErrorBar, { error: { ...bar, cell: null, fieldId: null }, onGoToField: () => {} }));
  assert.doesNotMatch(noCell, /<button/);
});

test("the toolbar: <div role='group' aria-label='סינון תאים'>, four chips, one pressed; an empty chip is disabled", () => {
  const m = mapOf(artboard1());
  const out = html(createElement(FieldsMapToolbar, { filter: "all", counts: filterCounts(m), onFilterChange: () => {} }));
  assert.match(out, /<div role="group" aria-label="סינון תאים" class="rf-map-filters">/);
  assert.deepEqual([...out.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((x) => [x[1], x[2]]), [
    ["true", "הכל · 20"], ["false", "ללא שדות · 5"], ["false", "שגיאות · 1"], ["false", "לא פורסמו · 1"],
  ]);
  assert.doesNotMatch(out, /disabled/);
  const quiet = html(createElement(FieldsMapToolbar, { filter: "all", counts: { all: 16, empty: 13, errors: 0, unpublished: 0 }, onFilterChange: () => {} }));
  assert.equal([...quiet.matchAll(/disabled=""/g)].length, 2);
});

test("the footer: artboard 1's summary, legend and keys; artboard 11's shared summary, legend and hint", () => {
  const one = html(createElement(FieldsMapFooter, { model: mapOf(artboard1()) }));
  assert.match(one, /<span class="rf-map__summary">37 שדות · 5 תאים ללא שדות · שגיאה אחת<\/span>/);
  assert.deepEqual([...one.matchAll(/<li class="rf-map__legend-item">(?:<span[^>]*><\/span>|<svg.*?<\/svg>)([^<]+)<\/li>/g)].map((x) => x[1]), [
    "מוגדר", "ללא שדות — העובד יראה את החלון הקבוע", "לא במסלול", "שגיאה", "שינוי שלא פורסם", "עמדה ברמת מארז · כרטיס אחד",
  ]);
  assert.match(one, /<span class="rf-map__hint">חיצים לניווט · Shift לבחירת טווח · Enter לעריכה · Ctrl C \/ Ctrl V<\/span>/);

  const eleven = html(createElement(FieldsMapFooter, { model: mapOf(artboard11()) }));
  assert.match(eleven, /<span class="rf-map__summary">8 שדות משותפים · 13 תאים ללא שדות<\/span>/);
  assert.deepEqual([...eleven.matchAll(/<li class="rf-map__legend-item">(?:<span[^>]*><\/span>|<svg.*?<\/svg>)([^<]+)<\/li>/g)].map((x) => x[1]), [
    "מוגדר", "ללא שדות — העובד יראה את החלון הקבוע", "לא במסלול", "משותף עם מארז אחר", "עמדה ברמת מארז · כרטיס אחד",
  ]);
  assert.match(eleven, /<span class="rf-map__hint">לחיצה על תא פותחת את עורך השדות<\/span>/);
});
