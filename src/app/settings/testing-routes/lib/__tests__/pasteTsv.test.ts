import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoiceOption, ChoiceRowField, Field, Tone } from "@/app/lib/station-fields/schema";
import { LIMITS, lintFields, parseFieldList } from "@/app/lib/station-fields/validate";
import type { IdSource, SharedListLike } from "../editorModel";
import { DEFAULT_CHOICE_OPTIONS } from "../labels";
import { TSV_HEADER, exactSharedList, insertTsvRows, parseTsvRows, sharedTone, tsvRowField } from "../pasteTsv";

/**
 * "הדבק מאקסל" (route-fields spec §5.14, §8.9, §8.10; artboard 2): the TSV format, the default row of
 * a one-column line, links to a shared list that matches exactly, tones by label, duplicates and
 * the shape limits.
 */

/** Deterministic ids in the real formats. */
function ids(): IdSource {
  let n = 0;
  const next = (prefix: string) => prefix + (++n).toString(36).padStart(8, "0");
  return { field: () => next("f_"), option: () => next("o_"), item: () => next("c_") };
}

const opt = (id: string, label: string, tone: Tone): ChoiceOption => ({ id, label, tone });

/** The shared lists of artboards 2, 4 and 8. */
const DEFAULT_LIST: SharedListLike = {
  id: 1, name: "תקינות כללית", version: 3,
  options: DEFAULT_CHOICE_OPTIONS.map((o, i) => opt(`o_defl000${i + 1}`, o.label, o.tone)),
};
const LED_LIST: SharedListLike = {
  id: 4, name: "מצב נורית", version: 2,
  options: [opt("o_led00001", "תקין", "pass"), opt("o_led00002", "מהבהבת", "warn"), opt("o_led00003", "לא דולקת", "fail"), opt("o_led00004", "לא נבדק", "neutral")],
};
const EXT_LIST: SharedListLike = {
  id: 5, name: "מצב חיצוני", version: 1,
  options: [opt("o_ext00001", "ללא פגמים", "pass"), opt("o_ext00002", "שריטות קלות", "warn"), opt("o_ext00003", "שבר/סדק", "fail"), opt("o_ext00004", "לכלוך", "warn")],
};
const LISTS = [DEFAULT_LIST, LED_LIST, EXT_LIST];

const choice = (f: Field): ChoiceRowField => {
  assert.equal(f.type, "choice_row");
  return f as ChoiceRowField;
};

// ---- the format -----------------------------------------------------------------------------------
test("lines split on \\r?\\n, empty ones are skipped, cells trimmed, empty cells at the end dropped", () => {
  const rows = parseTsvRows("  נורית מתח \t תקין\tמהבהבת\t\t\r\n\r\n\t\t\n   \nמאוורר\t\t\nא\t\tב\n");
  assert.deepEqual(rows, [
    { label: "נורית מתח", options: ["תקין", "מהבהבת"] },
    { label: "מאוורר", options: [] },
    // An empty cell in the middle stays an (empty) option — the lint names it.
    { label: "א", options: ["", "ב"] },
  ]);
  assert.deepEqual(parseTsvRows(""), []);
  assert.deepEqual(parseTsvRows("﻿מאוורר"), [{ label: "מאוורר", options: [] }], "a byte-order mark is not part of the name");
});

test("the header 'שם השדה' is skipped on the first line only", () => {
  assert.equal(TSV_HEADER, "שם השדה");
  const text = "שם השדה\tאפשרות 1\tאפשרות 2\nנורית מתח\tתקין\nשם השדה\tא";
  assert.deepEqual(parseTsvRows(text).map((r) => r.label), ["נורית מתח", "שם השדה"]);
  // Empty lines first: the header is still the first line that has cells.
  assert.deepEqual(parseTsvRows("\n\n שם השדה \tאפשרות 1\nמאוורר").map((r) => r.label), ["מאוורר"]);
});

// ---- one line → one choice row ---------------------------------------------------------------------
test("one column is 'הוסף שורת בדיקה': linked to 'תקינות כללית' when it exists, else artboard 2's options", () => {
  const linked = choice(tsvRowField({ label: "מאוורר מעבד", options: [] }, LISTS, ids()));
  assert.equal(linked.label, "מאוורר מעבד");
  assert.deepEqual(linked.list_ref, { id: 1, ver: 3 });
  assert.deepEqual(linked.options, DEFAULT_LIST.options);
  assert.equal(linked.notes, "required_on_fail");
  assert.equal(linked.required, false);

  const local = choice(tsvRowField({ label: "מאוורר מעבד", options: [] }, null, ids()));
  assert.equal(local.list_ref, undefined);
  assert.deepEqual(local.options.map((o) => [o.label, o.tone]), DEFAULT_CHOICE_OPTIONS.map((o) => [o.label, o.tone]));
});

test("options that are exactly a shared list (labels and order) link to it, with its options", () => {
  const f = choice(tsvRowField({ label: "נורית מתח", options: ["תקין", "מהבהבת", "לא דולקת", "לא נבדק"] }, LISTS, ids()));
  assert.deepEqual(f.list_ref, { id: 4, ver: 2 });
  assert.deepEqual(f.options, LED_LIST.options);
  assert.equal(f.notes, "required_on_fail");
  assert.equal(f.required, false);
  assert.equal(exactSharedList(["תקין", "מהבהבת", "לא דולקת", "לא נבדק"], LISTS)?.name, "מצב נורית");
});

test("another order, or a part of a list, does not link: each option takes the first matching label's tone, else neutral", () => {
  const reordered = choice(tsvRowField({ label: "נורית", options: ["מהבהבת", "תקין", "לא דולקת", "לא נבדק"] }, LISTS, ids()));
  assert.equal(reordered.list_ref, undefined);
  assert.deepEqual(reordered.options.map((o) => o.tone), ["warn", "pass", "fail", "neutral"]);
  const part = choice(tsvRowField({ label: "נורית", options: ["תקין", "מהבהבת", "לא דולקת"] }, LISTS, ids()));
  assert.equal(part.list_ref, undefined);

  const mixed = choice(tsvRowField({ label: "מצב חיצוני", options: ["ללא פגמים", "לכלוך", "לא תקין", "חדש"] }, LISTS, ids()));
  assert.deepEqual(mixed.options.map((o) => [o.label, o.tone]), [["ללא פגמים", "pass"], ["לכלוך", "warn"], ["לא תקין", "fail"], ["חדש", "neutral"]]);
  // Fresh option ids, never the lists' (the field is not linked).
  assert.ok(mixed.options.every((o) => /^o_[a-z0-9]{8}$/.test(o.id) && !o.id.startsWith("o_ext")));

  // The first list with the label wins.
  const later: SharedListLike = { id: 9, name: "אחרת", version: 1, options: [opt("o_late0001", "לכלוך", "fail")] };
  assert.equal(sharedTone("לכלוך", [EXT_LIST, later]), "warn");
  assert.equal(sharedTone("לכלוך", [later, EXT_LIST]), "fail");
  assert.equal(sharedTone("לכלוך", null), "neutral");
});

test("what the shape check refuses is cut to its limits: name 80, option 60, 12 options", () => {
  const f = choice(tsvRowField({ label: "א".repeat(100), options: Array.from({ length: 15 }, (_, i) => "ב".repeat(70) + i) }, null, ids()));
  assert.equal(f.label.length, LIMITS.fieldLabel);
  assert.equal(f.options.length, LIMITS.options);
  assert.ok(f.options.every((o) => o.label.length === LIMITS.optionLabel));
  assert.doesNotThrow(() => parseFieldList([f], "fields"));
});

// ---- into a cell --------------------------------------------------------------------------------------
const SPEC_PASTE = [
  "שם השדה\tאפשרות 1\tאפשרות 2\tאפשרות 3\tאפשרות 4",
  "נורית מתח\tתקין\tמהבהבת\tלא דולקת\tלא נבדק",
  "הפעלה ו-POST\tעולה תקין\tעולה עם שגיאה\tלא עולה\tלא נבדק",
  "מאוורר מעבד",
].join("\r\n");

test("§8.9: three TSV rows make three rows; 'תקין / מהבהבת / לא דולקת / לא נבדק' links to 'מצב נורית'", () => {
  const r = insertTsvRows([], parseTsvRows(SPEC_PASTE), { lists: LISTS, ids: ids() });
  assert.equal(r.added.length, 3);
  assert.deepEqual(r.fields.map((f) => f.label), ["נורית מתח", "הפעלה ו-POST", "מאוורר מעבד"]);
  const [led, post, fan] = r.fields.map(choice);
  assert.deepEqual(led.list_ref, { id: 4, ver: 2 });
  assert.equal(post.list_ref, undefined);
  assert.deepEqual(post.options.map((o) => [o.label, o.tone]), [["עולה תקין", "neutral"], ["עולה עם שגיאה", "neutral"], ["לא עולה", "neutral"], ["לא נבדק", "neutral"]]);
  assert.deepEqual(fan.list_ref, { id: 1, ver: 3 });
  // The shape check takes the list, and the lint finds nothing to block a publish.
  assert.doesNotThrow(() => parseFieldList(r.fields, "fields"));
  assert.deepEqual(lintFields(r.fields).filter((i) => i.level === "error"), []);
});

test("§8.10: 'שם⇥אפשרות 1⇥…' makes a check row per line", () => {
  const text = ["מעמד\tיציב\tמתנדנד\tשבור", "כבל\tתקין\tפגום", "מסגרת\tללא פגמים\tשריטות קלות\tשבר/סדק\tלכלוך"].join("\n");
  const r = insertTsvRows([], parseTsvRows(text), { lists: LISTS, ids: ids() });
  assert.equal(r.fields.length, 3);
  assert.ok(r.fields.every((f) => f.type === "choice_row" && !f.required && f.notes === "required_on_fail"));
  assert.deepEqual(choice(r.fields[2]).list_ref, { id: 5, ver: 1 }, "the last row is exactly 'מצב חיצוני'");
});

test("a name the cell has — or a kit item's each_item group has, or an earlier line — is skipped", () => {
  const existing = [tsvRowField({ label: "נורית מתח", options: ["תקין", "לא תקין"] }, null, ids())];
  const eachItem = [tsvRowField({ label: "מצב חיצוני", options: [] }, null, ids())];
  const text = "נורית מתח \tתקין\nמצב חיצוני\nכבל\nכבל\tא";
  const r = insertTsvRows(existing, parseTsvRows(text), { ids: ids(), alongside: eachItem });
  assert.deepEqual(r.fields.map((f) => f.label), ["נורית מתח", "כבל"]);
  assert.equal(r.skipped, 3);
  assert.equal(r.overflow, 0);
});

test("the rows go after the focused row, else at the end — one list", () => {
  const id = ids();
  const a = tsvRowField({ label: "א", options: [] }, null, id);
  const b = tsvRowField({ label: "ב", options: [] }, null, id);
  const rows = parseTsvRows("ג\nד");
  assert.deepEqual(insertTsvRows([a, b], rows, { ids: id, after: a.id }).fields.map((f) => f.label), ["א", "ג", "ד", "ב"]);
  assert.deepEqual(insertTsvRows([a, b], rows, { ids: id, after: "f_nothere1" }).fields.map((f) => f.label), ["א", "ב", "ג", "ד"]);
  assert.deepEqual(insertTsvRows([a, b], rows, { ids: id }).fields.map((f) => f.label), ["א", "ב", "ג", "ד"]);
});

test("new rows get ids the step does not use yet, and a full cell takes no more", () => {
  // An id source that hands out a taken id, then repeats one before moving on.
  let nf = 0;
  let no = 0;
  const seq = ["f_00000001", "f_00000002", "f_00000002", "f_00000003", "f_00000004", "f_00000005"];
  const sticky: IdSource = {
    field: () => seq[nf++] ?? "f_" + nf.toString(36).padStart(8, "x"),
    option: () => "o_" + (no++).toString(36).padStart(8, "0"),
    item: () => "c_00000000",
  };
  const r = insertTsvRows([], parseTsvRows("א\nב"), { ids: sticky, takenIds: new Set(["f_00000001"]) });
  const fieldIds = r.fields.map((f) => f.id);
  assert.equal(new Set(fieldIds).size, 2);
  assert.ok(!fieldIds.includes("f_00000001"));

  const id = ids();
  const full = Array.from({ length: LIMITS.fieldsPerList - 1 }, (_, i) => tsvRowField({ label: "שדה " + i, options: [] }, null, id));
  const r2 = insertTsvRows(full, parseTsvRows("א\nב\nג"), { ids: id });
  assert.equal(r2.fields.length, LIMITS.fieldsPerList);
  assert.equal(r2.added.length, 1);
  assert.equal(r2.overflow, 2);
});
