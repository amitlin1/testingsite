import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  ShapeError,
  checkConfigAgainstRoute,
  lintFields,
  lintRouteFieldsConfig,
  optionListLine,
  parseFieldList,
  parseOptionList,
  parseRouteFieldsConfig,
  takenLabels,
  unknownStepIssues,
} from "../validate";
import type { Issue } from "../validate";
import { FIELD_TYPES, NOTES_MODE_LABEL, TONE_WORD, targetKey } from "../schema";
import type { ChoiceOption, Field, RouteFieldsConfig, Tone } from "../schema";
import { UNDRAWN_TEXT, LINT_TEXT, duplicateSkipText, optionEmptyMapText, optionsOkText } from "../labels";

// ---- fixtures -----------------------------------------------------------------------
const opt = (id: string, label: string, tone: Tone): ChoiceOption => ({ id, label, tone });
const LED = [
  opt("o_led00001", "תקין", "pass"), opt("o_led00002", "מהבהבת", "warn"),
  opt("o_led00003", "לא דולקת", "fail"), opt("o_led00004", "לא נבדק", "neutral"),
];
const EXT = [
  opt("o_ext00001", "ללא פגמים", "pass"), opt("o_ext00002", "שריטות קלות", "warn"),
  opt("o_ext00003", "שבר/סדק", "fail"), opt("o_ext00004", "לכלוך", "warn"),
];

/** A clean config: a per-item step (חשמל) and a package-level step (פתיחת מארז). */
function validConfig() {
  return {
    schema: 1,
    steps: {
      s_elec0001: {
        uid: "s_elec0001", station_type_id: 22, station_label: "חשמל", scope: "item",
        groups: [{
          target: "item",
          fields: [
            { id: "f_sec00001", type: "section", label: "הפעלה" },
            { id: "f_led00001", type: "choice_row", label: "נורית מתח", required: true, notes: "required_on_fail", options: LED, list_ref: { id: 4, ver: 2 } },
            { id: "f_gnd00001", type: "number", label: "התנגדות הארקה", help: "מדוד בין פין ההארקה לגוף המארז", required: true, notes: "optional", unit: "Ω", max: 0.1, out_of_range_fail: true },
            { id: "f_iso00001", type: "pass_fail", label: "בדיקת בידוד", required: true, notes: "required_on_fail", note_max: 2000 },
          ],
        }],
      },
      s_open0001: {
        uid: "s_open0001", station_type_id: 21, station_label: "פתיחת מארז", scope: "package",
        groups: [
          { target: "box", fields: [{ id: "f_box00001", type: "choice_row", label: "שלמות הקופסה", required: true, notes: "required_on_fail", options: EXT, from_set: { id: 7, ver: 3 } }] },
          { target: "each_item", fields: [{ id: "f_ext00001", type: "multi_choice", label: "מצב חיצוני", required: false, notes: "optional", options: EXT }] },
          { target: { item_type_id: 14 }, fields: [
            { id: "f_chk00001", type: "checklist", label: "אביזרים", required: false, notes: "off", items: [{ id: "c_stand001", label: "מעמד" }, { id: "c_cable001", label: "כבל DisplayPort" }] },
            { id: "f_pho00001", type: "photo", label: "צילום", required: false, notes: "optional", photo_type: "front", min: 2 },
            { id: "f_txt00001", type: "text", label: "הערת קליטה", required: false, notes: "off" },
            { id: "f_lng00001", type: "textarea", label: "תיאור", required: false, notes: "off" },
            { id: "f_scn00001", type: "scan", label: "מק״ט", required: false, notes: "off" },
          ] },
        ],
        layout: { fields_placement: "in_step", nested: { a: [1, "x", null, true] } },
      },
    },
  };
}

type Mutable = ReturnType<typeof validConfig>;
/** A fresh valid config, changed by `edit`, then parsed. */
function parseEdited(edit: (c: Mutable & Record<string, any>) => void): RouteFieldsConfig {
  const c = validConfig();
  edit(c as Mutable & Record<string, any>);
  return parseRouteFieldsConfig(c);
}
function assertShape(fn: () => unknown, pathPart: string, msgPart?: string): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof ShapeError, `expected ShapeError, got ${String(e)}`);
    assert.equal(e.code, "SHAPE_INVALID");
    assert.ok(e.path.includes(pathPart), `path ${e.path} should include ${pathPart}`);
    if (msgPart) assert.ok(e.message.includes(msgPart), `message "${e.message}" should include "${msgPart}"`);
    return true;
  });
}
const elecFields = (c: any): any[] => c.steps.s_elec0001.groups[0].fields;

// ---- structure ----------------------------------------------------------------------
test("parse: a valid config comes back equal, as a deep copy", () => {
  const raw = validConfig();
  const cfg = parseRouteFieldsConfig(raw);
  assert.deepEqual(cfg, raw);
  assert.notEqual(cfg, raw);
  assert.notEqual(cfg.steps.s_elec0001, raw.steps.s_elec0001);
  assert.notEqual(cfg.steps.s_open0001.layout, raw.steps.s_open0001.layout);
  // Mutating the input afterwards cannot reach the parsed copy.
  (raw.steps.s_elec0001.groups[0].fields[1] as any).label = "שונה";
  raw.steps.s_open0001.layout.nested.a.push(2);
  assert.equal(cfg.steps.s_elec0001.groups[0].fields[1].label, "נורית מתח");
  assert.deepEqual(cfg.steps.s_open0001.layout, { fields_placement: "in_step", nested: { a: [1, "x", null, true] } });
});

test("parse: the sanitizer keeps known keys only, at every level", () => {
  const cfg = parseEdited((c) => {
    c.extra = 1;
    (c.steps.s_elec0001 as any).color = "red";
    (c.steps.s_elec0001.groups[0] as any).collapsed = true;
    elecFields(c)[1].evil = "<script>";
    elecFields(c)[1].options = LED.map((o) => ({ ...o, weight: 3 }));
    elecFields(c)[1].list_ref = { id: 4, ver: 2, name: "מצב נורית" };
    elecFields(c)[0].required = true;   // a section has no "required"
    (c.steps.s_open0001.groups[2].fields[0] as any).items[0].done = true;
  });
  assert.deepEqual(Object.keys(cfg), ["schema", "steps"]);
  assert.deepEqual(Object.keys(cfg.steps.s_elec0001), ["uid", "station_type_id", "station_label", "scope", "groups"]);
  assert.deepEqual(Object.keys(cfg.steps.s_elec0001.groups[0]), ["target", "fields"]);
  assert.deepEqual(cfg.steps.s_elec0001.groups[0].fields[0], { id: "f_sec00001", type: "section", label: "הפעלה" });
  const led = cfg.steps.s_elec0001.groups[0].fields[1];
  assert.deepEqual(Object.keys(led), ["id", "type", "label", "required", "notes", "options", "list_ref"]);
  assert.deepEqual(led.type === "choice_row" ? led.options : null, LED);
  assert.deepEqual(led.type === "choice_row" ? led.list_ref : null, { id: 4, ver: 2 });
  const chk = cfg.steps.s_open0001.groups[2].fields[0];
  assert.deepEqual(chk.type === "checklist" ? chk.items[0] : null, { id: "c_stand001", label: "מעמד" });
});

test("parse: __proto__ / constructor keys are dropped and never reach a prototype", () => {
  const raw = JSON.parse(JSON.stringify(validConfig()));
  // JSON.parse makes "__proto__" an OWN key — the shape a hostile request body really has.
  raw.steps.s_elec0001.groups[0].fields[1] = JSON.parse(
    `{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"polluted": "yes"}}, ${JSON.stringify(raw.steps.s_elec0001.groups[0].fields[1]).slice(1)}`,
  );
  raw.steps.s_open0001.layout = JSON.parse('{"__proto__": {"polluted": "yes"}, "keep": {"constructor": 1, "prototype": 2, "ok": 3}}');
  const cfg = parseRouteFieldsConfig(raw);
  const led = cfg.steps.s_elec0001.groups[0].fields[1] as unknown as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(led, "__proto__"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(led, "constructor"), false);
  assert.equal(Object.getPrototypeOf(led), Object.prototype);
  assert.equal(led.polluted, undefined);
  assert.deepEqual(cfg.steps.s_open0001.layout, { keep: { ok: 3 } });
  assert.equal(Object.getPrototypeOf(cfg.steps.s_open0001.layout), Object.prototype);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  // A "__proto__" step key is not a uid.
  assertShape(() => parseRouteFieldsConfig(JSON.parse('{"schema":1,"steps":{"__proto__":{"uid":"__proto__"}}}')), "__proto__", "bad step uid");
});

test("parse: an inherited (polluted) property is never read as a field key", () => {
  const raw = validConfig();
  delete (elecFields(raw)[2] as any).out_of_range_fail;
  Object.defineProperty(Object.prototype, "out_of_range_fail", { value: true, configurable: true, writable: true });
  try {
    assertShape(() => parseRouteFieldsConfig(raw), "$.steps.s_elec0001.groups[0].fields[2]", "out_of_range_fail");
  } finally {
    delete (Object.prototype as any).out_of_range_fail;
  }
});

test("parse: null on an optional key means not set", () => {
  const cfg = parseEdited((c) => {
    elecFields(c)[1].list_ref = null;
    elecFields(c)[2].help = null;
    elecFields(c)[2].min = null;
    (c.steps.s_open0001 as any).layout = null;
  });
  assert.equal("list_ref" in cfg.steps.s_elec0001.groups[0].fields[1], false);
  assert.equal("help" in cfg.steps.s_elec0001.groups[0].fields[2], false);
  assert.equal("min" in cfg.steps.s_elec0001.groups[0].fields[2], false);
  assert.equal("layout" in cfg.steps.s_open0001, false);
});

test("parse: a bad step uid, box at a per-item step and note_max outside 500/1000/2000 are rejected", () => {
  assertShape(() => parseRouteFieldsConfig({ schema: 1, steps: { s_BAD: { uid: "s_BAD" } } }), "s_BAD", "bad step uid");
  assertShape(() => parseRouteFieldsConfig({ schema: 1, steps: { s_abc: { uid: "s_abc" } } }), "s_abc", "bad step uid");
  assertShape(() => parseEdited((c) => { c.steps.s_elec0001.groups[0].target = "box"; }), "groups[0].target", "per-item step accepts target 'item' only");
  assertShape(() => parseEdited((c) => { elecFields(c)[3].note_max = 750; }), "fields[3]", "note_max");
  assertShape(() => parseEdited((c) => { elecFields(c)[3].note_max = "1000"; }), "fields[3]", "note_max");
});

test("parse: structural rejections name the path", () => {
  assertShape(() => parseRouteFieldsConfig(null), "$", "expected {schema:1, steps:{}}");
  assertShape(() => parseRouteFieldsConfig({ schema: 2, steps: {} }), "$");
  assertShape(() => parseRouteFieldsConfig({ schema: 1, steps: [] }), "$");
  assertShape(() => parseEdited((c) => { (c.steps.s_elec0001 as any).uid = "s_open0001"; }), "s_elec0001", "uid mismatch");
  assertShape(() => parseEdited((c) => { (c.steps.s_elec0001 as any).station_type_id = 2.5; }), "s_elec0001", "station");
  assertShape(() => parseEdited((c) => { (c.steps.s_elec0001 as any).station_label = "א".repeat(51); }), "s_elec0001", "station");
  assertShape(() => parseEdited((c) => { (c.steps.s_elec0001 as any).scope = "kit"; }), "s_elec0001", "scope");
  assertShape(() => parseEdited((c) => { (c.steps.s_elec0001 as any).groups = {}; }), "s_elec0001", "groups");
  assertShape(() => parseEdited((c) => { (c.steps.s_open0001 as any).layout = [1, 2]; }), "s_open0001", "layout");
  assertShape(() => parseEdited((c) => { c.steps.s_open0001.groups[0].target = "item"; }), "groups[0].target", "package step target");
  assertShape(() => parseEdited((c) => { (c.steps.s_open0001.groups[2] as any).target = { item_type_id: "14" }; }), "groups[2].target", "package step target");
  assertShape(() => parseEdited((c) => { elecFields(c)[1].type = "slider"; }), "fields[1]", 'unknown type "slider"');
  assertShape(() => parseEdited((c) => { elecFields(c)[1].id = "f_LED"; }), "fields[1]", "field id");
  assertShape(() => parseEdited((c) => { elecFields(c)[1].label = "א".repeat(81); }), "fields[1]", "label");
  assertShape(() => parseEdited((c) => { elecFields(c)[2].help = "א".repeat(201); }), "fields[2]", "help");
  assertShape(() => parseEdited((c) => { elecFields(c)[1].required = "yes"; }), "fields[1]", "required");
  assertShape(() => parseEdited((c) => { elecFields(c)[1].notes = "sometimes"; }), "fields[1]", "notes");
  assertShape(() => parseEdited((c) => { elecFields(c)[1].list_ref = { id: 4, ver: 0 }; }), "list_ref", "ref");
  assertShape(() => parseEdited((c) => { elecFields(c)[1].from_set = { id: "7", ver: 1 }; }), "from_set", "ref");
});

test("parse: one group per target in a step", () => {
  assertShape(() => parseEdited((c) => { c.steps.s_elec0001.groups.push({ target: "item", fields: [] }); }), "groups[1].target", "duplicate target item");
  assertShape(() => parseEdited((c) => { (c.steps.s_open0001.groups as any[]).push({ target: "box", fields: [] }); }), "groups[3].target", "duplicate target box");
  assertShape(() => parseEdited((c) => { (c.steps.s_open0001.groups as any[]).push({ target: "each_item", fields: [] }); }), "groups[3].target", "duplicate target each_item");
  assertShape(() => parseEdited((c) => { (c.steps.s_open0001.groups as any[]).push({ target: { item_type_id: 14 }, fields: [] }); }), "groups[3].target", "duplicate target type:14");
  // Different item types are different targets.
  const cfg = parseEdited((c) => { (c.steps.s_open0001.groups as any[]).push({ target: { item_type_id: 15 }, fields: [] }); });
  assert.deepEqual(cfg.steps.s_open0001.groups.map((g) => targetKey(g.target)), ["box", "each_item", "type:14", "type:15"]);
});

test("parse: field ids are unique per step, across its groups", () => {
  assertShape(() => parseEdited((c) => { (c.steps.s_open0001.groups[1].fields[0] as any).id = "f_box00001"; }), "groups[1].fields[0]", "field id (unique per step)");
  // The same id in another step is fine.
  const cfg = parseEdited((c) => { (c.steps.s_open0001.groups[1].fields[0] as any).id = "f_led00001"; });
  assert.equal(cfg.steps.s_open0001.groups[1].fields[0].id, "f_led00001");
});

test("parse: options — 0..12, o_ ids unique per field, known tones, label ≤ 60", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => opt(`o_opt${String(i).padStart(5, "0")}`, `אפשרות ${i}`, "neutral"));
  assert.equal(parseEdited((c) => { elecFields(c)[1].options = twelve; }).steps.s_elec0001.groups[0].fields.length, 4);
  assert.equal(parseEdited((c) => { elecFields(c)[1].options = []; }).steps.s_elec0001.groups[0].fields.length, 4);
  assertShape(() => parseEdited((c) => { elecFields(c)[1].options = [...twelve, opt("o_opt99999", "x", "pass")]; }), "options", "0..12 options");
  assertShape(() => parseEdited((c) => { elecFields(c)[1].options = [LED[0], LED[0]]; }), "options[1]", "option id");
  assertShape(() => parseEdited((c) => { elecFields(c)[1].options = [{ ...LED[0], tone: "ok" }]; }), "options[0]", "option");
  assertShape(() => parseEdited((c) => { elecFields(c)[1].options = [{ ...LED[0], label: "א".repeat(61) }]; }), "options[0]", "option");
  assertShape(() => parseEdited((c) => { elecFields(c)[1].options = undefined; }), "options", "0..12 options");
});

test("parse: number — finite numbers, unit ≤ 12, tol_pct only with ref", () => {
  assertShape(() => parseEdited((c) => { elecFields(c)[2].max = Infinity; }), "fields[2]", "max");
  assertShape(() => parseEdited((c) => { elecFields(c)[2].min = Number.NaN; }), "fields[2]", "min");
  assertShape(() => parseEdited((c) => { elecFields(c)[2].ref = "230"; }), "fields[2]", "ref");
  assertShape(() => parseEdited((c) => { elecFields(c)[2].tol_pct = 5; }), "fields[2]", "tol_pct needs ref");
  assertShape(() => parseEdited((c) => { elecFields(c)[2].unit = "x".repeat(13); }), "fields[2]", "unit");
  assertShape(() => parseEdited((c) => { delete elecFields(c)[2].out_of_range_fail; }), "fields[2]", "out_of_range_fail");
  const cfg = parseEdited((c) => { Object.assign(elecFields(c)[2], { unit: "x".repeat(12), min: -1, ref: 0.05, tol_pct: 10 }); });
  assert.deepEqual(cfg.steps.s_elec0001.groups[0].fields[2], {
    id: "f_gnd00001", type: "number", label: "התנגדות הארקה", help: "מדוד בין פין ההארקה לגוף המארז", required: true, notes: "optional",
    unit: "xxxxxxxxxxxx", min: -1, max: 0.1, ref: 0.05, tol_pct: 10, out_of_range_fail: true,
  });
});

test("parse: checklist — ≤ 20 items, unique c_ ids, label ≤ 80", () => {
  const items = (c: any): any => c.steps.s_open0001.groups[2].fields[0];
  assertShape(() => parseEdited((c) => { items(c).items = [{ id: "c_stand001", label: "א" }, { id: "c_stand001", label: "ב" }]; }), "items[1]", "item id");
  assertShape(() => parseEdited((c) => { items(c).items = [{ id: "x_stand001", label: "א" }]; }), "items[0]", "item id");
  assertShape(() => parseEdited((c) => { items(c).items = [{ id: "c_stand001", label: "א".repeat(81) }]; }), "items[0]", "item label");
  assertShape(() => parseEdited((c) => { items(c).items = Array.from({ length: 21 }, (_, i) => ({ id: `c_item${String(i).padStart(4, "0")}`, label: "א" })); }), "items", "items");
  assertShape(() => parseEdited((c) => { items(c).items = "מעמד"; }), "items", "items");
});

test("parse: photo — a type code ≤ 50 and an integer minimum 0..20", () => {
  const photo = (c: any): any => c.steps.s_open0001.groups[2].fields[1];
  assertShape(() => parseEdited((c) => { photo(c).min = 21; }), "fields[1]", "photo");
  assertShape(() => parseEdited((c) => { photo(c).min = -1; }), "fields[1]", "photo");
  assertShape(() => parseEdited((c) => { photo(c).min = 1.5; }), "fields[1]", "photo");
  assertShape(() => parseEdited((c) => { photo(c).photo_type = "x".repeat(51); }), "fields[1]", "photo");
  assert.equal(parseEdited((c) => { photo(c).min = 20; }).steps.s_open0001.groups[2].fields.length, 5);
});

test("parse: size limits — 60 fields per group, 512000 characters of JSON", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `f_many${String(i).padStart(4, "0")}`, type: "section", label: "מקטע" }));
  assert.equal(parseEdited((c) => { c.steps.s_elec0001.groups[0].fields = many(60) as any; }).steps.s_elec0001.groups[0].fields.length, 60);
  assertShape(() => parseEdited((c) => { c.steps.s_elec0001.groups[0].fields = many(61) as any; }), "groups[0]", "too many fields");
  assertShape(() => parseEdited((c) => { (c.steps.s_open0001 as any).layout = { blob: "x".repeat(LIMITS.configJson) }; }), "$", "config too large");
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assertShape(() => parseEdited((c) => { (c.steps.s_open0001 as any).layout = cyclic; }), "$", "not JSON");
});

test("parseFieldList / parseOptionList reuse the same checks", () => {
  const fields = validConfig().steps.s_elec0001.groups[0].fields;
  assert.deepEqual(parseFieldList(fields), fields);
  assert.deepEqual(parseFieldList([{ ...fields[1], extra: 1 }]), [fields[1]]);
  assertShape(() => parseFieldList([fields[1], fields[1]], "$.fields"), "$.fields[1]", "field id (unique per step)");
  assertShape(() => parseFieldList({}, "$.fields"), "$.fields", "expected an array of fields");
  assertShape(() => parseFieldList(Array.from({ length: 61 }, (_, i) => ({ id: `f_many${String(i).padStart(4, "0")}`, type: "section", label: "מ" }))), "$", "too many fields");
  assert.deepEqual(parseOptionList(LED), LED);
  assert.deepEqual(parseOptionList([{ ...LED[0], extra: true }]), [LED[0]]);
  assertShape(() => parseOptionList([LED[0], LED[0]], "$.options"), "$.options[1]", "option id");
  assertShape(() => parseOptionList(Array.from({ length: 13 }, (_, i) => opt(`o_opt${String(i).padStart(5, "0")}`, "x", "pass"))), "$", "0..12 options");
});

// ---- content ----------------------------------------------------------------------------
const choice = (id: string, label: string, options: ChoiceOption[], extra: Partial<Field> = {}): Field =>
  ({ id, type: "choice_row", label, required: false, notes: "optional", options, ...extra }) as Field;
const config = (fields: Field[]): RouteFieldsConfig => ({
  schema: 1,
  steps: { s_elec0001: { uid: "s_elec0001", station_type_id: 22, station_label: "חשמל", scope: "item", groups: [{ target: "item", fields }] } },
});
const codes = (issues: Issue[]) => issues.map((i) => i.code);

test("lint: a clean config has no issues", () => {
  assert.deepEqual(lintRouteFieldsConfig(parseRouteFieldsConfig(validConfig())), []);
});

test("lint: an empty field name — 'יש להזין שם לשדה', located", () => {
  const issues = lintRouteFieldsConfig(config([choice("f_led00001", "   ", LED)]));
  assert.deepEqual(issues, [{
    level: "error", code: "FIELD_LABEL_EMPTY", step_uid: "s_elec0001", target: "item", field_id: "f_led00001",
    message: "יש להזין שם לשדה",
  }]);
  // A section header is no field: artboard 2 neither counts it in "בעיה אחת לתיקון" nor shows
  // "יש להזין שם לשדה" under it (`isField = r.kind !== 'section'`), so an empty one blocks nothing.
  assert.deepEqual(lintRouteFieldsConfig(config([{ id: "f_sec00001", type: "section", label: "" }])), []);
  assert.deepEqual(lintFields([{ id: "f_sec00001", type: "section", label: "   " }]), []);
});

test("lint: an empty option — 'אפשרות ריקה — מלאו או הסירו', one issue per option", () => {
  const options = [opt("o_a0000001", "תקין", "pass"), opt("o_b0000001", " ", "warn"), opt("o_c0000001", "", "fail")];
  const issues = lintRouteFieldsConfig(config([choice("f_led00001", "נורית מתח", options)]));
  assert.deepEqual(issues, [
    { level: "error", code: "OPTION_LABEL_EMPTY", step_uid: "s_elec0001", target: "item", field_id: "f_led00001", option_id: "o_b0000001", message: "אפשרות ריקה — מלאו או הסירו" },
    { level: "error", code: "OPTION_LABEL_EMPTY", step_uid: "s_elec0001", target: "item", field_id: "f_led00001", option_id: "o_c0000001", message: "אפשרות ריקה — מלאו או הסירו" },
  ]);
});

test("lint: the option-count checks, in artboard 4's order and with its words", () => {
  const seven = Array.from({ length: 7 }, (_, i) => opt(`o_seven00${i}`, `א${i}`, "pass"));
  const issues = lintRouteFieldsConfig(config([
    choice("f_many0001", "רבות", seven),                                                  // > 6 outranks "no fail"
    choice("f_one00001", "אחת", [opt("o_one00001", "תקין", "pass")]),                      // < 2 outranks "no fail"
    choice("f_nofail01", "בלי כשל", [opt("o_nf000001", "תקין", "pass"), opt("o_nf000002", "אזהרה", "warn")]),
    choice("f_good0001", "תקין", LED),
    { id: "f_mul00001", type: "multi_choice", label: "בחירה", required: false, notes: "off", options: [] },
  ]));
  assert.deepEqual(issues.map((i) => [i.level, i.code, i.field_id, i.message]), [
    ["warning", "OPTIONS_TOO_MANY", "f_many0001", "יותר מ-6 אפשרויות — קשה לבחירה מהירה"],
    ["warning", "OPTIONS_TOO_FEW", "f_one00001", "נדרשות לפחות 2 אפשרויות"],
    ["warning", "OPTIONS_NO_FAIL", "f_nofail01", "אף אפשרות לא נחשבת 'כשל'"],
    ["error", "OPTIONS_EMPTY", "f_mul00001", UNDRAWN_TEXT.optionsEmpty],
  ]);
});

test("lint: the same name twice in one cell is a warning on the second; sections and other cells don't count", () => {
  const issues = lintRouteFieldsConfig(config([
    choice("f_led00001", "נורית מתח", LED),
    { id: "f_sec00001", type: "section", label: "נורית מתח" },
    { id: "f_sec00002", type: "section", label: "נורית מתח" },
    choice("f_led00002", " נורית מתח ", LED),
    choice("f_emp00001", "", LED),
    choice("f_emp00002", "", LED),
  ]));
  assert.deepEqual(issues.filter((i) => i.code === "DUPLICATE_LABEL_IN_CELL"), [{
    level: "warning", code: "DUPLICATE_LABEL_IN_CELL", step_uid: "s_elec0001", target: "item", field_id: "f_led00002",
    message: UNDRAWN_TEXT.duplicateLabel,
  }]);
  const twoCells: RouteFieldsConfig = {
    schema: 1,
    steps: { s_open0001: { uid: "s_open0001", station_type_id: 21, station_label: "פתיחת מארז", scope: "package", groups: [
      { target: "box", fields: [choice("f_ext00001", "מצב חיצוני", EXT)] },
      { target: "each_item", fields: [choice("f_ext00002", "מצב חיצוני", EXT)] },
    ] } },
  };
  assert.deepEqual(lintRouteFieldsConfig(twoCells), []);
});

test("lint: an item-type group repeating an each_item name is a duplicate — the worker sees both on one card", () => {
  const pkgStep = (groups: RouteFieldsConfig["steps"][string]["groups"]): RouteFieldsConfig => ({
    schema: 1,
    steps: { s_open0001: { uid: "s_open0001", station_type_id: 21, station_label: "פתיחת מארז", scope: "package", groups } },
  });
  // Artboard 9's rule (spec §5.10): a name already in the each_item group of the same step.
  const issues = lintRouteFieldsConfig(pkgStep([
    { target: { item_type_id: 14 }, fields: [choice("f_ext00002", " מצב חיצוני ", EXT), choice("f_stand001", "מעמד", EXT)] },
    { target: "each_item", fields: [choice("f_ext00001", "מצב חיצוני", EXT), { id: "f_sec00001", type: "section", label: "מעמד" }] },
    { target: { item_type_id: 15 }, fields: [choice("f_ext00003", "מצב חיצוני", EXT)] },
    { target: "box", fields: [choice("f_ext00004", "מצב חיצוני", EXT)] },
  ]));
  assert.deepEqual(issues, [
    { level: "warning", code: "DUPLICATE_LABEL_IN_CELL", step_uid: "s_open0001", target: { item_type_id: 14 }, field_id: "f_ext00002", message: UNDRAWN_TEXT.duplicateLabel },
    { level: "warning", code: "DUPLICATE_LABEL_IN_CELL", step_uid: "s_open0001", target: { item_type_id: 15 }, field_id: "f_ext00003", message: UNDRAWN_TEXT.duplicateLabel },
  ]);
  // Two item types never share a card, nor does the box with the items.
  assert.deepEqual(lintRouteFieldsConfig(pkgStep([
    { target: { item_type_id: 14 }, fields: [choice("f_ext00002", "מצב חיצוני", EXT)] },
    { target: { item_type_id: 15 }, fields: [choice("f_ext00003", "מצב חיצוני", EXT)] },
    { target: "box", fields: [choice("f_ext00004", "מצב חיצוני", EXT)] },
  ])), []);
  // The same rule on a bare list, and the names it compares against.
  assert.deepEqual(codes(lintFields([choice("f_ext00002", "מצב חיצוני", EXT)], {}, [choice("f_ext00001", "מצב חיצוני ", EXT)])), ["DUPLICATE_LABEL_IN_CELL"]);
  assert.deepEqual(
    [...takenLabels([choice("f_a0000001", " מעמד ", EXT), choice("f_a0000002", "  ", EXT), { id: "f_sec00001", type: "section", label: "כותרת" }])],
    ["מעמד"],
  );
});

test("lint: a checklist with no items or an unnamed item, and a photo field without a photo type, block publish", () => {
  const checklist = (id: string, items: { id: string; label: string }[]): Field =>
    ({ id, type: "checklist", label: `רשימה ${id}`, required: true, notes: "off", items }) as Field;
  const photo = (id: string, photo_type: string): Field =>
    ({ id, type: "photo", label: `צילום ${id}`, required: false, notes: "off", photo_type, min: 1 }) as Field;
  const issues = lintRouteFieldsConfig(config([
    checklist("f_chk00001", []),
    checklist("f_chk00002", [{ id: "c_stand001", label: "מעמד" }, { id: "c_blank001", label: "  " }, { id: "c_blank002", label: "" }]),
    checklist("f_chk00003", [{ id: "c_stand001", label: "מעמד" }]),
    photo("f_pho00001", ""),
    photo("f_pho00002", "   "),
    photo("f_pho00003", "front"),
  ]));
  assert.deepEqual(issues.map((i) => [i.level, i.code, i.field_id, i.item_id, i.message]), [
    ["error", "CHECKLIST_EMPTY", "f_chk00001", undefined, UNDRAWN_TEXT.checklistEmpty],
    ["error", "CHECKLIST_ITEM_LABEL_EMPTY", "f_chk00002", "c_blank001", UNDRAWN_TEXT.checklistItemLabelEmpty],
    ["error", "CHECKLIST_ITEM_LABEL_EMPTY", "f_chk00002", "c_blank002", UNDRAWN_TEXT.checklistItemLabelEmpty],
    ["error", "PHOTO_TYPE_EMPTY", "f_pho00001", undefined, UNDRAWN_TEXT.photoTypeEmpty],
    ["error", "PHOTO_TYPE_EMPTY", "f_pho00002", undefined, UNDRAWN_TEXT.photoTypeEmpty],
  ]);
  // The shape check still takes them, as draft states.
  const draft = parseRouteFieldsConfig({ schema: 1, steps: { s_elec0001: { ...config([]).steps.s_elec0001, groups: [{ target: "item", fields: [checklist("f_chk00001", []), photo("f_pho00001", "")] }] } } });
  assert.equal(draft.steps.s_elec0001.groups[0].fields.length, 2);
});

test("lint: NUMBER_RANGE — minimum above maximum, or a negative tolerance", () => {
  const num = (id: string, extra: object): Field =>
    ({ id, type: "number", label: `מספר ${id}`, required: false, notes: "off", out_of_range_fail: true, ...extra }) as Field;
  const issues = lintRouteFieldsConfig(config([
    num("f_num00001", { min: 5, max: 1 }),
    num("f_num00002", { min: 1, max: 1 }),
    num("f_num00003", { ref: 230, tol_pct: -5 }),
    num("f_num00004", { ref: 230, tol_pct: 0 }),
  ]));
  assert.deepEqual(issues.map((i) => [i.code, i.level, i.field_id, i.message]), [
    ["NUMBER_RANGE", "error", "f_num00001", UNDRAWN_TEXT.numberRange],
    ["NUMBER_RANGE", "error", "f_num00003", UNDRAWN_TEXT.numberRange],
  ]);
});

test("lint: every issue of a package step carries its target; lintFields works on a bare list", () => {
  const cfg: RouteFieldsConfig = {
    schema: 1,
    steps: { s_open0001: { uid: "s_open0001", station_type_id: 21, station_label: "פתיחת מארז", scope: "package", groups: [
      { target: { item_type_id: 14 }, fields: [choice("f_stand001", "", EXT)] },
    ] } },
  };
  assert.deepEqual(lintRouteFieldsConfig(cfg)[0], {
    level: "error", code: "FIELD_LABEL_EMPTY", step_uid: "s_open0001", target: { item_type_id: 14 }, field_id: "f_stand001", message: LINT_TEXT.fieldLabelEmpty,
  });
  // A field set has no step and no target.
  assert.deepEqual(lintFields([choice("f_stand001", "", EXT)]), [
    { level: "error", code: "FIELD_LABEL_EMPTY", field_id: "f_stand001", message: "יש להזין שם לשדה" },
  ]);
});

test("optionListLine: artboard 4's validation line, first match wins", () => {
  const seven = Array.from({ length: 7 }, (_, i) => opt(`o_seven00${i}`, `א${i}`, "pass"));
  assert.deepEqual(optionListLine([...seven, opt("o_empty001", " ", "fail")]), { level: "error", text: "אפשרות ריקה — מלאו או הסירו" });
  assert.deepEqual(optionListLine(seven), { level: "warning", text: "יותר מ-6 אפשרויות — קשה לבחירה מהירה" });
  assert.deepEqual(optionListLine([LED[2]]), { level: "warning", text: "נדרשות לפחות 2 אפשרויות" });
  assert.deepEqual(optionListLine([]), { level: "warning", text: "נדרשות לפחות 2 אפשרויות" });
  assert.deepEqual(optionListLine([LED[0], LED[1]]), { level: "warning", text: "אף אפשרות לא נחשבת 'כשל'" });
  assert.deepEqual(optionListLine(LED), { level: "ok", text: "4 אפשרויות · אחת נחשבת 'כשל'" });
  assert.deepEqual(optionListLine([...LED, opt("o_led00005", "שבורה", "fail")]), { level: "ok", text: "5 אפשרויות · 2 נחשבות 'כשל'" });
});

test("artboard strings are exact", () => {
  assert.equal(LINT_TEXT.fieldLabelEmpty, "יש להזין שם לשדה");
  assert.equal(LINT_TEXT.optionLabelEmpty, "אפשרות ריקה — מלאו או הסירו");
  assert.equal(LINT_TEXT.optionsTooMany, "יותר מ-6 אפשרויות — קשה לבחירה מהירה");
  assert.equal(LINT_TEXT.optionsTooFew, "נדרשות לפחות 2 אפשרויות");
  assert.equal(LINT_TEXT.optionsNoFail, "אף אפשרות לא נחשבת 'כשל'");
  assert.equal(optionsOkText(4, 1), "4 אפשרויות · אחת נחשבת 'כשל'");
  assert.equal(optionsOkText(6, 3), "6 אפשרויות · 3 נחשבות 'כשל'");
  assert.equal(optionEmptyMapText("מכניקה", "מסך", "ברגי VESA"), "מכניקה · מסך: אפשרות ריקה בשדה 'ברגי VESA'");
  assert.equal(duplicateSkipText("הפריט ארוז במקומו", "כל פריט במארז"), "שדה 'הפריט ארוז במקומו' כבר קיים ב'כל פריט במארז' — יידלג כדי למנוע כפילות");
  assert.deepEqual(TONE_WORD, { pass: "תקין", warn: "אזהרה", fail: "כשל", neutral: "ניטרלי" });
  assert.deepEqual(Object.entries(NOTES_MODE_LABEL), [["optional", "אופציונלי"], ["required_on_fail", "חובה בכשל"], ["required", "חובה"], ["off", "ללא"]]);
  assert.deepEqual([...FIELD_TYPES], ["choice_row", "pass_fail", "number", "text", "textarea", "checklist", "multi_choice", "photo", "scan", "section"]);
  // The undrawn text exists and is non-empty (UNDRAWN_TEXT in labels.ts).
  assert.deepEqual(Object.keys(UNDRAWN_TEXT).sort(), [
    "checklistEmpty", "checklistItemLabelEmpty", "duplicateLabel", "noteTooLong", "numberRange", "optionsEmpty",
    "photoTypeEmpty", "schemaMismatch", "stepScopeMismatch", "stepUnknown",
  ]);
  for (const text of Object.values(UNDRAWN_TEXT)) assert.ok(text.trim().length > 0);
});

// ---- against the live route -----------------------------------------------------------------
test("checkConfigAgainstRoute: unknown uids, scope against package_level, misaligned arrays", () => {
  const cfg = parseRouteFieldsConfig(validConfig());
  const packageLevel = new Set([21, 26]);
  assert.deepEqual(checkConfigAgainstRoute(cfg, [21, 22, 26], ["s_open0001", "s_elec0001", "s_clos0001"], packageLevel), { unknownUids: [], issues: [] });
  assert.deepEqual(checkConfigAgainstRoute(cfg, [21, 26], ["s_open0001", "s_clos0001"], packageLevel), { unknownUids: ["s_elec0001"], issues: [] });
  // Station type 22 became package-level under a per-item config.
  assert.deepEqual(checkConfigAgainstRoute(cfg, [21, 22, 26], ["s_open0001", "s_elec0001", "s_clos0001"], new Set([21, 22, 26])), {
    unknownUids: [],
    issues: [{ level: "error", code: "STEP_SCOPE_MISMATCH", step_uid: "s_elec0001", message: UNDRAWN_TEXT.stepScopeMismatch }],
  });
  // Without one uid per step there are no positions at all.
  assert.deepEqual(checkConfigAgainstRoute(cfg, [21, 22, 26], ["s_open0001", "s_elec0001"], packageLevel), { unknownUids: ["s_elec0001", "s_open0001"], issues: [] });
});

test("unknownStepIssues: one publish-blocking STEP_UNKNOWN error per unknown uid, in order", () => {
  assert.deepEqual(unknownStepIssues([]), []);
  assert.deepEqual(unknownStepIssues(["s_elec0001", "s_open0001"]), [
    { level: "error", code: "STEP_UNKNOWN", step_uid: "s_elec0001", message: UNDRAWN_TEXT.stepUnknown },
    { level: "error", code: "STEP_UNKNOWN", step_uid: "s_open0001", message: UNDRAWN_TEXT.stepUnknown },
  ]);
});
