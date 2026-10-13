import { test } from "node:test";
import assert from "node:assert/strict";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import type { MapCell } from "../mapModel";
import {
  buildFieldsMap, bindingKey, cellKey, cellsOfBinding, columnCells, findCell, getCell, getColumn, getRow, groupFieldsOf, relevantCells,
} from "../mapModel";
import { EMPTY_DRAFT_MODEL, currentConfigs, draftReducer, summarize } from "../draftModel";
import { coverageText, mapFooterText } from "../labels";
import { CLOSE, ELEC, KB, KIT_A, KIT_B, MECH, MON, OPEN, PC, STATIONS, VISU, artboard1, artboard11, config, fields, line, route, step } from "./fixtures";

/** The map as the screen builds it: the context through the draft store's working copies. */
function mapOf(ctx: FieldsContextJson, setVersions?: Record<number, number>) {
  const model = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  const summary = summarize(model);
  return buildFieldsMap({ context: ctx, configs: currentConfigs(model), issues: summary.issuesByRoute, setVersions });
}

const asCell = (c: ReturnType<typeof getCell>): MapCell => {
  assert.ok(c && !c.na, "expected a relevant cell");
  return c;
};

test("artboard 1: columns — first kit step, merged item steps, last kit step", () => {
  const m = mapOf(artboard1());
  assert.deepEqual(m.columns.map((c) => [c.n, c.label, c.packageLevel]), [
    [1, "פתיחת מארז", true],
    [2, "חשמל", false],
    [3, "מכניקה", false],
    [4, "בדיקה ויזואלית", false],
    [5, "סגירת מארז", true],
  ]);
  assert.deepEqual(m.columns.map((c) => c.key), ["kit:0", `step:${ELEC}:1`, `step:${MECH}:1`, `step:${VISU}:1`, "kit:1"]);
  assert.equal(m.columns[0].kitStepUid, "s_kitopen1");
  assert.equal(m.columns[4].kitStepUid, "s_kitclos1");
  // "מוגדרים {x}/{y}" exactly as artboard 1 draws them.
  assert.deepEqual(m.columns.map((c) => `${c.defined}/${c.relevant}`), ["5/6", "2/2", "2/2", "4/4", "2/6"]);
});

test("artboard 1: rows — the box, each item, one per line with seq, quantity and route", () => {
  const m = mapOf(artboard1());
  assert.deepEqual(m.rows.map((r) => [r.kind, r.label, r.seq, r.qty, r.sub]), [
    ["box", "הקופסה", "", "", "שדות על המארז עצמו"],
    ["each_item", "כל פריט במארז", "", "", "שדות משותפים לכל הפריטים"],
    ["line", "מחשב", "01", "×1", "מסלול 1 · 4 עמדות"],
    ["line", "מסך", "02–03", "×2", "מסלול 1 · 5 עמדות"],
    ["line", "מקלדת", "04", "×1", "מסלול 1 · 4 עמדות"],
    ["line", "עכבר", "05", "×1", "מסלול 1 · 3 עמדות"],
  ]);
  // Only the screen's route also runs in another kit (Link2 "משותף ל: מארז ציוד היקפי").
  assert.deepEqual(m.rows.map((r) => r.sharedWith.map((k) => k.desc)), [[], [], [], ["מארז ציוד היקפי"], [], []]);
});

test("artboard 1: totals, coverage and the footer", () => {
  const m = mapOf(artboard1());
  assert.deepEqual(m.coverage, { defined: 15, relevant: 20 });
  assert.equal(coverageText(m.coverage.defined, m.coverage.relevant), "כיסוי 15/20");
  assert.equal(m.totals.fields, 37);
  assert.equal(m.totals.emptyCells, 5);
  assert.equal(m.totals.errorCells, 1);
  assert.equal(m.totals.errors, 1);
  assert.equal(m.totals.unpublishedCells, 1);
  assert.equal(mapFooterText({ fields: m.totals.fields, emptyCells: m.totals.emptyCells, errors: m.totals.errors, sharedOnly: false }),
    "37 שדות · 5 תאים ללא שדות · שגיאה אחת");
  assert.equal(m.onboarding, false);
  assert.equal(m.emptyState, null);
});

test("artboard 1: cells bind to (route, step uid, target) — kit groups on kit columns, the item route elsewhere", () => {
  const m = mapOf(artboard1());
  assert.deepEqual(asCell(getCell(m, "box", "kit:0")).binding, { route_id: 100, step_uid: "s_kitopen1", target: "box" });
  assert.deepEqual(asCell(getCell(m, "each_item", "kit:1")).binding, { route_id: 100, step_uid: "s_kitclos1", target: "each_item" });
  assert.deepEqual(asCell(getCell(m, "line:2", "kit:0")).binding, { route_id: 100, step_uid: "s_kitopen1", target: { item_type_id: MON } });
  assert.deepEqual(asCell(getCell(m, "line:2", `step:${MECH}:1`)).binding, { route_id: 102, step_uid: "s_momech00", target: "item" });
  const pcElec = asCell(getCell(m, "line:1", `step:${ELEC}:1`));
  assert.deepEqual(pcElec.stepMeta, { station_type_id: ELEC, station_label: "חשמל", scope: "item" });
  assert.deepEqual(asCell(getCell(m, "box", "kit:0")).stepMeta, { station_type_id: OPEN, station_label: "פתיחת מארז", scope: "package" });
});

test("artboard 1: cell states — counts, dots, error, unpublished, set link and outdated set, shared", () => {
  const m = mapOf(artboard1(), { 7: 2 });
  const box = asCell(getCell(m, "box", "kit:0"));
  assert.equal(box.fieldCount, 3);
  assert.deepEqual(box.tones, ["pass", "warn", "fail"]);

  const pcElec = asCell(getCell(m, "line:1", `step:${ELEC}:1`));
  assert.equal(pcElec.fieldCount, 5);
  assert.equal(pcElec.publishedFieldCount, 4);
  assert.deepEqual(pcElec.tones, ["pass", "warn", "fail", "neutral"]);
  assert.equal(pcElec.unpublished, true);

  const monMech = asCell(getCell(m, "line:2", `step:${MECH}:1`));
  assert.equal(monMech.fieldCount, 2);
  assert.equal(monMech.errorCount, 1);
  assert.deepEqual(monMech.sharedWith, [KIT_B]);

  const pcVisu = asCell(getCell(m, "line:1", `step:${VISU}:1`));
  assert.deepEqual(pcVisu.fromSet, { id: 7, ver: 2 });
  assert.equal(pcVisu.outdated, false);
  const msVisu = asCell(getCell(m, "line:4", `step:${VISU}:1`));
  assert.deepEqual(msVisu.fromSet, { id: 7, ver: 1 });
  assert.equal(msVisu.outdated, true, "the mouse holds version 1 of a set now at 2: 'הערכה עודכנה'");

  const msOpen = asCell(getCell(m, "line:4", "kit:0"));
  assert.equal(msOpen.fieldCount, 0, "the mouse's kit group at opening is empty ('הגדר שדות' on hover)");
  assert.equal(msOpen.unpublished, false);
});

test("artboard 1: '—' cells — fixed rows in item columns, an item that does not pass a station", () => {
  const m = mapOf(artboard1());
  const boxElec = getCell(m, "box", `step:${ELEC}:1`);
  assert.ok(boxElec?.na);
  assert.equal(boxElec.reason, "not_item_row");
  assert.equal(boxElec.tooltip, null);
  const kbElec = getCell(m, "line:3", `step:${ELEC}:1`);
  assert.ok(kbElec?.na);
  assert.equal(kbElec.reason, "not_on_route");
  assert.deepEqual(kbElec.tooltip, { item: "מקלדת", station: "חשמל", routeNumber: 1 });
});

test("artboard 1: the error list points at the cell and the field (the map's error bar)", () => {
  const m = mapOf(artboard1());
  assert.equal(m.errors.length, 1);
  const [e] = m.errors;
  assert.equal(e.issue.code, "OPTION_LABEL_EMPTY");
  assert.equal(e.routeId, 102);
  assert.equal(e.cell?.stationLabel, "מכניקה");
  assert.equal(e.cell?.rowLabel, "מסך");
  assert.equal(e.fieldLabel, "ברגי VESA");
});

test("lookups: findCell by the editor URL's step and target, columnCells, cellKey, bindingKey", () => {
  const m = mapOf(artboard1());
  assert.equal(findCell(m, "s_momech00", "item")?.key, `line:2|step:${MECH}:1`);
  assert.equal(findCell(m, "s_kitopen1", { item_type_id: KB })?.rowKey, "line:3");
  assert.equal(findCell(m, "s_kitopen1", "box")?.columnKey, "kit:0");
  assert.equal(findCell(m, "s_kitopen1", "item"), null);
  assert.equal(findCell(m, "s_unknown0", "item"), null);
  assert.deepEqual(columnCells(m, "kit:0").map((c) => c.rowKey), ["box", "each_item", "line:1", "line:2", "line:3", "line:4"]);
  assert.deepEqual(columnCells(m, `step:${ELEC}:1`).map((c) => c.rowKey), ["line:1", "line:2"]);
  assert.equal(relevantCells(m).length, 20);
  const c = asCell(getCell(m, "line:1", `step:${ELEC}:1`));
  assert.equal(cellKey(c), c.key);
  assert.equal(m.cells.get(c.key), c);
  assert.equal(bindingKey(c.binding), "101|s_pcelec00|item");
  assert.equal(bindingKey({ route_id: 100, step_uid: "s_kitopen1", target: { item_type_id: PC } }), "100|s_kitopen1|type:3");
  assert.deepEqual(cellsOfBinding(m, c.binding).map((x) => x.key), [c.key]);
  assert.equal(getRow(m, "line:2")?.label, "מסך");
  assert.equal(getColumn(m, "kit:1")?.label, "סגירת מארז");
  assert.equal(groupFieldsOf(null, "s_pcelec00", "item").length, 0);
});

test("the map shows the working copy, not only what the server holds", () => {
  const ctx = artboard1();
  const model0 = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  const model = draftReducer(model0, {
    type: "edit",
    routeId: 104,
    mutate: (cfg) => {
      cfg.steps.s_msvisu00.groups[0].fields.pop();
    },
  });
  const m = buildFieldsMap({ context: ctx, configs: currentConfigs(model), issues: summarize(model).issuesByRoute });
  const msVisu = asCell(getCell(m, "line:4", `step:${VISU}:1`));
  assert.equal(msVisu.fieldCount, 2);
  assert.equal(msVisu.unpublished, true);
  assert.equal(m.totals.unpublishedCells, 2);
});

test("artboard 11: shared cells, coverage 3/16, onboarding and the info bar", () => {
  const m = mapOf(artboard11());
  assert.deepEqual(m.columns.map((c) => `${c.label} ${c.defined}/${c.relevant}`), [
    "פתיחת מארז 0/5", "חשמל 1/1", "מכניקה 1/2", "בדיקה ויזואלית 1/3", "סגירת מארז 0/5",
  ]);
  assert.deepEqual(m.coverage, { defined: 3, relevant: 16 });
  assert.equal(m.totals.sharedCells, 3);
  assert.equal(m.totals.sharedFields, 8);
  assert.equal(m.totals.emptyCells, 13);
  assert.equal(mapFooterText({ fields: m.totals.sharedFields, emptyCells: m.totals.emptyCells, errors: 0, sharedOnly: true }),
    "8 שדות משותפים · 13 תאים ללא שדות");
  assert.equal(m.onboarding, true, "no cell this kit's routes hold has a field");
  assert.deepEqual(m.sharedFilled, [{ rowKey: "line:11", itemTypeDesc: "מסך", routeNumber: 1, kits: [KIT_A], cells: 3 }]);
  const elec = asCell(getCell(m, "line:11", `step:${ELEC}:1`));
  assert.deepEqual(elec.sharedWith, [KIT_A]);
  assert.equal(elec.fieldCount, 3);
});

test("onboarding ends with the first field of the kit's own — draft or published", () => {
  const ctx = artboard11();
  const model0 = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  const model = draftReducer(model0, {
    type: "edit",
    routeId: 200,
    mutate: () => config(step("s_kbopen01", OPEN, "package", [{ target: "box", fields: fields(1, ["pass", "fail"]) }])),
  });
  const m = buildFieldsMap({ context: ctx, configs: currentConfigs(model), issues: summarize(model).issuesByRoute });
  assert.equal(m.onboarding, false);
});

test("merging item steps: a new station goes after the last one its route passed; repeats are columns of their own", () => {
  const ctx = (routes: number[][]): FieldsContextJson => ({
    kind: "package",
    subject: { item_type_id: 50, desc: "מארז", is_package: true, route_number: 1 },
    stations: STATIONS,
    kit: route(100, 50, 1, [[OPEN, "s_kopen000"], [CLOSE, "s_kclose00"]]),
    item: null,
    lines: routes.map((steps, i) => line(i + 1, 3 + i, "פריט " + (i + 1), 1, i + 1, i + 1,
      route(110 + i, 3 + i, 1, [OPEN, ...steps, CLOSE].map((t, k) => [t, `s_r${i}k${k}aaaa`.slice(0, 10)])))),
  });
  const labels = (routes: number[][]) => buildFieldsMap({ context: ctx(routes) }).columns.map((c) => c.key);
  assert.deepEqual(labels([[ELEC, VISU], [ELEC, MECH, VISU]]), ["kit:0", `step:${ELEC}:1`, `step:${MECH}:1`, `step:${VISU}:1`, "kit:1"]);
  assert.deepEqual(labels([[ELEC, VISU], [MECH, VISU]]), ["kit:0", `step:${MECH}:1`, `step:${ELEC}:1`, `step:${VISU}:1`, "kit:1"]);
  assert.deepEqual(labels([[ELEC, MECH], [MECH, ELEC]]), ["kit:0", `step:${ELEC}:1`, `step:${MECH}:1`, "kit:1"], "a conflicting order adds no column");
  assert.deepEqual(labels([[ELEC, MECH, ELEC]]), ["kit:0", `step:${ELEC}:1`, `step:${MECH}:1`, `step:${ELEC}:2`, "kit:1"]);
  // The second electrical step binds to the route's second electrical uid.
  const m = buildFieldsMap({ context: ctx([[ELEC, MECH, ELEC]]) });
  assert.deepEqual(asCell(getCell(m, "line:1", `step:${ELEC}:2`)).binding.step_uid, "s_r0k3aaaa");
});

test("a single item route: one row, a column per step, package-level steps are '—'", () => {
  const item = route(300, PC, 2, [[OPEN, "s_iopen000"], [ELEC, "s_ielec000"], [VISU, "s_ivisu000"], [CLOSE, "s_iclose00"]], {
    published: config(step("s_ielec000", ELEC, "item", [{ target: "item", fields: fields(2, ["pass", "fail"]) }])),
    shared: [KIT_A],
  });
  const m = buildFieldsMap({
    context: { kind: "item", subject: { item_type_id: PC, desc: "מחשב", is_package: false, route_number: 2 }, stations: STATIONS, kit: null, item, lines: [] },
  });
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].label, "מחשב");
  assert.equal(m.rows[0].sub, "מסלול 2 · 4 עמדות");
  assert.deepEqual(m.rows[0].sharedWith, [KIT_A], "an item route opened alone: every kit that runs it");
  assert.deepEqual(m.columns.map((c) => c.label), ["פתיחת מארז", "חשמל", "בדיקה ויזואלית", "סגירת מארז"]);
  assert.deepEqual(m.rows[0].cells.map((c) => (c.na ? c.reason : c.fieldCount)), ["package_level", 2, 0, "package_level"]);
  assert.deepEqual(m.coverage, { defined: 1, relevant: 2 });
});

test("empty states: no kit route, a route without steps, a kit without contents", () => {
  const base = artboard1();
  assert.equal(buildFieldsMap({ context: { ...base, kit: null, kit_missing: "ROUTE_MISSING" } }).emptyState, "route_missing");
  const noSteps = route(100, 50, 1, []);
  assert.equal(buildFieldsMap({ context: { ...base, kit: noSteps } }).emptyState, "no_steps");
  const empty = buildFieldsMap({ context: { ...base, lines: [] } });
  assert.equal(empty.emptyState, "no_contents");
  assert.equal(empty.onboarding, false, "an empty state is never the onboarding card");
});

test("a line without its route: kit cells stay, item cells are '—', the sub-line says why", () => {
  const base = artboard1();
  const lines = [...base.lines.slice(0, 2), line(3, KB, "מקלדת", 1, 3, 4, null), base.lines[3]];
  const m = buildFieldsMap({ context: { ...base, lines } });
  const row = getRow(m, "line:3");
  assert.equal(row?.sub, "לסוג הפריט אין מסלול מספר 1");
  assert.equal(row?.routeId, null);
  assert.equal(getCell(m, "line:3", "kit:0")?.na, false);
  const mech = getCell(m, "line:3", `step:${MECH}:1`);
  assert.ok(mech?.na);
  assert.equal(mech.reason, "route_missing");
});

test("step uids that do not line up with the steps bind nothing", () => {
  const base = artboard1();
  const kit = { ...base.kit!, route: { ...base.kit!.route, step_uids: ["s_kitopen1"] } };
  const m = buildFieldsMap({ context: { ...base, kit } });
  const c = getCell(m, "box", "kit:0");
  assert.ok(c?.na);
  assert.equal(c.reason, "no_step_uids");
});

test("a station type the context does not know shows as 'ID {n}', like the steps editor", () => {
  const base = artboard1();
  const pc = base.lines[0].route!;
  const odd = { ...pc, route: { ...pc.route, route_steps: [OPEN, 99, CLOSE], step_uids: ["s_x0open00", "s_x0odd000", "s_x0clos00"] } };
  const m = buildFieldsMap({ context: { ...base, lines: [{ ...base.lines[0], route: odd }] } });
  assert.deepEqual(m.columns.map((c) => c.label), ["פתיחת מארז", "ID 99", "סגירת מארז"]);
});

test("a section header is not a field, and pass_fail brings both of its tones", () => {
  const ctx = artboard1();
  const pc = ctx.lines[0].route!;
  pc.draft = config(step("s_pcelec00", ELEC, "item", [{
    target: "item",
    fields: [
      { id: "f_sect0001", type: "section", label: "הפעלה" },
      { id: "f_pfpf0001", type: "pass_fail", label: "בידוד", required: true, notes: "optional" },
    ],
  }]));
  const m = buildFieldsMap({ context: ctx });
  const c = asCell(getCell(m, "line:1", `step:${ELEC}:1`));
  assert.equal(c.fieldCount, 1);
  assert.deepEqual(c.tones, ["pass", "fail"]);
});
