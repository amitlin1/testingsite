import { test } from "node:test";
import assert from "node:assert/strict";
import { diffConfigs } from "../diff";
import type { Change } from "../diff";
import type {
  ChecklistField, ChoiceOption, ChoiceRowField, Field, NumberField, PhotoField, RouteFieldsConfig, SectionField, Tone,
} from "../schema";

// ---- fixtures -----------------------------------------------------------------------------
const opt = (id: string, label: string, tone: Tone): ChoiceOption => ({ id, label, tone });
const LED = [opt("o_led00001", "תקין", "pass"), opt("o_led00002", "מהבהבת", "warn"), opt("o_led00003", "לא דולקת", "fail"), opt("o_led00004", "לא נבדק", "neutral")];
const POST = [opt("o_post0001", "עולה תקין", "pass"), opt("o_post0002", "עולה עם שגיאה", "warn"), opt("o_post0003", "לא עולה", "fail")];
const EXT = [opt("o_ext00001", "ללא פגמים", "pass"), opt("o_ext00002", "שבר/סדק", "fail")];

const sec: SectionField = { id: "f_sec00001", type: "section", label: "הפעלה" };
const led: ChoiceRowField = { id: "f_led00001", type: "choice_row", label: "נורית מתח", required: false, notes: "required_on_fail", options: LED, list_ref: { id: 4, ver: 2 } };
const post: ChoiceRowField = { id: "f_post0001", type: "choice_row", label: "הפעלה ו-POST", required: true, notes: "required_on_fail", options: POST };
const fan: ChoiceRowField = { id: "f_fan00001", type: "choice_row", label: "מאוורר ספק הכוח", required: false, notes: "optional", options: EXT };
const gnd: NumberField = { id: "f_gnd00001", type: "number", label: "התנגדות הארקה", required: true, notes: "optional", unit: "Ω", max: 0.1, out_of_range_fail: true };
const box: ChoiceRowField = { id: "f_box00001", type: "choice_row", label: "שלמות הקופסה", required: true, notes: "required_on_fail", options: EXT };
const ext: ChoiceRowField = { id: "f_ext00001", type: "choice_row", label: "מצב חיצוני", required: false, notes: "optional", options: EXT };
const kit: ChecklistField = { id: "f_kit00001", type: "checklist", label: "אביזרים", required: false, notes: "off", items: [{ id: "c_stand001", label: "מעמד" }] };
const shot: PhotoField = { id: "f_pho00001", type: "photo", label: "צילום חזית", required: false, notes: "off", photo_type: "front", min: 1 };
const jsonCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A fresh copy every call. A JSON round-trip (not structuredClone, which would keep the fields that
 *  share EXT sharing one cloned array) so editing one field's options never touches another's. */
const BASE = (): RouteFieldsConfig => jsonCopy({
  schema: 1 as const,
  steps: {
    s_elec0001: { uid: "s_elec0001", station_type_id: 22, station_label: "חשמל", scope: "item" as const, groups: [{ target: "item" as const, fields: [sec, led, post, fan, gnd] as Field[] }] },
    s_open0001: {
      uid: "s_open0001", station_type_id: 21, station_label: "פתיחת מארז", scope: "package" as const,
      groups: [
        { target: "box" as const, fields: [box] as Field[] },
        { target: "each_item" as const, fields: [ext] as Field[] },
        { target: { item_type_id: 14 }, fields: [kit, shot] as Field[] },
      ],
      layout: { fields_placement: "in_step" },
    },
  },
});
const elec = (c: RouteFieldsConfig): Field[] => c.steps.s_elec0001.groups[0].fields;
const byId = <T extends Field>(c: RouteFieldsConfig, id: string): T => {
  for (const s of Object.values(c.steps)) for (const g of s.groups) for (const f of g.fields) if (f.id === id) return f as T;
  throw new Error(`no field ${id}`);
};
/** prev = BASE, next = BASE edited. */
const diffAfter = (edit: (next: RouteFieldsConfig) => void): Change[] => {
  const next = BASE();
  edit(next);
  return diffConfigs(BASE(), next, 77);
};
const brief = (rows: Change[]) => rows.map((r) => [r.kind, r.field_id ?? null, r.label, r.detail ?? null]);

// ---- tests ----------------------------------------------------------------------------------
test("identical configs have no changes", () => {
  assert.deepEqual(diffConfigs(BASE(), BASE(), 77), []);
  // Key order inside a layout is not a change; {} and no layout are the same.
  assert.deepEqual(diffAfter((n) => { n.steps.s_open0001.layout = JSON.parse('{"fields_placement":"in_step"}'); }), []);
  const noLayout = BASE();
  delete noLayout.steps.s_open0001.layout;
  const emptyLayout = BASE();
  emptyLayout.steps.s_open0001.layout = {};
  assert.deepEqual(diffConfigs(noLayout, emptyLayout, 77), []);
});

test("field added / removed — one row per field, every row carries the route and the target", () => {
  const added = diffAfter((n) => { elec(n).push({ id: "f_iso00001", type: "pass_fail", label: "בדיקת בידוד", required: true, notes: "required_on_fail" }); });
  assert.deepEqual(added, [{ route_id: 77, step_uid: "s_elec0001", target: "item", kind: "field_added", field_id: "f_iso00001", label: "בדיקת בידוד" }]);
  const removed = diffAfter((n) => { n.steps.s_elec0001.groups[0].fields = elec(n).filter((f) => f.id !== "f_fan00001"); });
  assert.deepEqual(removed, [{ route_id: 77, step_uid: "s_elec0001", target: "item", kind: "field_removed", field_id: "f_fan00001", label: "מאוורר ספק הכוח" }]);
  assert.equal(removed[0].filled_count, undefined);   // publish-preview counts it, not the diff
  const kitRow = diffAfter((n) => { n.steps.s_open0001.groups[2].fields.push({ id: "f_new00001", type: "scan", label: "מק״ט", required: false, notes: "off" }); });
  assert.deepEqual(kitRow[0].target, { item_type_id: 14 });
});

test("options: added, removed and tone changes are rows of their own, named by the option", () => {
  const rows = diffAfter((n) => {
    const f = byId<ChoiceRowField>(n, "f_post0001");
    f.options = [f.options[0], { ...f.options[1], tone: "fail" }, opt("o_post0004", "לא נבדק", "neutral")];
  });
  assert.deepEqual(brief(rows), [
    ["field_changed", "f_post0001", "הפעלה ו-POST", { option_added: "לא נבדק" }],
    ["field_changed", "f_post0001", "הפעלה ו-POST", { option_removed: "לא עולה" }],
    ["field_changed", "f_post0001", "הפעלה ו-POST", { tone_changed: "עולה עם שגיאה" }],
  ]);
});

test("required, notes and note length", () => {
  assert.deepEqual(brief(diffAfter((n) => { byId<ChoiceRowField>(n, "f_led00001").required = true; })), [
    ["field_changed", "f_led00001", "נורית מתח", { required: true }],
  ]);
  assert.deepEqual(brief(diffAfter((n) => { byId<ChoiceRowField>(n, "f_post0001").required = false; })), [
    ["field_changed", "f_post0001", "הפעלה ו-POST", { required: false }],
  ]);
  assert.deepEqual(brief(diffAfter((n) => { byId<ChoiceRowField>(n, "f_fan00001").notes = "required"; })), [
    ["field_changed", "f_fan00001", "מאוורר ספק הכוח", { notes: "required" }],
  ]);
  // The default made explicit is no change; another maximum is.
  assert.deepEqual(diffAfter((n) => { byId<ChoiceRowField>(n, "f_led00001").note_max = 1000; }), []);
  assert.deepEqual(brief(diffAfter((n) => { byId<ChoiceRowField>(n, "f_led00001").note_max = 2000; })), [
    ["field_changed", "f_led00001", "נורית מתח", { note_max: 2000 }],
  ]);
});

test("rename: the row carries the new label and renamed_from", () => {
  assert.deepEqual(brief(diffAfter((n) => { byId<ChoiceRowField>(n, "f_led00001").label = "נורית חשמל"; })), [
    ["field_changed", "f_led00001", "נורית חשמל", { renamed_from: "נורית מתח" }],
  ]);
  // A section counts like a field: its label only.
  assert.deepEqual(brief(diffAfter((n) => { byId<SectionField>(n, "f_sec00001").label = "בטיחות"; })), [
    ["field_changed", "f_sec00001", "בטיחות", { renamed_from: "הפעלה" }],
  ]);
});

test("reorder: only the field that moved is reported", () => {
  // Swap two neighbours — one row, not two.
  const swap = diffAfter((n) => { const f = elec(n); [f[1], f[2]] = [f[2], f[1]]; });
  assert.deepEqual(brief(swap), [["field_changed", "f_post0001", "הפעלה ו-POST", { moved: true }]]);
  // Move the first field to the end.
  const toEnd = diffAfter((n) => { const f = elec(n); f.push(f.splice(1, 1)[0]); });
  assert.deepEqual(brief(toEnd), [["field_changed", "f_led00001", "נורית מתח", { moved: true }]]);
  // Additions and removals around a field do not move it.
  const around = diffAfter((n) => {
    n.steps.s_elec0001.groups[0].fields = [{ id: "f_new00001", type: "pass_fail", label: "חדש", required: false, notes: "off" }, ...elec(n).slice(2)];
  });
  assert.deepEqual(around.map((r) => r.kind), ["field_added", "field_removed", "field_removed"]);
});

test("step removed: one row with the station label; nothing per field", () => {
  const rows = diffAfter((n) => { delete n.steps.s_elec0001; });
  assert.deepEqual(rows, [{ route_id: 77, step_uid: "s_elec0001", target: "item", kind: "step_removed", label: "חשמל" }]);
  const pkg = diffAfter((n) => { delete n.steps.s_open0001; });
  assert.deepEqual(pkg, [{ route_id: 77, step_uid: "s_open0001", target: "box", kind: "step_removed", label: "פתיחת מארז" }]);
});

test("layout: any difference is one layout_changed row", () => {
  const rows = diffAfter((n) => { n.steps.s_open0001.layout = { fields_placement: "separate_step" }; });
  assert.deepEqual(rows, [{ route_id: 77, step_uid: "s_open0001", target: "box", kind: "layout_changed", label: "פתיחת מארז" }]);
  assert.equal(diffAfter((n) => { delete n.steps.s_open0001.layout; })[0].kind, "layout_changed");
  assert.equal(diffAfter((n) => { n.steps.s_elec0001.layout = { preset: "one_card" }; })[0].target, "item");
});

test("shared list link: link, unlink, relink", () => {
  assert.deepEqual(brief(diffAfter((n) => { delete byId<ChoiceRowField>(n, "f_led00001").list_ref; })), [
    ["field_changed", "f_led00001", "נורית מתח", { list_linked: false }],
  ]);
  assert.deepEqual(brief(diffAfter((n) => { byId<ChoiceRowField>(n, "f_led00001").list_ref = { id: 4, ver: 3 }; })), [
    ["field_changed", "f_led00001", "נורית מתח", { list_linked: true }],
  ]);
  assert.deepEqual(brief(diffAfter((n) => { byId<ChoiceRowField>(n, "f_fan00001").list_ref = { id: 9, ver: 1 }; })), [
    ["field_changed", "f_fan00001", "מאוורר ספק הכוח", { list_linked: true }],
  ]);
});

test("field-set link: from_set is '<id>:<ver>', '' when unlinked; an added linked field says where it came from", () => {
  const linked = BASE();
  byId<ChoiceRowField>(linked, "f_box00001").from_set = { id: 7, ver: 3 };
  assert.deepEqual(brief(diffConfigs(BASE(), linked, 91)), [["field_changed", "f_box00001", "שלמות הקופסה", { from_set: "7:3" }]]);
  assert.deepEqual(brief(diffConfigs(linked, BASE(), 91)), [["field_changed", "f_box00001", "שלמות הקופסה", { from_set: "" }]]);
  const added = diffAfter((n) => { n.steps.s_open0001.groups[0].fields.push({ ...box, id: "f_set00001", label: "מדבקת סגירה", from_set: { id: 7, ver: 3 } }); });
  assert.deepEqual(brief(added), [["field_added", "f_set00001", "מדבקת סגירה", { from_set: "7:3" }]]);
});

test("everything else is one 'other' row per field", () => {
  const other = [["field_changed", "f_gnd00001", "התנגדות הארקה", { other: true }]];
  assert.deepEqual(brief(diffAfter((n) => { byId<NumberField>(n, "f_gnd00001").max = 0.2; })), other);
  assert.deepEqual(brief(diffAfter((n) => { Object.assign(byId<NumberField>(n, "f_gnd00001"), { unit: "mΩ", min: 0, help: "מדוד" }); })), other);
  assert.deepEqual(brief(diffAfter((n) => { byId<NumberField>(n, "f_gnd00001").out_of_range_fail = false; })), other);
  // Rewording or reordering options both versions share.
  assert.deepEqual(brief(diffAfter((n) => { byId<ChoiceRowField>(n, "f_fan00001").options[0].label = "תקין"; })), [
    ["field_changed", "f_fan00001", "מאוורר ספק הכוח", { other: true }],
  ]);
  assert.deepEqual(brief(diffAfter((n) => { byId<ChoiceRowField>(n, "f_fan00001").options.reverse(); })), [
    ["field_changed", "f_fan00001", "מאוורר ספק הכוח", { other: true }],
  ]);
  assert.deepEqual(brief(diffAfter((n) => { byId<ChecklistField>(n, "f_kit00001").items.push({ id: "c_cable001", label: "כבל" }); })), [
    ["field_changed", "f_kit00001", "אביזרים", { other: true }],
  ]);
  assert.deepEqual(brief(diffAfter((n) => { byId<PhotoField>(n, "f_pho00001").min = 2; })), [
    ["field_changed", "f_pho00001", "צילום חזית", { other: true }],
  ]);
});

test("type change: a type row; the options a choice field keeps are compared as usual", () => {
  const rows = diffAfter((n) => {
    const fields = elec(n);
    const i = fields.findIndex((f) => f.id === "f_fan00001");
    fields[i] = { ...fan, type: "multi_choice", options: [...EXT, opt("o_ext00003", "לכלוך", "warn")] };
  });
  assert.deepEqual(brief(rows), [
    ["field_changed", "f_fan00001", "מאוורר ספק הכוח", { type: "multi_choice" }],
    ["field_changed", "f_fan00001", "מאוורר ספק הכוח", { option_added: "לכלוך" }],
  ]);
});

test("several aspects of one field: one row each, in a fixed order", () => {
  const rows = diffAfter((n) => {
    const fields = elec(n);
    const f = byId<ChoiceRowField>(n, "f_led00001");
    Object.assign(f, { label: "נורית", required: true, notes: "required", note_max: 500, help: "בדוק" });
    f.options = [{ ...LED[0], tone: "warn" }, LED[1], LED[2], opt("o_led00005", "שבורה", "fail")];
    delete f.list_ref;
    fields.push(fields.splice(1, 1)[0]);
  });
  assert.deepEqual(rows.map((r) => r.detail), [
    { renamed_from: "נורית מתח" },
    { required: true },
    { notes: "required" },
    { note_max: 500 },
    { option_added: "שבורה" },
    { option_removed: "לא נבדק" },
    { tone_changed: "תקין" },
    { list_linked: false },
    { moved: true },
    { other: true },
  ]);
  assert.ok(rows.every((r) => r.kind === "field_changed" && r.field_id === "f_led00001" && r.label === "נורית"));
});

test("groups and steps that appear or disappear; deterministic order", () => {
  // Never published: every field is added, step by step in key order; a layout is reported too.
  const first = diffConfigs(null, BASE(), 77);
  assert.deepEqual(first.map((r) => [r.step_uid, r.kind, r.field_id ?? null]), [
    ["s_elec0001", "field_added", "f_sec00001"],
    ["s_elec0001", "field_added", "f_led00001"],
    ["s_elec0001", "field_added", "f_post0001"],
    ["s_elec0001", "field_added", "f_fan00001"],
    ["s_elec0001", "field_added", "f_gnd00001"],
    ["s_open0001", "field_added", "f_box00001"],
    ["s_open0001", "field_added", "f_ext00001"],
    ["s_open0001", "field_added", "f_kit00001"],
    ["s_open0001", "field_added", "f_pho00001"],
    ["s_open0001", "layout_changed", null],
  ]);
  // A group dropped from a step: its fields are removed (after the step's other rows).
  const dropGroup = diffAfter((n) => {
    n.steps.s_open0001.groups = n.steps.s_open0001.groups.filter((g) => g.target !== "each_item");
    n.steps.s_open0001.groups.push({ target: { item_type_id: 15 }, fields: [{ ...ext, id: "f_ext00002" }] });
  });
  assert.deepEqual(dropGroup.map((r) => [r.kind, r.field_id, r.target]), [
    ["field_added", "f_ext00002", { item_type_id: 15 }],
    ["field_removed", "f_ext00001", "each_item"],
  ]);
  // Steps in the new config's key order, removed steps last.
  const reordered = diffAfter((n) => {
    const open = n.steps.s_open0001;
    n.steps = { s_open0001: open, s_new00001: { uid: "s_new00001", station_type_id: 24, station_label: "בדיקה ויזואלית", scope: "item", groups: [{ target: "item", fields: [{ ...ext, id: "f_vis00001" }] }] } };
    byId<ChoiceRowField>(n, "f_box00001").required = false;
  });
  assert.deepEqual(reordered.map((r) => [r.step_uid, r.kind]), [
    ["s_open0001", "field_changed"],
    ["s_new00001", "field_added"],
    ["s_elec0001", "step_removed"],
  ]);
});
