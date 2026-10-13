import { test } from "node:test";
import assert from "node:assert/strict";
import { kitItemGroups, resolveStationFields, stepUidAt } from "../resolve";
import type { ResolveInput } from "../resolve";
import { parseRouteFieldsConfig } from "../validate";
import type { ChoiceOption, Field, RouteFieldsConfig, Tone } from "../schema";

// ---- fixtures -----------------------------------------------------------------------------
// Station types: 21 פתיחת מארז, 22 חשמל, 24 בדיקה ויזואלית, 26 סגירת מארז.
// Item types: 12 מחשב, 13 מקלדת, 14 מסך.
const opt = (id: string, label: string, tone: Tone): ChoiceOption => ({ id, label, tone });
const EXT = [opt("o_ext00001", "ללא פגמים", "pass"), opt("o_ext00002", "שריטות קלות", "warn"), opt("o_ext00003", "שבר/סדק", "fail"), opt("o_ext00004", "לכלוך", "warn")];
const PARTS = [opt("o_prt00001", "קיים", "pass"), opt("o_prt00002", "חסר", "fail"), opt("o_prt00003", "פגום", "fail"), opt("o_prt00004", "הוחלף", "warn")];
const choice = (id: string, label: string, options: ChoiceOption[]): Field =>
  ({ id, type: "choice_row", label, required: true, notes: "required_on_fail", options }) as Field;

const sectionHead: Field = { id: "f_sec00001", type: "section", label: "הפעלה" };
const led = choice("f_led00001", "נורית מתח", PARTS);
const gnd: Field = { id: "f_gnd00001", type: "number", label: "התנגדות הארקה", required: true, notes: "optional", unit: "Ω", max: 0.1, out_of_range_fail: true };

/** Route 1 of מחשב: [פתיחת מארז, חשמל, בדיקה ויזואלית, סגירת מארז]. */
const ITEM_ROUTE = { test_route_id: 77, route_steps: [21, 22, 24, 26], step_uids: ["s_open0001", "s_elec0001", "s_visu0001", "s_clos0001"] };
const ITEM_CONFIG: RouteFieldsConfig = {
  schema: 1,
  steps: {
    s_elec0001: { uid: "s_elec0001", station_type_id: 22, station_label: "חשמל", scope: "item", groups: [{ target: "item", fields: [sectionHead, led, gnd] }] },
    // Only a section header: nothing for the worker to fill.
    s_visu0001: { uid: "s_visu0001", station_type_id: 24, station_label: "בדיקה ויזואלית", scope: "item", groups: [{ target: "item", fields: [{ id: "f_sec00002", type: "section", label: "חזות" }] }] },
  },
};

const box = choice("f_box00001", "שלמות הקופסה", EXT);
const each = choice("f_ext00001", "מצב חיצוני", EXT);
const stand = choice("f_stand001", "מעמד", PARTS);
const cable = choice("f_cable001", "כבל DisplayPort", PARTS);

/** Route 1 of מארז עמדת עבודה: [פתיחת מארז, סגירת מארז]. */
const KIT_ROUTE = { test_route_id: 91, route_steps: [21, 26], step_uids: ["s_kopen001", "s_kclose01"] };
const KIT_CONFIG: RouteFieldsConfig = {
  schema: 1,
  steps: {
    s_kopen001: {
      uid: "s_kopen001", station_type_id: 21, station_label: "פתיחת מארז", scope: "package",
      groups: [
        { target: { item_type_id: 14 }, fields: [stand, cable] },          // listed before each_item on purpose
        { target: "box", fields: [box] },
        { target: "each_item", fields: [each] },
        { target: { item_type_id: 13 }, fields: [{ id: "f_sec00003", type: "section", label: "מקלדת" }] },
      ],
    },
    s_kclose01: {
      uid: "s_kclose01", station_type_id: 26, station_label: "סגירת מארז", scope: "package",
      groups: [
        { target: "box", fields: [] },
        { target: { item_type_id: 99 }, fields: [choice("f_other001", "אחר", EXT)] },   // a type this kit does not hold
      ],
    },
  },
};
const KIT_ITEMS = [
  { item_id: "1005150926000303", package_seq: 3, item_type_id: 14, item_type_desc: "מסך" },
  { item_id: "1005150926000301", package_seq: 1, item_type_id: 12, item_type_desc: "מחשב" },
  { item_id: "1005150926000304", package_seq: 4, item_type_id: 13, item_type_desc: "מקלדת" },
  { item_id: "1005150926000302", package_seq: 2, item_type_id: 14, item_type_desc: "מסך" },
];

const itemInput = (over: Partial<ResolveInput> = {}): ResolveInput => ({
  route: ITEM_ROUTE, fields_version: 3, current_route_step: 2, current_status: 1, stationIsResearch: false,
  stepIsPackageLevel: false, rowIsPackage: false, config: ITEM_CONFIG, kitItems: [], gate: true, ...over,
});
const kitInput = (over: Partial<ResolveInput> = {}): ResolveInput => ({
  route: KIT_ROUTE, fields_version: 5, current_route_step: 1, current_status: 1, stationIsResearch: false,
  stepIsPackageLevel: true, rowIsPackage: true, config: KIT_CONFIG, kitItems: KIT_ITEMS, gate: true, ...over,
});
const LEGACY = { mode: "legacy" };

test("fixtures are valid configs", () => {
  assert.deepEqual(parseRouteFieldsConfig(ITEM_CONFIG), ITEM_CONFIG);
  assert.deepEqual(parseRouteFieldsConfig(KIT_CONFIG), KIT_CONFIG);
});

// ---- item ---------------------------------------------------------------------------------
test("item: a per-item step with a published config", () => {
  assert.deepEqual(resolveStationFields(itemInput()), {
    mode: "item",
    schema: { route_id: 77, v: 3, step_uid: "s_elec0001", target: "item" },
    fields: [sectionHead, led, gnd],
    gate: true,
  });
  const ungated = resolveStationFields(itemInput({ gate: false }));
  assert.deepEqual([ungated.mode, ungated.mode === "item" ? ungated.gate : null], ["item", false]);
  // Kit items are irrelevant to an item row.
  assert.deepEqual(resolveStationFields(itemInput({ kitItems: KIT_ITEMS })), resolveStationFields(itemInput()));
});

test("legacy: no frozen version", () => {
  assert.deepEqual(resolveStationFields(itemInput({ fields_version: null })), LEGACY);
  assert.deepEqual(resolveStationFields(itemInput({ fields_version: 0 })), LEGACY);
  assert.deepEqual(resolveStationFields(itemInput({ config: null })), LEGACY);
});

test("legacy: step_uids that do not line up with route_steps", () => {
  assert.deepEqual(resolveStationFields(itemInput({ route: { ...ITEM_ROUTE, step_uids: ITEM_ROUTE.step_uids.slice(0, 3) } })), LEGACY);
  assert.deepEqual(resolveStationFields(itemInput({ route: { ...ITEM_ROUTE, step_uids: [] } })), LEGACY);
  assert.deepEqual(resolveStationFields(itemInput({ route: { ...ITEM_ROUTE, step_uids: null } })), LEGACY);
});

test("legacy: the current step is out of range", () => {
  for (const step of [0, 5, 1.5, -1]) assert.deepEqual(resolveStationFields(itemInput({ current_route_step: step })), LEGACY, `step ${step}`);
});

test("legacy: the step's uid is missing from the frozen version", () => {
  // Step 4 (סגירת מארז) has no config in this route at all.
  assert.deepEqual(resolveStationFields(itemInput({ current_route_step: 4, stepIsPackageLevel: false })), LEGACY);
  // The step was re-added after the version was frozen: a new uid the version never saw.
  const readded = { ...ITEM_ROUTE, step_uids: ["s_open0001", "s_new00001", "s_visu0001", "s_clos0001"] };
  assert.deepEqual(resolveStationFields(itemInput({ route: readded })), LEGACY);
});

test("legacy: empty groups, section headers only, or no group for the row", () => {
  assert.deepEqual(resolveStationFields(itemInput({ current_route_step: 3 })), LEGACY);
  const emptyGroups: RouteFieldsConfig = { schema: 1, steps: { s_elec0001: { ...ITEM_CONFIG.steps.s_elec0001, groups: [] } } };
  assert.deepEqual(resolveStationFields(itemInput({ config: emptyGroups })), LEGACY);
  const emptyFields: RouteFieldsConfig = { schema: 1, steps: { s_elec0001: { ...ITEM_CONFIG.steps.s_elec0001, groups: [{ target: "item", fields: [] }] } } };
  assert.deepEqual(resolveStationFields(itemInput({ config: emptyFields })), LEGACY);
});

test("legacy: a stored config that does not parse", () => {
  assert.deepEqual(resolveStationFields(itemInput({ config: { schema: 2, steps: {} } })), LEGACY);
  assert.deepEqual(resolveStationFields(itemInput({ config: "garbage" })), LEGACY);
  const broken = JSON.parse(JSON.stringify(ITEM_CONFIG));
  broken.steps.s_elec0001.groups[0].fields[1].options = "x";
  assert.deepEqual(resolveStationFields(itemInput({ config: broken })), LEGACY);
});

test("legacy: research — status 4 / 5, or a research station", () => {
  assert.deepEqual(resolveStationFields(itemInput({ current_status: 4 })), LEGACY);
  assert.deepEqual(resolveStationFields(itemInput({ current_status: 5 })), LEGACY);
  assert.deepEqual(resolveStationFields(itemInput({ stationIsResearch: true })), LEGACY);
  assert.deepEqual(resolveStationFields(kitInput({ current_status: 5 })), LEGACY);
  assert.equal(resolveStationFields(itemInput({ current_status: 2 })).mode, "item");
  assert.equal(resolveStationFields(itemInput({ current_status: null })).mode, "item");
});

test("legacy: an item row at a package-level step, a kit row at a per-item step", () => {
  // An item inside a kit at פתיחת מארז: the popup opens on the box, never on the item.
  assert.deepEqual(resolveStationFields(itemInput({ current_route_step: 1, stepIsPackageLevel: true })), LEGACY);
  assert.deepEqual(resolveStationFields(kitInput({ stepIsPackageLevel: false })), LEGACY);
  assert.deepEqual(resolveStationFields(itemInput({ rowIsPackage: true })), LEGACY);
});

// ---- package ----------------------------------------------------------------------------------
test("package: the box fields plus each kit item's groups, by package_seq", () => {
  assert.deepEqual(resolveStationFields(kitInput()), {
    mode: "package",
    schema: { route_id: 91, v: 5, step_uid: "s_kopen001" },
    box: [box],
    items: [
      { item_id: "1005150926000301", package_seq: 1, item_type_id: 12, item_type_desc: "מחשב", groups: [{ target: "each_item", fields: [each] }] },
      { item_id: "1005150926000302", package_seq: 2, item_type_id: 14, item_type_desc: "מסך", groups: [
        { target: "each_item", fields: [each] }, { target: { item_type_id: 14 }, fields: [stand, cable] },
      ] },
      { item_id: "1005150926000303", package_seq: 3, item_type_id: 14, item_type_desc: "מסך", groups: [
        { target: "each_item", fields: [each] }, { target: { item_type_id: 14 }, fields: [stand, cable] },
      ] },
      // מקלדת's own group holds a section header only: omitted.
      { item_id: "1005150926000304", package_seq: 4, item_type_id: 13, item_type_desc: "מקלדת", groups: [{ target: "each_item", fields: [each] }] },
    ],
    gate: true,
  });
  // (The schema above carries no target: the popup adds "box" or "kit_item" per row it saves.)
});

test("package: no box fields → box is empty; no item groups → items listed with no groups", () => {
  const noBox: RouteFieldsConfig = { schema: 1, steps: { s_kopen001: { ...KIT_CONFIG.steps.s_kopen001, groups: KIT_CONFIG.steps.s_kopen001.groups.filter((g) => g.target !== "box") } } };
  const res = resolveStationFields(kitInput({ config: noBox }));
  assert.equal(res.mode, "package");
  assert.deepEqual(res.mode === "package" ? res.box : null, []);
  const boxOnly: RouteFieldsConfig = { schema: 1, steps: { s_kopen001: { ...KIT_CONFIG.steps.s_kopen001, groups: [{ target: "box", fields: [box] }] } } };
  const boxRes = resolveStationFields(kitInput({ config: boxOnly }));
  assert.deepEqual(boxRes.mode === "package" ? boxRes.items.map((it) => [it.package_seq, it.groups]) : null, [[1, []], [2, []], [3, []], [4, []]]);
  assert.deepEqual(resolveStationFields(kitInput({ config: boxOnly, kitItems: [] })), {
    mode: "package", schema: { route_id: 91, v: 5, step_uid: "s_kopen001" }, box: [box], items: [], gate: true,
  });
});

test("package: legacy when nothing applies to this kit", () => {
  // סגירת מארז: an empty box and a group for an item type the kit does not hold.
  assert.deepEqual(resolveStationFields(kitInput({ current_route_step: 2 })), LEGACY);
  assert.deepEqual(resolveStationFields(kitInput({ fields_version: null })), LEGACY);
});

// ---- helpers ------------------------------------------------------------------------------------
test("stepUidAt: 1-based, null out of range or without usable uids", () => {
  assert.equal(stepUidAt(ITEM_ROUTE, 1), "s_open0001");
  assert.equal(stepUidAt(ITEM_ROUTE, 4), "s_clos0001");
  assert.equal(stepUidAt(ITEM_ROUTE, 0), null);
  assert.equal(stepUidAt(ITEM_ROUTE, 5), null);
  assert.equal(stepUidAt({ route_steps: [21, 22], step_uids: ["s_open0001"] }, 1), null);
  assert.equal(stepUidAt({ route_steps: null, step_uids: null }, 1), null);
  assert.equal(stepUidAt({ route_steps: [21], step_uids: [""] }, 1), null);
});

test("kitItemGroups: each_item first, then the item's own type; empty groups left out", () => {
  const step = KIT_CONFIG.steps.s_kopen001;
  assert.deepEqual(kitItemGroups(step, 14), [{ target: "each_item", fields: [each] }, { target: { item_type_id: 14 }, fields: [stand, cable] }]);
  assert.deepEqual(kitItemGroups(step, 13), [{ target: "each_item", fields: [each] }]);
  assert.deepEqual(kitItemGroups(KIT_CONFIG.steps.s_kclose01, 14), []);
  assert.deepEqual(kitItemGroups(KIT_CONFIG.steps.s_kclose01, 99), [{ target: { item_type_id: 99 }, fields: KIT_CONFIG.steps.s_kclose01.groups[1].fields }]);
});
