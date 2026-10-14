import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_TYPES } from "@/app/lib/station-fields/schema";
import type {
  ChecklistField, ChoiceRowField, Field, NumberField, PassFailField, PhotoField, RouteFieldsConfig, SectionField,
} from "@/app/lib/station-fields/schema";
import { lintRouteFieldsConfig, parseFieldList } from "@/app/lib/station-fields/validate";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { EMPTY_DRAFT_MODEL, currentConfigs, draftReducer, setGroupFields, summarize } from "../draftModel";
import { buildFieldsMap, findCell, getCell } from "../mapModel";
import type { MapCell } from "../mapModel";
import {
  EDITOR_COPY_PENDING, EDITOR_TEXT, editorFooterText, editorSubText, editorTitleText, fieldsTabText, listLinkText, nextStationText,
  noteMaxAria, noteMaxOptionText, noteMaxText, notesModeAria, optionEditLabel, optionsGroupLabel, requiredAria, rowGripLabel,
  rowMoreLabel, sharedNoticeText, stopSubText, targetChipText,
} from "../labels";
import {
  addChecklistItem, addOption, canAddChecklistItem, defaultOptions, dropField, duplicateField, editorCounts, issuesOfField,
  issuesOfGroup, lockedRowTexts, moveField, moveFieldBy, namedFieldCount, neighbourStop, newField, opensExpanded,
  packageWizardAt, parsePhotoMin, popoverFieldId, popupKindOf, removeChecklistItem, removeField, removeOption,
  renameChecklistItem, renameOption, replaceField, setOptionTone, stopTargetCell, targetChips, timelineStops, withFieldHelp,
  withPhotoType,
} from "../editorModel";
import type { IdSource } from "../editorModel";
import { PC, artboard1, choice } from "./fixtures";

/** Deterministic ids in the real formats. */
function ids(): IdSource & { n: number } {
  const s = { n: 0 } as IdSource & { n: number };
  const next = (prefix: string) => {
    s.n += 1;
    return prefix + s.n.toString(36).padStart(8, "0");
  };
  s.field = () => next("f_");
  s.option = () => next("o_");
  s.item = () => next("c_");
  return s;
}

function mapOf(ctx: FieldsContextJson) {
  const model = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  return buildFieldsMap({ context: ctx, configs: currentConfigs(model), issues: summarize(model).issuesByRoute });
}

const asCell = (c: ReturnType<typeof getCell>): MapCell => {
  assert.ok(c && !c.na, "expected a relevant cell");
  return c;
};

/** A config with `field` alone in an item step's group — what the lint sees of one row. */
function configWith(field: Field): RouteFieldsConfig {
  return {
    schema: 1,
    steps: { s_lint0000: { uid: "s_lint0000", station_type_id: 12, station_label: "חשמל", scope: "item", groups: [{ target: "item", fields: [{ ...field, label: "שדה" }] }] } },
  };
}

// ---- new rows -----------------------------------------------------------------------------------
test("a new check row is artboard 2's addRow: the 'תקינות כללית' options, notes on fail, not required", () => {
  const f = newField("choice_row", ids()) as ChoiceRowField;
  assert.equal(f.type, "choice_row");
  assert.equal(f.label, "");
  assert.equal(f.required, false);
  assert.equal(f.notes, "required_on_fail");
  assert.deepEqual(f.options.map((o) => [o.label, o.tone]), [["תקין", "pass"], ["תקין עם הערה", "warn"], ["לא תקין", "fail"], ["לא נבדק", "neutral"]]);
  assert.equal(new Set(f.options.map((o) => o.id)).size, 4);
  assert.equal(f.list_ref, undefined);
  assert.equal(defaultOptions(ids()).length, 4);
});

test("a new check row links to the shared list 'תקינות כללית' when there is one (session 2d)", () => {
  const shared = {
    id: 7,
    name: " תקינות כללית ",
    version: 3,
    options: [{ id: "o_shared01", label: "תקין", tone: "pass" as const }, { id: "o_shared02", label: "לא תקין", tone: "fail" as const }],
  };
  const other = { id: 8, name: "מצב נורית", version: 1, options: [] };
  const f = newField("choice_row", ids(), [other, shared]) as ChoiceRowField;
  assert.deepEqual(f.list_ref, { id: 7, ver: 3 });
  assert.deepEqual(f.options, shared.options);
  assert.notEqual(f.options[0], shared.options[0], "the options are a copy");
  assert.deepEqual(parseFieldList([f]), [f]);
  // No such list: today's local copy, unlinked; other types never link.
  assert.equal((newField("choice_row", ids(), [other]) as ChoiceRowField).list_ref, undefined);
  assert.equal((newField("multi_choice", ids(), [shared]) as { list_ref?: unknown }).list_ref, undefined);
});

test("every type's new row passes the shape check", () => {
  const src = ids();
  const all = FIELD_TYPES.map((t) => newField(t, src));
  assert.deepEqual(parseFieldList(all), all);
  const section = all.find((f) => f.type === "section") as SectionField;
  assert.equal(section.label, EDITOR_TEXT.newSection);
  assert.equal((all.find((f) => f.type === "number") as NumberField).out_of_range_fail, true);
  assert.deepEqual(FIELD_TYPES.filter(opensExpanded), ["number"]);
});

// ---- options unlink -------------------------------------------------------------------------------
test("any change to an option unlinks the field from its shared list (artboard 2 rule)", () => {
  const base = { ...(choice("נורית מתח", ["pass", "warn", "fail", "neutral"]) as ChoiceRowField), list_ref: { id: 3, ver: 2 } };
  const [a, b] = base.options;

  const renamed = renameOption(base, a.id, "דולקת");
  assert.equal(renamed.options[0].label, "דולקת");
  assert.equal(renamed.list_ref, undefined);

  const toned = setOptionTone(base, b.id, "fail");
  assert.equal(toned.options[1].tone, "fail");
  assert.equal(toned.list_ref, undefined);

  const removed = removeOption(base, a.id);
  assert.deepEqual(removed.options.map((o) => o.id), base.options.slice(1).map((o) => o.id));
  assert.equal(removed.list_ref, undefined);

  const added = addOption(base, ids());
  assert.equal(added.field.options.length, 5);
  assert.deepEqual(added.field.options[4], { id: added.optionId, label: "אפשרות חדשה", tone: "neutral" });
  assert.equal(added.field.list_ref, undefined);

  // The original is untouched.
  assert.deepEqual(base.list_ref, { id: 3, ver: 2 });
  assert.equal(base.options.length, 4);
});

test("help text: blank removes it", () => {
  const f = newField("text", ids());
  assert.equal(withFieldHelp(f as Exclude<Field, SectionField>, "למדוד ליד המחבר").help, "למדוד ליד המחבר");
  assert.equal("help" in withFieldHelp({ ...f, help: "x" } as Exclude<Field, SectionField>, "  "), false);
});

// ---- checklist and photo settings ------------------------------------------------------------------
test("checklist boxes: add on Enter (trimmed, own id), rename in place, remove; the lint follows", () => {
  const src = ids();
  const f = newField("checklist", src) as ChecklistField;
  const lint = (field: Field) => lintRouteFieldsConfig(configWith(field)).map((i) => i.code);
  assert.deepEqual(lint(f).filter((c) => c.startsWith("CHECKLIST")), ["CHECKLIST_EMPTY"]);

  assert.deepEqual(addChecklistItem(f, "   ", src), { field: f, itemId: null }, "a blank name adds nothing");
  const a = addChecklistItem(f, "  כבל חשמל  ", src);
  assert.ok(a.itemId && /^c_[a-z0-9]{8}$/.test(a.itemId));
  assert.deepEqual(a.field.items, [{ id: a.itemId, label: "כבל חשמל" }]);
  assert.equal(f.items.length, 0, "the original is untouched");
  const b = addChecklistItem(a.field, "מטען", src);
  assert.deepEqual(b.field.items.map((it) => it.label), ["כבל חשמל", "מטען"]);
  assert.deepEqual(lint(b.field).filter((c) => c.startsWith("CHECKLIST")), []);

  const renamed = renameChecklistItem(b.field, a.itemId!, "");
  assert.deepEqual(renamed.items.map((it) => it.label), ["", "מטען"]);
  assert.deepEqual(lint(renamed).filter((c) => c.startsWith("CHECKLIST")), ["CHECKLIST_ITEM_LABEL_EMPTY"]);
  assert.deepEqual(removeChecklistItem(renamed, a.itemId!).items.map((it) => it.label), ["מטען"]);

  // The shape check's limits: 20 boxes, 80 characters a name.
  let full = f;
  for (let i = 0; i < 20; i++) full = addChecklistItem(full, "תיבה " + i, src).field;
  assert.equal(canAddChecklistItem(full), false);
  assert.equal(addChecklistItem(full, "עוד", src).itemId, null);
  assert.equal(addChecklistItem(f, "א".repeat(90), src).field.items[0].label.length, 80);
  assert.deepEqual(parseFieldList([full]), [full]);
});

test("photo settings: the type by code, the minimum a whole number 0..20", () => {
  const f = newField("photo", ids()) as PhotoField;
  const lint = (field: Field) => lintRouteFieldsConfig(configWith(field)).map((i) => i.code);
  assert.deepEqual(lint(f).filter((c) => c === "PHOTO_TYPE_EMPTY"), ["PHOTO_TYPE_EMPTY"]);
  const typed = withPhotoType(f, "package");
  assert.equal(typed.photo_type, "package");
  assert.equal(f.photo_type, "", "the original is untouched");
  assert.deepEqual(lint(typed).filter((c) => c === "PHOTO_TYPE_EMPTY"), []);

  assert.equal(parsePhotoMin(""), null);
  assert.equal(parsePhotoMin("x"), null);
  assert.equal(parsePhotoMin("0"), 0);
  assert.equal(parsePhotoMin("3"), 3);
  assert.equal(parsePhotoMin("2a"), 2);
  assert.equal(parsePhotoMin("25"), 20);
  assert.equal(parsePhotoMin("-4"), 4);
  assert.deepEqual(parseFieldList([{ ...typed, min: parsePhotoMin("99")! }]), [{ ...typed, min: 20 }]);
});

// ---- the field list --------------------------------------------------------------------------------
test("replace, remove, duplicate (fresh ids, right after), move, drop", () => {
  const src = ids();
  const a = newField("choice_row", src);
  const b = newField("pass_fail", src);
  const c = newField("section", src);
  const list: Field[] = [a, b, c];

  const b2: PassFailField = { ...(b as PassFailField), label: "בדיקת בידוד" };
  assert.equal(replaceField(list, b2)[1], b2);
  assert.deepEqual(removeField(list, b.id).map((f) => f.id), [a.id, c.id]);

  const dup = duplicateField(list, a.id, src);
  assert.equal(dup.fields.length, 4);
  assert.equal(dup.fields[1].id, dup.id);
  assert.notEqual(dup.id, a.id);
  const copy = dup.fields[1] as ChoiceRowField;
  const orig = a as ChoiceRowField;
  assert.deepEqual(copy.options.map((o) => o.label), orig.options.map((o) => o.label));
  assert.ok(copy.options.every((o, i) => o.id !== orig.options[i].id));
  assert.deepEqual(duplicateField(list, "f_missing0", src), { fields: list, id: null });

  assert.deepEqual(moveField(list, c.id, 0).map((f) => f.id), [c.id, a.id, b.id]);
  assert.deepEqual(moveField(list, a.id, 99).map((f) => f.id), [b.id, c.id, a.id]);
  assert.deepEqual(moveFieldBy(list, a.id, -1).map((f) => f.id), [a.id, b.id, c.id]);
  assert.deepEqual(moveFieldBy(list, a.id, 1).map((f) => f.id), [b.id, a.id, c.id]);
  assert.deepEqual(moveFieldBy(list, c.id, 1).map((f) => f.id), [a.id, b.id, c.id]);

  assert.deepEqual(dropField(list, a.id, c.id, true).map((f) => f.id), [b.id, c.id, a.id]);
  assert.deepEqual(dropField(list, c.id, a.id, false).map((f) => f.id), [c.id, a.id, b.id]);
  assert.deepEqual(dropField(list, a.id, a.id, true).map((f) => f.id), [a.id, b.id, c.id]);
});

// ---- counts and the footer --------------------------------------------------------------------------
test("artboard 2's opening state: footer '5 שדות · 4 חובה · שורה אחת ללא שם · …', tab 'שדות · 5'", () => {
  const src = ids();
  const named = (label: string, required: boolean): Field => ({ ...(newField("choice_row", src) as ChoiceRowField), label, required });
  const rows: Field[] = [
    { ...(newField("section", src) as SectionField), label: "הפעלה" },
    named("נורית מתח", true),
    named("הפעלה ו-POST", true),
    named("מאוורר ספק הכוח", false),
    { ...(newField("section", src) as SectionField), label: "בטיחות חשמלית" },
    { ...(newField("number", src) as NumberField), label: "התנגדות הארקה", required: true },
    { ...(newField("pass_fail", src) as PassFailField), label: "בדיקת בידוד", required: true },
    newField("choice_row", src),
  ];
  const c = editorCounts(rows);
  assert.deepEqual(c, { named: 5, required: 4, unnamed: 1 });
  assert.equal(namedFieldCount(rows), 5);
  assert.equal(editorFooterText(c.named, c.required, c.unnamed), "5 שדות · 4 חובה · שורה אחת ללא שם · גרירה או Alt+חיצים לשינוי סדר");
  assert.equal(fieldsTabText(c.named), "שדות · 5");
});

test("issues of a field and of a group", () => {
  const issues = [
    { level: "warning" as const, code: "DUPLICATE_LABEL_IN_CELL" as const, step_uid: "s_a0000000", target: "item" as const, field_id: "f_1", message: "w" },
    { level: "error" as const, code: "OPTION_LABEL_EMPTY" as const, step_uid: "s_a0000000", target: "item" as const, field_id: "f_1", message: "e" },
    { level: "error" as const, code: "FIELD_LABEL_EMPTY" as const, step_uid: "s_a0000000", target: { item_type_id: 4 }, field_id: "f_2", message: "x" },
    { level: "error" as const, code: "STEP_UNKNOWN" as const, step_uid: "s_a0000000", message: "y" },
  ];
  assert.deepEqual(issuesOfField(issues, "f_1").map((i) => i.message), ["e", "w"]);
  assert.deepEqual(issuesOfGroup(issues, "s_a0000000", "item").map((i) => i.message), ["w", "e"]);
  assert.deepEqual(issuesOfGroup(issues, "s_a0000000", { item_type_id: 4 }).map((i) => i.message), ["x"]);
});

test("the open popover's row", () => {
  assert.equal(popoverFieldId({ kind: "notes", fieldId: "f_1" }), "f_1");
  assert.equal(popoverFieldId({ kind: "checkItem", fieldId: "f_2", itemId: "c_00000001" }), "f_2");
  assert.equal(popoverFieldId({ kind: "picker" }), null);
  assert.equal(popoverFieldId(null), null);
});

// ---- the popup the station opens (spec §10.3) ---------------------------------------------------------
test("locked rows follow the popup the station really opens", () => {
  const lookup = { hasWizard: (id: number) => id === 3 || id === 2, isVerdict: (id: number) => id === 3 };
  assert.equal(popupKindOf(3, false, lookup), "verdict");
  assert.equal(popupKindOf(2, false, lookup), "photo");
  assert.equal(popupKindOf(12, false, lookup), "dialog");
  assert.equal(popupKindOf(3, true, lookup), "package");

  // Artboard 2's wording belongs to VerdictStation / PhotoStation only.
  const station = { top: "סריקת מק״ט יצרן · חלק קבוע · שלב 1 בחלון", bottom: "פסק דין · 'בדיקה תקינה?' · תמיד אחרון" };
  assert.deepEqual(lockedRowTexts("verdict", null, "item"), station);
  assert.deepEqual(lockedRowTexts("photo", null, "item"), station);
  assert.deepEqual(lockedRowTexts("dialog", null, "item"), { top: EDITOR_COPY_PENDING.lockedTopDialog, bottom: EDITOR_COPY_PENDING.lockedBottomDialog });

  assert.equal(packageWizardAt(0, 2), "open");
  assert.equal(packageWizardAt(1, 2), "close");
  assert.equal(packageWizardAt(0, 1), "open");
  assert.deepEqual(lockedRowTexts("package", "open", "box"), { top: EDITOR_COPY_PENDING.lockedTopOpenBox, bottom: EDITOR_COPY_PENDING.lockedBottomOpenBox });
  assert.deepEqual(lockedRowTexts("package", "open", "each_item"), { top: EDITOR_COPY_PENDING.lockedTopOpenItem, bottom: EDITOR_COPY_PENDING.lockedBottomOpenItem });
  assert.deepEqual(lockedRowTexts("package", "close", "box"), { top: EDITOR_COPY_PENDING.lockedTopCloseBox, bottom: EDITOR_COPY_PENDING.lockedBottomClose });
  assert.deepEqual(lockedRowTexts("package", "close", { item_type_id: 3 }), { top: EDITOR_COPY_PENDING.lockedTopCloseItem, bottom: EDITOR_COPY_PENDING.lockedBottomClose });
});

// ---- station bar and target chips (artboard 1's kit, artboard 2's numbers) ----------------------------
test("the station bar: artboard 2's stops — 10 / 8 / שגיאה / 12 / 3", () => {
  const m = mapOf(artboard1());
  const cell = asCell(findCell(m, "s_pcelec00", "item"));
  const stops = timelineStops(m, cell);
  assert.deepEqual(stops.map((s) => [s.n, s.name, s.packageLevel, s.current, s.sub]), [
    [1, "פתיחת מארז", true, false, "10 שדות"],
    [2, "חשמל", false, true, "8 שדות"],
    [3, "מכניקה", false, false, "שגיאה"],
    [4, "בדיקה ויזואלית", false, false, "12 שדות"],
    [5, "סגירת מארז", true, false, "3 שדות"],
  ]);
  assert.equal(neighbourStop(stops, 1)?.name, "מכניקה");
  assert.equal(neighbourStop(stops, -1)?.name, "פתיחת מארז");
  // The computer does not pass the mechanical station: its stop opens the column's first cell (the screen).
  assert.equal(stops[2].target?.rowLabel, "מסך");
  // A package-level stop opens the same line's cell there.
  assert.equal(stops[0].target?.rowKey, "line:1");
  assert.deepEqual(stops[0].target?.binding.target, { item_type_id: PC });
  assert.equal(nextStationText("מכניקה"), "העמדה הבאה: מכניקה");
  assert.equal(stopSubText(1, 0), "שדה אחד");
});

test("stop targets from the fixed rows: the box row goes to an item column's first cell", () => {
  const m = mapOf(artboard1());
  const elecColumn = m.columns[1].key;
  assert.equal(stopTargetCell(m, elecColumn, "box")?.rowKey, "line:1");
  assert.equal(stopTargetCell(m, m.columns[0].key, "box")?.rowKey, "box");
});

test("target chips: 'מחשב · 5', 'מסך ×2 · 3' on an item column; artboard 7's on a package-level one", () => {
  const m = mapOf(artboard1());
  const ctx = artboard1();
  const model = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  const named = (c: MapCell) => {
    const cfg = model.routes[c.binding.route_id].current;
    const step = cfg.steps[c.binding.step_uid];
    const g = step?.groups.find((x) => JSON.stringify(x.target) === JSON.stringify(c.binding.target));
    return namedFieldCount(g?.fields ?? []);
  };

  const pcElec = asCell(findCell(m, "s_pcelec00", "item"));
  const chips = targetChips(m, pcElec);
  assert.deepEqual(chips.map((c) => [targetChipText(c.lead, named(c.cell)), c.pressed]), [["מחשב · 5", true], ["מסך ×2 · 3", false]]);

  const kitOpen = asCell(findCell(m, "s_kitopen1", "box"));
  assert.deepEqual(targetChips(m, kitOpen).map((c) => targetChipText(c.lead, named(c.cell))), [
    "הקופסה · 3", "כל פריט · 2", "01 מחשב · 2", "02–03 מסך · 2", "04 מקלדת · 1", "05 עכבר · 0",
  ]);
});

test("an edit through setGroupFields shows on the next map (the editor's write path)", () => {
  const ctx = artboard1();
  let model = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  const m0 = buildFieldsMap({ context: ctx, configs: currentConfigs(model) });
  const cell = asCell(findCell(m0, "s_moelec00", "item"));
  const added = newField("pass_fail", ids());
  model = draftReducer(model, {
    type: "edit",
    routeId: cell.binding.route_id,
    mutate: (cfg) => setGroupFields(cfg, cell.binding, cell.stepMeta, [...(cfg.steps[cell.binding.step_uid].groups[0].fields), added]),
  });
  const m1 = buildFieldsMap({ context: ctx, configs: currentConfigs(model) });
  assert.equal(asCell(findCell(m1, "s_moelec00", "item")).fieldCount, 4);
  assert.equal(model.routes[cell.binding.route_id].dirty, true);
});

// ---- strings ----------------------------------------------------------------------------------------------
test("the editor's strings, as artboard 2's script builds them", () => {
  assert.equal(editorTitleText(2, 5, "חשמל"), "שלב 2 מתוך 5 · חשמל");
  assert.equal(editorSubText("מחשב"), "מה העובד ממלא בעמדה הזו עבור: מחשב");
  assert.equal(rowGripLabel(""), "גרירה לשינוי סדר: שורה ללא שם");
  assert.equal(rowGripLabel("נורית מתח"), "גרירה לשינוי סדר: נורית מתח");
  assert.equal(rowMoreLabel(" "), "פעולות נוספות: שורה ללא שם");
  assert.equal(optionsGroupLabel("מאוורר ספק הכוח"), "אפשרויות לשדה מאוורר ספק הכוח");
  assert.equal(optionEditLabel("רעש חריג", "warn"), "עריכת האפשרות רעש חריג · אזהרה");
  assert.equal(listLinkText(true, "מצב נורית"), "רשימה: מצב נורית");
  assert.equal(listLinkText(false, null), "רשימה: מותאמת לשדה");
  assert.equal(listLinkText(true, null), "רשימה: " + EDITOR_COPY_PENDING.listUnnamed);
  assert.equal(notesModeAria("חובה בכשל"), "הערות: חובה בכשל");
  assert.equal(noteMaxText(2000), "עד 2000 תווים");
  assert.equal(noteMaxAria(1000), "אורך מרבי להערה: 1000 תווים");
  assert.equal(noteMaxOptionText(1000, true), "1000 תווים · ברירת מחדל");
  assert.equal(noteMaxOptionText(500, false), "500 תווים");
  assert.equal(requiredAria("בדיקת בידוד"), "שדה חובה: בדיקת בידוד");
  assert.equal(targetChipText("מסך ×2", 3), "מסך ×2 · 3");
  assert.equal(sharedNoticeText(1, "מחשב", ["מארז מחשב"]), "השדות נשמרים במסלול 1 של מחשב ומשמשים גם ב: מארז מחשב. שינוי כאן יחול בשניהם.");
  assert.equal(sharedNoticeText(1, "מסך", ["מארז מחשב", "מארז ציוד היקפי"]), "השדות נשמרים במסלול 1 של מסך ומשמשים גם ב: מארז מחשב, מארז ציוד היקפי. " + EDITOR_COPY_PENDING.sharedAll);
});
