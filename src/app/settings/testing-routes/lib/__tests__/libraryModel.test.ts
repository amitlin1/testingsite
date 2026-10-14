import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoiceOption, ChoiceRowField, Field, RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import type { FieldSetJson, LibraryUseJson, OptionListJson } from "@/app/lib/station-fields/admin-types";
import {
  DEFAULT_CHECK_LIST_NAME, LibraryBodyError, agoText, copyName, copySetFields, failCount, filterByName, findDefaultCheckList,
  hasUnnamedField, libraryWriteError, linkToList, listDraftChanged, matchesName, outdatedUses, parseFieldSetJson,
  parseFieldSetsJson, parseLibraryUses, parseOptionListJson, parseOptionListSaved, parseOptionListsJson, parsePropagated,
  parseRouteIndex, parseVersionAnswer, placesOutside, relinkListInConfig, sameOptions, setCounts, setDraftDirty, setMetaText,
  setsUsingList, toneRows, usageChips, usageFullText, usageQuery,
} from "../libraryModel";
import {
  LIBRARY_COPY_PENDING, failCountText, linkedHelpText, listAlertText, listMetaText, listOptionLabel, listRowLine,
  listSummaryText, listsSegText, localOptionsTitleOf, moreUsesText, outdatedText, saveAsVersionText, setFieldsTitle,
  setFootStats, setRowLine, setsSegText, sharedImpactText, sharedListRowLabel, unsavedVersionText, updateAllText,
  usageChipLabel, usedInCellsText, willLinkHelpText,
} from "../libraryLabels";
import { DEFAULT_ROUTE_QUERY, parseRouteQuery, serializeRouteQuery } from "../routeQuery";

// ---- fixtures (artboard 8's script) ------------------------------------------------------------------
const opts = (...list: [string, ChoiceOption["tone"]][]): ChoiceOption[] =>
  list.map(([label, tone], i) => ({ id: "o_list000" + i, label, tone }));

const LED = opts(["תקין", "pass"], ["מהבהבת", "warn"], ["לא דולקת", "fail"], ["לא נבדק", "neutral"]);

const listJson = (over: Partial<OptionListJson> = {}): OptionListJson => ({
  id: 4, name: "מצב נורית", options: LED, version: 2, updated_at: "2026-10-12T08:00:00.000Z", updated_by: "noa",
  usage: { fields: 9, routes: 4 }, ...over,
});

const choice = (id: string, label: string, listId?: number, ver = 1, options: ChoiceOption[] = LED): ChoiceRowField => ({
  id, type: "choice_row", label, required: false, notes: "required_on_fail", options: options.map((o) => ({ ...o })),
  ...(listId != null ? { list_ref: { id: listId, ver } } : {}),
});

const setJson = (over: Partial<FieldSetJson> = {}): FieldSetJson => ({
  id: 11, name: "בדיקה חזותית בסיסית", fields: [choice("f_aaaaaaa1", "מצב חיצוני", 3), choice("f_aaaaaaa2", "ניקיון")],
  version: 3, created_at: "2026-10-01T08:00:00.000Z", updated_at: "2026-10-12T08:00:00.000Z", updated_by: "noa",
  usage: { cells: 9, outdated: 2 }, ...over,
});

const use = (over: Partial<LibraryUseJson> = {}): LibraryUseJson => ({
  route_id: 101, step_uid: "s_visual01", target: "item", field_id: "f_aaaaaaa1", ver: 3, in: "draft",
  kit_desc: "מארז עמדת עבודה", station_label: "בדיקה ויזואלית", item_label: "מחשב", ...over,
});

// ---- the wire ----------------------------------------------------------------------------------------
test("an option list and a field set from the wire are checked, their options / fields through the shape check", () => {
  const l = listJson();
  assert.deepEqual(parseOptionListJson(JSON.parse(JSON.stringify(l))), l);
  assert.deepEqual(parseOptionListsJson([l, l]).length, 2);
  const s = setJson();
  assert.deepEqual(parseFieldSetJson(JSON.parse(JSON.stringify(s))), s);
  assert.deepEqual(parseFieldSetsJson([]), []);
  assert.throws(() => parseOptionListJson({ ...l, id: 0 }), LibraryBodyError);
  assert.throws(() => parseOptionListJson({ ...l, usage: { fields: 1 } }), LibraryBodyError);
  assert.throws(() => parseOptionListJson({ ...l, options: [{ id: "x", label: "a", tone: "pass" }] }), LibraryBodyError);
  assert.throws(() => parseFieldSetJson({ ...s, fields: [{ id: "f_bad", type: "choice_row" }] }), LibraryBodyError);
  assert.throws(() => parseFieldSetsJson({}), LibraryBodyError);
});

test("usage rows, the route index and the write answers are checked", () => {
  const u = use({ target: { item_type_id: 5 } });
  assert.deepEqual(parseLibraryUses([u]), [u]);
  assert.throws(() => parseLibraryUses([{ ...u, target: "kit" }]), LibraryBodyError);
  assert.throws(() => parseLibraryUses([{ ...u, in: "both" }]), LibraryBodyError);
  assert.deepEqual(parseRouteIndex([{ test_route_id: 1, item_type_id: 2, route_number: 1, route_steps: [3] }]), [{ test_route_id: 1, item_type_id: 2, route_number: 1 }]);
  assert.throws(() => parseRouteIndex([{ test_route_id: 1 }]), LibraryBodyError);
  assert.equal(parseVersionAnswer({ version: 4 }), 4);
  assert.deepEqual(parseOptionListSaved({ version: 3, linked: [{ route_id: 1, step_uid: "s_a", field_id: "f_b" }] }), {
    version: 3, linked: [{ route_id: 1, step_uid: "s_a", field_id: "f_b" }],
  });
  assert.throws(() => parseOptionListSaved({ version: 3 }), LibraryBodyError);
  assert.equal(parsePropagated({ updated_drafts: 0 }), 0);
  assert.throws(() => parsePropagated({}), LibraryBodyError);
});

test("a write that did not go through: conflict, in use, refused, failed", () => {
  assert.equal(libraryWriteError(409, { code: "VERSION_CONFLICT" }).kind, "conflict");
  assert.equal(libraryWriteError(409, { code: "IN_USE", error: "…" }).kind, "in_use");
  assert.equal(libraryWriteError(400, { code: "SHAPE_INVALID" }).kind, "rejected");
  assert.equal(libraryWriteError(404, null).kind, "rejected");
  assert.equal(libraryWriteError(500, null).kind, "failed");
  assert.equal(libraryWriteError(null, null).kind, "failed");
  assert.equal(libraryWriteError(409, { code: "IN_USE" }).code, "IN_USE");
});

// ---- the list pane -------------------------------------------------------------------------------------
test("the list pane's texts follow artboard 8's script", () => {
  assert.equal(setsSegText(5), "ערכות שדות · 5");
  assert.equal(listsSegText(6), "רשימות אפשרויות · 6");
  assert.equal(setRowLine(3, 9), "3 שדות · בשימוש ב-9 תאים");
  assert.equal(setRowLine(1, 1), "שדה אחד · בשימוש בתא אחד");
  assert.equal(setRowLine(0, 0), "ללא שדות");
  assert.equal(setRowLine(3, 0), "3 שדות", "unused: the count alone");
  assert.equal(listRowLine(4, 31), "4 אפשרויות · בשימוש ב-31 שדות");
  assert.equal(listRowLine(1, 1), LIBRARY_COPY_PENDING.optionsOne + " · " + LIBRARY_COPY_PENDING.usedInFieldsOne);
  assert.equal(listRowLine(4, 0), "4 אפשרויות");
  assert.equal(usedInCellsText(2), "בשימוש ב-2 תאים");
});

test("search keeps the names holding the trimmed query; an empty query keeps all", () => {
  const items = [{ name: "בדיקה חזותית בסיסית" }, { name: "בדיקת חשמל למחשב" }, { name: "Dell kit" }];
  assert.deepEqual(filterByName(items, " חשמל ").map((i) => i.name), ["בדיקת חשמל למחשב"]);
  assert.equal(filterByName(items, "").length, 3);
  assert.equal(filterByName(items, "אין כזה").length, 0);
  assert.equal(matchesName("Dell kit", "DELL"), true);
});

// ---- the set editor ---------------------------------------------------------------------------------------
test("set counts ignore section headers; 'שמירה כגרסה' waits for every name", () => {
  const fields: Field[] = [choice("f_aaaaaaa1", "a"), { id: "f_aaaaaaa2", type: "section", label: "מקטע" }, { ...choice("f_aaaaaaa3", "b"), required: true }];
  assert.deepEqual(setCounts(fields), { fields: 2, required: 1 });
  assert.equal(hasUnnamedField(fields), false);
  assert.equal(hasUnnamedField([...fields, choice("f_aaaaaaa4", "  ")]), true);
  assert.equal(setFieldsTitle(3), "שדות בערכה · 3");
  assert.equal(setFootStats(3, 1), "3 שדות · 1 חובה");
  assert.equal(setFootStats(0, 0), "ללא שדות · 0 חובה");
});

test("a set's draft is dirty only while it differs from the saved set", () => {
  const s = setJson();
  assert.equal(setDraftDirty(s, null), false);
  assert.equal(setDraftDirty(s, { name: s.name, fields: JSON.parse(JSON.stringify(s.fields)) }), false);
  assert.equal(setDraftDirty(s, { name: s.name + "!", fields: s.fields }), true);
  assert.equal(setDraftDirty(s, { name: s.name, fields: s.fields.slice(1) }), true);
  assert.equal(unsavedVersionText(4), "שינויים שלא נשמרו · יישמרו כגרסה 4");
  assert.equal(saveAsVersionText(4), "שמירה כגרסה 4");
});

test("a duplicated set: '{name} · עותק' inside 100 characters, its fields copied with ids of their own", () => {
  assert.equal(copyName("בדיקה חזותית בסיסית"), "בדיקה חזותית בסיסית · עותק");
  assert.equal(copyName("א".repeat(100)).length, 100);
  let n = 0;
  const s = setJson();
  const copy = copySetFields(s.fields, () => "f_copy000" + n++);
  assert.deepEqual(copy.map((f) => f.id), ["f_copy0000", "f_copy0001"]);
  assert.deepEqual(copy.map((f) => f.label), s.fields.map((f) => f.label));
  assert.notEqual((copy[0] as ChoiceRowField).options, (s.fields[0] as ChoiceRowField).options);
  assert.equal(s.fields[0].id, "f_aaaaaaa1", "the source is left alone");
});

test("the meta line: duplicated, created, updated — with the relative time and the user", () => {
  const now = Date.parse("2026-10-14T08:00:00.000Z");
  const s = setJson();
  assert.equal(setMetaText(s, null, now), "עודכנה לפני יומיים · noa");
  assert.equal(setMetaText(s, { kind: "duplicated", from: "תקינות אריזה" }, now), "שוכפלה מ: תקינות אריזה");
  const fresh = setJson({ version: 1, created_at: "2026-10-14T07:59:40.000Z", updated_at: "2026-10-14T07:59:40.000Z" });
  assert.equal(setMetaText(fresh, { kind: "created" }, now), "נוצרה עכשיו · noa");
  assert.equal(setMetaText({ ...fresh, updated_by: null }, null, now), "נוצרה עכשיו");
  assert.equal(setMetaText(setJson({ updated_at: "2026-10-14T07:59:59.000Z" }), null, now), "עודכנה עכשיו · noa");
});

test("relative times: artboard 8's 'עכשיו' and 'לפני יומיים', the rest COPY-PENDING", () => {
  const t = Date.parse("2026-10-14T08:00:00.000Z");
  const m = 60_000;
  assert.equal(agoText(t - 30_000, t), "עכשיו");
  assert.equal(agoText(t + 5 * m, t), "עכשיו", "a clock ahead reads as now");
  assert.equal(agoText(t - m, t), LIBRARY_COPY_PENDING.agoMinute);
  assert.equal(agoText(t - 5 * m, t), "לפני 5 דקות");
  assert.equal(agoText(t - 60 * m, t), LIBRARY_COPY_PENDING.agoHour);
  assert.equal(agoText(t - 3 * 60 * m, t), "לפני 3 שעות");
  assert.equal(agoText(t - 24 * 60 * m, t), LIBRARY_COPY_PENDING.agoDay);
  assert.equal(agoText(t - 48 * 60 * m, t), "לפני יומיים");
  assert.equal(agoText(t - 5 * 24 * 60 * m, t), "לפני 5 ימים");
});

// ---- usage ---------------------------------------------------------------------------------------------------
const ROUTES = [
  { test_route_id: 100, item_type_id: 50, route_number: 1 },   // the kit's own route
  { test_route_id: 101, item_type_id: 12, route_number: 1 },   // an item route
];
const BASE = parseRouteQuery("type=50&route=1&view=library&lib=sets&id=11");

test("a usage chip opens the cell editor on the route that holds the place", () => {
  const item = usageQuery(use(), ROUTES, BASE);
  assert.ok(item);
  assert.equal(serializeRouteQuery(item), "type=12&route=1&view=map&step=s_visual01&target=item&field=f_aaaaaaa1");
  const box = usageQuery(use({ route_id: 100, step_uid: "s_closebox", target: "box", field_id: "f_bbbbbbb1" }), ROUTES, BASE);
  assert.equal(box && serializeRouteQuery(box), "type=50&route=1&view=map&step=s_closebox&target=box&field=f_bbbbbbb1");
  const typed = usageQuery(use({ route_id: 100, target: { item_type_id: 12 }, field_id: "not-a-field-id" }), ROUTES, DEFAULT_ROUTE_QUERY);
  assert.equal(typed && serializeRouteQuery(typed), "type=50&route=1&view=map&step=s_visual01&target=item%3A12");
  assert.equal(usageQuery(use({ route_id: 999 }), ROUTES, BASE), null, "a route the list does not have");
  assert.equal(usageQuery(use({ step_uid: "bad uid" }), ROUTES, BASE), null);
});

test("usage chips: five, the same kit and station shortened, an older version marked, the rest counted", () => {
  const VIS = { kit_desc: "מארז עמדת עבודה", station_label: "בדיקה ויזואלית" };
  const uses = [
    use({ ...VIS, item_label: "מחשב" }),
    use({ ...VIS, item_label: "מסך", step_uid: "s_visual02" }),
    use({ ...VIS, item_label: "מקלדת", step_uid: "s_visual03" }),
    use({ ...VIS, item_label: "עכבר", step_uid: "s_visual04", ver: 2 }),
    use({ kit_desc: "מארז ציוד היקפי", station_label: "בדיקה ויזואלית", item_label: "מסך", step_uid: "s_visual05" }),
    use({ step_uid: "s_visual06" }), use({ step_uid: "s_visual07" }), use({ step_uid: "s_visual08" }), use({ step_uid: "s_visual09" }),
  ];
  const { chips, more } = usageChips(uses, 3, ROUTES, BASE);
  assert.deepEqual(chips.map((c) => c.text), [
    "מארז עמדת עבודה › בדיקה ויזואלית › מחשב", "… › מסך", "… › מקלדת", "… › עכבר", "מארז ציוד היקפי › בדיקה ויזואלית › מסך",
  ]);
  assert.equal(more, 4);
  assert.equal(moreUsesText(more), "+4 נוספים");
  assert.deepEqual(chips.map((c) => c.oldVersion), [null, null, null, 2, null]);
  assert.equal(chips[3].aria, "מארז עמדת עבודה › בדיקה ויזואלית › עכבר · גרסה 2");
  assert.equal(chips[0].aria, "מארז עמדת עבודה › בדיקה ויזואלית › מחשב");
  assert.equal(usageChipLabel("x", null), "x");
  assert.equal(usageFullText(use({ kit_desc: null })), "בדיקה ויזואלית › מחשב");
  assert.equal(outdatedUses(uses, 3).length, 1);
  assert.equal(outdatedText(2), "2 תאים משתמשים בגרסה קודמת של הערכה");
  assert.equal(outdatedText(1), "תא אחד משתמש בגרסה קודמת של הערכה");
  assert.equal(updateAllText(2), "עדכן את כולם (2)");
});

// ---- option lists ---------------------------------------------------------------------------------------------
test("the list detail: tone table, fail count, meta and the note", () => {
  const rows = toneRows(opts(["קיים", "pass"], ["חסר", "fail"], ["פגום", "fail"], ["הוחלף", "warn"]));
  assert.deepEqual(rows.map((r) => [r.tone, r.labels]), [["pass", ["קיים"]], ["warn", ["הוחלף"]], ["fail", ["חסר", "פגום"]], ["neutral", []]]);
  assert.equal(failCount(LED), 1);
  assert.equal(failCountText(0), "אף אחת לא נחשבת 'כשל'");
  assert.equal(failCountText(2), "2 נחשבות 'כשל'");
  assert.equal(listSummaryText(4, 1), "4 אפשרויות · אחת נחשבת 'כשל'");
  assert.equal(listMetaText(31, 4), "בשימוש ב-31 שדות · 4 אפשרויות");
  assert.equal(listOptionLabel("1", "תקין", "pass"), "1 · תקין · תקין");
  assert.equal(listAlertText(31), "שינוי ברשימה המשותפת יחול על 31 שדות לאחר פרסום. תוצאות שכבר נשמרו לא ישתנו.");
});

test("'בערכות שדות': the sets with fields linked to the list, and how many", () => {
  const sets = [
    setJson({ id: 1, name: "בדיקת חשמל למחשב", fields: [choice("f_a0000001", "נורית מתח", 4), choice("f_a0000002", "x")] }),
    setJson({ id: 2, name: "התאמת מסך", fields: [choice("f_a0000003", "נורית מתח", 4), choice("f_a0000004", "y", 4)] }),
    setJson({ id: 3, name: "אחרת", fields: [choice("f_a0000005", "z", 9)] }),
  ];
  assert.deepEqual(setsUsingList(sets, 4), [{ id: 1, name: "בדיקת חשמל למחשב", count: 1 }, { id: 2, name: "התאמת מסך", count: 2 }]);
  assert.deepEqual(setsUsingList(sets, 77), []);
});

test("the popover's shared mode: impact note, help lines, rows", () => {
  assert.equal(sharedImpactText(9, 4), "שינוי ברשימה המשותפת יחול על 9 שדות ב-4 מסלולים לאחר פרסום. תוצאות שכבר נשמרו לא ישתנו.");
  assert.equal(sharedImpactText(31, 0), "שינוי ברשימה המשותפת יחול על 31 שדות לאחר פרסום. תוצאות שכבר נשמרו לא ישתנו.");
  assert.equal(sharedImpactText(1, 1), "שינוי ברשימה המשותפת יחול על שדה אחד" + LIBRARY_COPY_PENDING.inRoutesOne + " לאחר פרסום. תוצאות שכבר נשמרו לא ישתנו.");
  assert.equal(linkedHelpText(2), "מקושר לשדה הזה · גרסה 2");
  assert.equal(willLinkHelpText("נורית מתח"), "בלחיצה על \"החל על השדה\" נורית מתח תקושר לרשימה הזו");
  assert.equal(sharedListRowLabel("מצב נורית", 9), "מצב נורית · בשימוש ב-9 שדות");
  assert.equal(localOptionsTitleOf(["חשמל", "מחשב"]), "אפשרויות מקומיות · חשמל · מחשב");
  assert.equal(localOptionsTitleOf(["בדיקה חזותית בסיסית", ""]), "אפשרויות מקומיות · בדיקה חזותית בסיסית");
});

test("a list's working copy: changed when its name or options differ", () => {
  const l = listJson();
  assert.equal(listDraftChanged(l, { name: l.name, options: LED.map((o) => ({ ...o })) }), false);
  assert.equal(listDraftChanged(l, { name: "אחר", options: LED }), true);
  assert.equal(listDraftChanged(l, { name: l.name, options: [...LED].reverse() }), true);
  assert.equal(sameOptions(LED, LED.map((o, i) => (i === 1 ? { ...o, tone: "fail" as const } : o))), false);
});

test("linking a field copies the list's options and sets list_ref", () => {
  const f = choice("f_cccccccc", "נורית מתח");
  const linked = linkToList(f, { id: 4, version: 3, options: LED });
  assert.deepEqual(linked.list_ref, { id: 4, ver: 3 });
  assert.deepEqual(linked.options, LED);
  assert.notEqual(linked.options[0], LED[0]);
  assert.equal(f.list_ref, undefined, "the input is left alone");
});

test("a saved list reaches the linked fields of a working copy; others and up-to-date ones are left alone", () => {
  const NEW = opts(["תקין", "pass"], ["לא דולקת", "fail"]);
  const cfg: RouteFieldsConfig = {
    schema: 1,
    steps: {
      s_elec0001: {
        uid: "s_elec0001", station_type_id: 12, station_label: "חשמל", scope: "item",
        groups: [{ target: "item", fields: [choice("f_d0000001", "נורית מתח", 4, 2), choice("f_d0000002", "אחר", 5, 1), choice("f_d0000003", "מקומי")] }],
      },
      s_visu0001: {
        uid: "s_visu0001", station_type_id: 14, station_label: "בדיקה ויזואלית", scope: "item",
        groups: [{ target: "item", fields: [choice("f_d0000004", "נורית", 4, 3, NEW)] }],
      },
    },
  };
  const changed = relinkListInConfig(cfg, { id: 4, version: 3, options: NEW });
  assert.equal(changed, 1, "the second one is already on version 3 with these options");
  const f1 = cfg.steps.s_elec0001.groups[0].fields[0] as ChoiceRowField;
  assert.deepEqual(f1.list_ref, { id: 4, ver: 3 });
  assert.deepEqual(f1.options, NEW);
  assert.deepEqual((cfg.steps.s_elec0001.groups[0].fields[1] as ChoiceRowField).list_ref, { id: 5, ver: 1 });
  assert.equal((cfg.steps.s_elec0001.groups[0].fields[2] as ChoiceRowField).list_ref, undefined);
  assert.equal(relinkListInConfig(cfg, { id: 4, version: 3, options: NEW }), 0, "a second pass changes nothing");
  const places = [{ route_id: 1, step_uid: "s_a", field_id: "f_a" }, { route_id: 2, step_uid: "s_b", field_id: "f_b" }];
  assert.deepEqual(placesOutside(places, new Set([1])), [places[1]]);
});

test("the default check row's list is the one named 'תקינות כללית'", () => {
  assert.equal(DEFAULT_CHECK_LIST_NAME, "תקינות כללית");
  const lists = [listJson(), listJson({ id: 1, name: "תקינות כללית" })];
  assert.equal(findDefaultCheckList(lists)?.id, 1);
  assert.equal(findDefaultCheckList([listJson()]), null);
  assert.equal(findDefaultCheckList(null), null);
});
