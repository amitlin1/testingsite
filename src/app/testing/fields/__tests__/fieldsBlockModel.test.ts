import { test } from "node:test";
import assert from "node:assert/strict";
import { statusA, statusB, statusC } from "@/app/lib/station-fields/labels";
import type {
  ChecklistField, ChoiceOption, ChoiceRowField, Field, InputField, KitItemFields, NumberField, PassFailField,
  PhotoField, SectionField, Tone,
} from "@/app/lib/station-fields/schema";
import {
  BLOCK_COPY_PENDING, BLOCK_TITLE, CHOICE_HINT, CHOICE_PROMPT, NOTE_TEXT, TEXT_VALUE_MAX, VARIANT_SPEC,
  addShot, blockItems, blockStatus, draftsFieldsState, fieldCountText, fieldRowIds, groupFields,
  hasLabelledControl, isItemChecked, kitItemFieldGroups, noteEditorTitle, noteLabelText, notePlaceholder,
  removeShot, rowState, settleShot, stationBlockTitle, statusRuns, toggleChecklistItem,
  type FieldRowVariant, type FieldsBlockGroup,
} from "../fieldsBlockModel";
import { evaluateDrafts, patchDraft, type Drafts, type FieldDraft } from "../useFieldsState";

// ---- fixtures (artboard 14's fields, artboard 16's kit item) -----------------------------------------
const opt = (id: string, label: string, tone: Tone): ChoiceOption => ({ id, label, tone });
const LED = [opt("o_led00001", "תקין", "pass"), opt("o_led00002", "מהבהבת", "warn"), opt("o_led00003", "לא דולקת", "fail"), opt("o_led00004", "לא נבדק", "neutral")];
const FAN = [opt("o_fan00001", "מסתובב תקין", "pass"), opt("o_fan00002", "רעש חריג", "warn"), opt("o_fan00003", "לא מסתובב", "fail"), opt("o_fan00004", "לא נבדק", "neutral")];

const led: ChoiceRowField = { id: "f_led00001", type: "choice_row", label: "נורית מתח", required: true, notes: "required_on_fail", options: LED };
const fan: ChoiceRowField = { id: "f_fan00001", type: "choice_row", label: "מאוורר ספק הכוח", required: false, notes: "optional", options: FAN };
const quiet: ChoiceRowField = { id: "f_qui00001", type: "choice_row", label: "מאוורר", required: false, notes: "off", options: FAN };
const section: SectionField = { id: "f_sec00001", type: "section", label: "בטיחות חשמלית" };
const gnd: NumberField = { id: "f_gnd00001", type: "number", label: "התנגדות הארקה", required: true, notes: "optional", unit: "Ω", max: 0.1, out_of_range_fail: true };
const iso: PassFailField = { id: "f_iso00001", type: "pass_fail", label: "בדיקת בידוד", required: true, notes: "required_on_fail" };
const list: ChecklistField = { id: "f_chk00001", type: "checklist", label: "תקינות", required: false, notes: "off", items: [{ id: "c_item0001", label: "א" }, { id: "c_item0002", label: "ב" }] };
const shot: PhotoField = { id: "f_pht00001", type: "photo", label: "צילום", required: false, notes: "off", photo_type: "product", min: 0 };
const DEFS: Field[] = [led, fan, section, gnd, iso];

const ALL_VARIANTS: FieldRowVariant[] = ["station", "photo", "dialog", "wizard", "kit-item", "pack-item", "pack"];

/** A string as it shows: without the invisible isolates (U+2066 … U+2069). */
const visible = (s: string): string => s.replace(/[⁦-⁩]/g, "");

test("each popup keeps its own artboard's list wording, status and note (spec §4.4)", () => {
  const typing = (v: FieldRowVariant) => [VARIANT_SPEC[v].typeToFilter, visible(VARIANT_SPEC[v].placeholderOpen), VARIANT_SPEC[v].footerHint];
  assert.deepEqual(typing("station"), [true, "הקלד לסינון או 1–4…", "1–4 בחירה מהירה"]);
  assert.deepEqual(typing("photo"), [true, "הקלד לסינון…", "1–4 · Enter בחירה"]);
  assert.deepEqual(typing("dialog"), [true, "הקלד לסינון…", "1–4 · Enter בחירה"]);
  assert.deepEqual(typing("wizard"), typing("station"));
  assert.deepEqual(typing("kit-item"), typing("station"));
  assert.deepEqual(typing("pack-item"), [false, "", "1–4 בחירה"]);
  assert.deepEqual(typing("pack"), typing("pack-item"));

  assert.deepEqual(ALL_VARIANTS.map((v) => VARIANT_SPEC[v].status), ["A", "B", "C", "A", "A", null, null]);
  assert.deepEqual(ALL_VARIANTS.map((v) => VARIANT_SPEC[v].note), ["row", "row", "row", "row", "row", "row-compact", "row-compact"]);
  assert.deepEqual(ALL_VARIANTS.filter((v) => VARIANT_SPEC[v].noteLabel === "legend"), ["dialog"]);
});

test("the artboards' characters: en dash, ellipsis and middle dot, never their ASCII look-alikes", () => {
  for (const s of [CHOICE_PROMPT.filterOrKeys, CHOICE_HINT.quick, CHOICE_HINT.enter, CHOICE_HINT.pick]) assert.ok(s.includes("1–4"), s);
  assert.ok(CHOICE_PROMPT.filterOrKeys.endsWith("…") && CHOICE_PROMPT.filter.endsWith("…"));
  // The placeholder can't carry markup: "1–4" sits between a left-to-right isolate and its pop
  // (U+2066 … U+2069), so the RTL input never draws it "4–1" (spec §8.11). Nothing else is isolated.
  assert.equal(CHOICE_PROMPT.filterOrKeys, "הקלד לסינון או ⁦1–4⁩…");
  assert.equal(visible(CHOICE_PROMPT.filterOrKeys), "הקלד לסינון או 1–4…");
  assert.equal(visible(CHOICE_PROMPT.filter), CHOICE_PROMPT.filter);
  assert.ok(NOTE_TEXT.required.endsWith("…"));
  assert.ok(CHOICE_HINT.enter.includes(" · "));
  assert.equal(noteEditorTitle("נורית מתח"), "הערה · נורית מתח");
  assert.equal(noteLabelText("נורית מתח"), "הערה לנורית מתח");
});

test("the note's placeholder: required, failing (12–16 only), or optional", () => {
  for (const v of ALL_VARIANTS) {
    assert.equal(notePlaceholder(v, true, true), "פרט את החריגה…");
    assert.equal(notePlaceholder(v, false, false), "הערה (אופציונלי)");
  }
  for (const v of ["station", "photo", "dialog", "wizard", "kit-item"] as const) assert.equal(notePlaceholder(v, false, true), "פרט את החריגה (אופציונלי)");
  for (const v of ["pack-item", "pack"] as const) assert.equal(notePlaceholder(v, false, true), "הערה (אופציונלי)");
});

test("the header status: א (12, 15, 16), ב (13), ג (14), none in 17/18", () => {
  // the LED fails without its note; the number is empty; the pair is untouched
  const { ev } = evaluateDrafts(DEFS, { f_led00001: { opt: "o_led00003" }, f_fan00001: { opt: "o_fan00001" } });
  assert.deepEqual([ev.missingRequired.length, ev.missingNotes.length], [2, 1]);
  for (const v of ["station", "wizard", "kit-item"] as const) assert.deepEqual(blockStatus(v, DEFS, ev), statusA(2, 1));
  assert.deepEqual(blockStatus("photo", DEFS, ev), statusB(1, 3, 1));
  assert.deepEqual(blockStatus("dialog", DEFS, ev), statusC(1, 3, 1));
  assert.equal(blockStatus("pack", DEFS, ev), null);
  assert.equal(blockStatus("pack-item", DEFS, ev), null);

  const done = evaluateDrafts(DEFS, { f_led00001: { opt: "o_led00001" }, f_gnd00001: { num: "0.05" }, f_iso00001: { ok: "pass" } }).ev;
  for (const v of ["station", "photo", "dialog"] as const) assert.deepEqual(blockStatus(v, DEFS, done), { text: "כל שדות החובה מולאו", tone: "success" });
});

test("status ב's ratio is one left-to-right run, the text unchanged (spec §0.3)", () => {
  const ratio = statusB(2, 3, 0).text;
  assert.deepEqual(statusRuns(ratio), [{ text: "2 / 3", ltr: true }, { text: " שדות חובה" }]);
  assert.equal(statusRuns(ratio).map((r) => r.text).join(""), ratio);
  assert.deepEqual(statusRuns(statusB(12, 14, 0).text)[0], { text: "12 / 14", ltr: true });
  // the other lines have no ratio: one plain run
  for (const line of [statusB(3, 3, 0), statusB(3, 3, 1), statusA(2, 0), statusC(1, 3, 0)]) {
    assert.deepEqual(statusRuns(line.text), [{ text: line.text }]);
  }
});

test("titles and the field count", () => {
  assert.equal(stationBlockTitle("  חשמל "), "בדיקות חשמל");
  assert.equal(stationBlockTitle(""), BLOCK_TITLE.dialog);
  assert.equal(stationBlockTitle(null), "בדיקות העמדה");
  assert.equal(fieldCountText(4), "4 שדות");
  assert.equal(fieldCountText(0), "0 שדות");
  assert.equal(fieldCountText(1), BLOCK_COPY_PENDING.fieldCountOne);
});

test("rows and their separators: a line between rows, none under a group label or a section title", () => {
  const one = blockItems([{ fields: DEFS }]);
  assert.deepEqual(one.map((it) => [it.kind, it.rule]), [["field", false], ["field", true], ["section", true], ["field", false], ["field", true]]);
  assert.ok(one.every((it) => it.group === 0 && (it.kind !== "field" || !it.inMini)));

  // artboard 16: "לכל פריט" then "שדות מסך"
  const kit: FieldsBlockGroup[] = [{ mini: "לכל פריט", icon: "each", fields: [led, fan] }, { mini: "שדות מסך", icon: "type", fields: [gnd] }];
  assert.deepEqual(blockItems(kit).map((it) => [it.kind, it.group, it.rule]), [
    ["mini", 0, false], ["field", 0, false], ["field", 0, true], ["mini", 1, true], ["field", 1, false],
  ]);
  assert.ok(blockItems(kit).every((it) => it.kind !== "field" || it.inMini));

  // a second group without a label continues the rows (artboard 15: `gi > 0 && !g.mini`)
  assert.deepEqual(blockItems([{ fields: [led] }, { fields: [fan] }]).map((it) => it.rule), [false, true]);
  assert.deepEqual(groupFields(kit), [led, fan, gnd]);
});

test("a row's state comes from the evaluation", () => {
  const drafts: Drafts = { f_led00001: { opt: "o_led00003" }, f_iso00001: { ok: "fail", note: "נמצא קצר" }, f_qui00001: { opt: "o_fan00003" } };
  const defs = [...DEFS, quiet];
  const { ev } = evaluateDrafts(defs, drafts);
  assert.deepEqual(rowState(led, ev, false), { isFail: true, noteRequired: true, noteError: true, showRequiredError: false });
  assert.deepEqual(rowState(iso, ev, false), { isFail: true, noteRequired: true, noteError: false, showRequiredError: false });
  assert.deepEqual(rowState(fan, ev, true), { isFail: false, noteRequired: false, noteError: false, showRequiredError: false });
  // notes "off": a failing value never asks for a note
  assert.deepEqual(rowState(quiet, ev, false), { isFail: true, noteRequired: false, noteError: false, showRequiredError: false });
  // an empty required number shows its error only after a save attempt
  assert.equal(rowState(gnd, ev, false).showRequiredError, false);
  assert.equal(rowState(gnd, ev, true).showRequiredError, true);
});

test("kit item groups carry artboard 16's labels; ids and label kinds", () => {
  const item: KitItemFields = {
    item_id: "1005150926000102", package_seq: 2, item_type_id: 7, item_type_desc: "מסך",
    groups: [{ target: "each_item", fields: [led] }, { target: { item_type_id: 7 }, fields: [gnd] }],
  };
  assert.deepEqual(kitItemFieldGroups(item), [
    { mini: "לכל פריט", icon: "each", fields: [led] },
    { mini: "שדות מסך", icon: "type", fields: [gnd] },
  ]);
  assert.deepEqual(kitItemFieldGroups({ ...item, groups: [{ target: "each_item", fields: [led] }] }), [{ mini: "לכל פריט", icon: "each", fields: [led] }]);
  assert.deepEqual(kitItemFieldGroups(undefined), []);

  assert.deepEqual(fieldRowIds("p1", "f_led00001"), { control: "p1-c-f_led00001", note: "p1-n-f_led00001" });
  const labelled: InputField["type"][] = ["choice_row", "multi_choice", "number", "text", "textarea", "scan"];
  assert.ok(labelled.every(hasLabelledControl));
  assert.deepEqual([hasLabelledControl("pass_fail"), hasLabelledControl("checklist"), hasLabelledControl("photo")], [false, false, false]);
  assert.equal(TEXT_VALUE_MAX, 2000);
});

test("patchDraft takes a function of the draft as it is when the change lands", () => {
  const before: Drafts = { f_led00001: { opt: "o_led00001", note: "x" } };
  const after = patchDraft(before, "f_led00001", (d) => ({ note: (d?.note ?? "") + "y" }));
  assert.deepEqual(after, { f_led00001: { opt: "o_led00001", note: "xy" } });
  assert.deepEqual(before, { f_led00001: { opt: "o_led00001", note: "x" } });
  assert.deepEqual(patchDraft({}, "f_gnd00001", (d) => ({ num: d === undefined ? "new" : "old" })), { f_gnd00001: { num: "new" } });
});

test("draftsFieldsState: the block's state over drafts a host keeps itself", () => {
  let store: Drafts = { f_led00001: { opt: "o_led00003" } };
  const update = (next: (d: Drafts) => Drafts) => { store = next(store); };
  const fx = draftsFieldsState(DEFS, store, update);
  assert.deepEqual(fx.ev, evaluateDrafts(DEFS, store).ev);
  assert.equal(fx.blocking(true), true);
  assert.deepEqual(fx.photosPending, []);
  assert.equal(fx.drafts, store);

  fx.set("f_led00001", { note: "לא נדלקת" });
  fx.set("f_iso00001", (d) => ({ ok: d?.ok ?? "pass" }));
  assert.deepEqual(store, { f_led00001: { opt: "o_led00003", note: "לא נדלקת" }, f_iso00001: { ok: "pass" } });
});

test("photo shots: several picked at once and uploads ending in any order all land", () => {
  let store: Drafts = {};
  const set = (patch: (d: FieldDraft | undefined) => Partial<FieldDraft>) => { store = patchDraft(store, shot.id, patch); };
  // one gallery pick of three images: each added from the draft as it is by then
  set(addShot("blob:1")); set(addShot("blob:2")); set(addShot("blob:3"));
  assert.deepEqual(store[shot.id].photos?.map((s) => s.previewUrl), ["blob:1", "blob:2", "blob:3"]);
  assert.deepEqual(evaluateDrafts([shot], store).photosPending, [shot.id]);

  set(settleShot("blob:3", "items/1/c.jpg"));
  set(settleShot("blob:1", null));
  set(removeShot(0));                       // the failed one, removed by the worker
  set(settleShot("blob:2", "items/1/b.jpg"));
  set(settleShot("blob:1", "items/1/late.jpg"));   // a shot removed meanwhile stays removed
  assert.deepEqual(store[shot.id].photos, [
    { previewUrl: "blob:2", objectKey: "items/1/b.jpg", uploading: false, failed: false },
    { previewUrl: "blob:3", objectKey: "items/1/c.jpg", uploading: false, failed: false },
  ]);
  assert.deepEqual(evaluateDrafts([shot], store).photosPending, []);
});

test("checklist: toggles read the draft as it is, own keys only", () => {
  let store: Drafts = {};
  const set = (patch: (d: FieldDraft | undefined) => Partial<FieldDraft>) => { store = patchDraft(store, list.id, patch); };
  set(toggleChecklistItem("c_item0001"));
  set(toggleChecklistItem("c_item0002"));
  set(toggleChecklistItem("c_item0001"));
  assert.deepEqual(store[list.id].checked, { c_item0001: false, c_item0002: true });
  assert.equal(isItemChecked(store[list.id], "c_item0002"), true);
  assert.equal(isItemChecked(store[list.id], "c_item0001"), false);
  assert.equal(isItemChecked(store[list.id], "constructor"), false);
  assert.equal(isItemChecked(undefined, "c_item0001"), false);
});
