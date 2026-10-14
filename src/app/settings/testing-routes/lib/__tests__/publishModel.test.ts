import { test } from "node:test";
import assert from "node:assert/strict";
import type { Change } from "@/app/lib/station-fields/diff";
import type { FieldsContextJson, PublishImpactJson, PublishImpactRouteJson } from "@/app/lib/station-fields/admin-types";
import { KIT_ROUTE_LABEL, routeOfTypeLabel } from "@/app/lib/station-fields/labels";
import { EMPTY_DRAFT_MODEL, currentConfigs, draftReducer, summarize } from "../draftModel";
import { buildFieldsMap } from "../mapModel";
import { COPY_PENDING, routeOptionText } from "../labels";
import {
  PUBLISH_COPY_PENDING, countTagsText, filledWarnText, infoNoteText, publishButtonText, publishTitleText,
  publishedSnackText, replacesVersionText, scopeLabelText, scopeNewSubText, scopePendingSubText, scopePendingTitleText,
  setFilledText,
} from "../publishLabels";
import {
  buildPublishGroups, contextKitId, errorCode, fromSetIds, groupLines, ownRouteId, parsePublishImpact, parsePublishResult,
  parseSetNames, pendingVersion, previewRequestBody, publishRequestBody, publishVersion, publishedVersionOf, sharedNoteText,
} from "../publishModel";
import { KIT_A, KIT_B, MON, PC, artboard1, wire } from "./fixtures";

// ---- artboard 10's batch, on the kit of artboard 1 -----------------------------------------------------
// Kit route 100 (פתיחת מארז s_kitopen1, סגירת מארז s_kitclos1), the computer's route 101 (חשמל
// s_pcelec00) and the screen's route 102 (מכניקה s_momech00) — the four groups artboard 10 draws.

const ch = (c: Partial<Change> & Pick<Change, "route_id" | "step_uid" | "kind" | "label">): Change => ({ target: "item", ...c });

function artboard10Impact(): PublishImpactJson {
  const kit: PublishImpactRouteJson = {
    route_id: 100, label: KIT_ROUTE_LABEL, item_type_id: KIT_A.package_type_id, item_type_desc: KIT_A.desc, route_number: 1,
    from_version: 4, to_version: 5,
    changes: [
      // A field set (id 9) filled the four package-level cells of the closing station.
      ch({ route_id: 100, step_uid: "s_kitclos1", target: "box", kind: "field_added", field_id: "f_set00001", label: "קבלה 1", detail: { from_set: "9:2" } }),
      ch({ route_id: 100, step_uid: "s_kitclos1", target: "box", kind: "field_added", field_id: "f_set00002", label: "קבלה 2", detail: { from_set: "9:2" } }),
      ch({ route_id: 100, step_uid: "s_kitclos1", target: "each_item", kind: "field_added", field_id: "f_set00001", label: "קבלה 1", detail: { from_set: "9:2" } }),
      ch({ route_id: 100, step_uid: "s_kitclos1", target: { item_type_id: PC }, kind: "field_added", field_id: "f_set00001", label: "קבלה 1", detail: { from_set: "9:2" } }),
      ch({ route_id: 100, step_uid: "s_kitclos1", target: { item_type_id: MON }, kind: "field_added", field_id: "f_set00001", label: "קבלה 1", detail: { from_set: "9:2" } }),
      // The opening station's layout (phase 3) — listed first, drawn last.
      ch({ route_id: 100, step_uid: "s_kitopen1", target: "box", kind: "layout_changed", label: "פתיחת מארז" }),
    ],
  };
  const pc: PublishImpactRouteJson = {
    route_id: 101, label: routeOfTypeLabel(1, "מחשב"), item_type_id: PC, item_type_desc: "מחשב", route_number: 1,
    from_version: 2, to_version: 3,
    changes: [
      ch({ route_id: 101, step_uid: "s_pcelec00", kind: "field_added", field_id: "f_isolate1", label: "בדיקת בידוד" }),
      ch({ route_id: 101, step_uid: "s_pcelec00", kind: "field_changed", field_id: "f_fan00001", label: "מאוורר ספק הכוח", detail: { option_added: "רעש חריג" } }),
    ],
  };
  const mon: PublishImpactRouteJson = {
    route_id: 102, label: routeOfTypeLabel(1, "מסך"), item_type_id: MON, item_type_desc: "מסך ", route_number: 1,
    from_version: 2, to_version: 3,
    changes: [
      ch({ route_id: 102, step_uid: "s_momech00", kind: "field_changed", field_id: "f_stand001", label: "ציר המעמד", detail: { required: true } }),
      ch({ route_id: 102, step_uid: "s_momech00", kind: "field_removed", field_id: "f_vesa0001", label: "ברגי VESA", filled_count: 38 }),
    ],
  };
  return {
    // Item routes first, as the server may order them: the dialog orders by the map.
    routes: [mon, kit, pc],
    totals: { changes: 10, stations: 3, routes: 3 },
    shared_outside: [
      { route_id: 102, item_type_desc: "מסך", route_number: 1, kits: [KIT_B] },
      { route_id: 101, item_type_desc: "מחשב", route_number: 1, kits: [{ package_type_id: 70, desc: "מארז מחשב" }] },
    ],
    items_on_routes: 9,
    by_version: [{ route_id: 100, version: 4, count: 9 }],
    not_reached: 4,
    issues: [],
    base_revs: { 100: 7, 101: 4, 102: 3 },
  };
}

function mapOf(ctx: FieldsContextJson) {
  const model = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  return buildFieldsMap({ context: ctx, configs: currentConfigs(model), issues: summarize(model).issuesByRoute });
}

test("artboard 10: the groups of 'מה השתנה' — map order, titles, subs, shared, counts, lines", () => {
  const ctx = artboard1();
  const groups = buildPublishGroups({ impact: artboard10Impact(), context: ctx, map: mapOf(ctx), setNames: { 9: "קבלת פריט במארז" } });
  assert.deepEqual(groups.map((g) => [g.title, g.sub, g.shared, g.count]), [
    ["חשמל · מחשב", "מסלול 1 של מחשב", true, "2 שינויים"],
    ["מכניקה · מסך", "מסלול 1 של מסך", true, "2 שינויים"],
    ["סגירת מארז", "מסלול המארז", false, "שינוי אחד"],
    ["פריסת החלון · פתיחת מארז", "מסלול המארז", false, "שינוי אחד"],
  ]);
  assert.deepEqual(groups.map((g) => g.lines.map((l) => [l.badge, l.text, l.warn])), [
    [["add", "נוסף 'בדיקת בידוד'", null], ["edit", "'מאוורר ספק הכוח': נוספה אפשרות 'רעש חריג'", null]],
    [["edit", "'ציר המעמד' סומן כחובה", null], ["del", "נמחק 'ברגי VESA'", "מולא ב-38 בדיקות, הערכים יישמרו בהיסטוריה"]],
    [["add", "4 תאים מולאו מהערכה 'קבלת פריט במארז'", null]],
    // The layout row has no wording of its own yet (COPY-PENDING): the badge and the station's name.
    [["edit", "'פתיחת מארז'", null]],
  ]);
  assert.deepEqual(groups.map((g) => g.key), ["101:s_pcelec00", "102:s_momech00", "100:s_kitclos1", "100:s_kitopen1:layout"]);
});

test("groups without the map fall back to the route's steps, and a removed step keeps its name", () => {
  const ctx = artboard1();
  const impact = artboard10Impact();
  impact.routes[2].changes.push(ch({ route_id: 101, step_uid: "s_gone0000", target: "item", kind: "step_removed", label: "בדיקה ישנה" }));
  const groups = buildPublishGroups({ impact, context: ctx, map: null });
  // Route order (mon, kit, pc), then the position on the route; layout groups last.
  assert.deepEqual(groups.map((g) => g.title), [
    "מכניקה · מסך", "סגירת מארז", "חשמל · מחשב", "בדיקה ישנה · מחשב", "פריסת החלון · פתיחת מארז",
  ]);
  assert.deepEqual(groups[3].lines, [{ badge: "del", text: "'בדיקה ישנה'", warn: null }]);
  // No set name: the COPY-PENDING line without it.
  assert.equal(groups[1].lines[0].text, "4 תאים מולאו" + PUBLISH_COPY_PENDING.setFilledUnnamed);
});

test("a single item route's screen: the item route's groups carry the item", () => {
  const ctx = artboard1();
  const itemCtx: FieldsContextJson = { ...ctx, kind: "item", subject: { item_type_id: PC, desc: "מחשב", is_package: false, route_number: 1 }, kit: null, item: ctx.lines[0].route, lines: [] };
  const impact = artboard10Impact();
  const pc = impact.routes[2];
  const groups = buildPublishGroups({ impact: { routes: [pc], shared_outside: [] }, context: itemCtx, map: mapOf(itemCtx) });
  assert.deepEqual(groups.map((g) => [g.title, g.sub, g.shared]), [["חשמל · מחשב", "מסלול 1 של מחשב", false]]);
  assert.equal(contextKitId(itemCtx), null);
  assert.equal(ownRouteId(itemCtx), 101);
});

test("groupLines: generic rows once per field and cell, removals without fills, sets of one cell", () => {
  const base = { route_id: 1, step_uid: "s_aaaaaaaa" } as const;
  const lines = groupLines([
    ch({ ...base, kind: "field_changed", field_id: "f_a", label: "שם חדש", detail: { renamed_from: "שם ישן" } }),
    ch({ ...base, kind: "field_changed", field_id: "f_a", label: "שם חדש", detail: { moved: true } }),
    ch({ ...base, kind: "field_changed", field_id: "f_a", label: "שם חדש", detail: { required: false } }),
    ch({ ...base, kind: "field_changed", field_id: "f_a", label: "שם חדש", detail: { required: true } }),
    ch({ ...base, kind: "field_changed", field_id: "f_b", label: "אחר", detail: { option_removed: "x" } }),
    ch({ ...base, kind: "field_removed", field_id: "f_c", label: "ריק" }),
    ch({ ...base, kind: "field_removed", field_id: "f_d", label: "פעם", filled_count: 1 }),
    ch({ ...base, kind: "field_removed", field_id: "f_e", label: "אפס", filled_count: 0 }),
    ch({ ...base, kind: "field_added", field_id: "f_f", label: "מערכה", detail: { from_set: "3:1" } }),
    ch({ ...base, kind: "field_added", field_id: "f_g", label: "מערכה 2", detail: { from_set: "3:1" } }),
    ch({ ...base, kind: "field_added", field_id: "f_h", label: "חדש", detail: { from_set: "" } }),
  ], { 3: "בסיסית" });
  assert.deepEqual(lines.map((l) => [l.badge, l.text, l.warn]), [
    ["edit", "'שם חדש'", null],
    ["edit", "'שם חדש' סומן כחובה", null],
    ["edit", "'אחר'", null],
    ["del", "נמחק 'ריק'", null],
    ["del", "נמחק 'פעם'", PUBLISH_COPY_PENDING.filledOnce],
    ["del", "נמחק 'אפס'", null],
    ["add", PUBLISH_COPY_PENDING.setFilledOneCell + " מהערכה 'בסיסית'", null],
    ["add", "נוסף 'חדש'", null],
  ]);
});

test("the dialog's version: the route on screen, else the newest of the batch", () => {
  const impact = artboard10Impact();
  assert.deepEqual(publishVersion(impact, 100), { version: 5, fromVersion: 4 });
  assert.deepEqual(publishVersion({ routes: [impact.routes[0], impact.routes[2]] }, 100), { version: 3, fromVersion: 2 });
  assert.equal(publishVersion({ routes: [] }, 100), null);
  assert.equal(ownRouteId(artboard1()), 100);
  assert.equal(contextKitId(artboard1()), KIT_A.package_type_id);
});

test("pendingVersion: the store's guess before the preview answers", () => {
  const ctx = artboard1();
  let model = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  // Only the computer's route (published 2) has a draft.
  assert.equal(pendingVersion(model, 100), 3);
  model = draftReducer(model, { type: "edit", routeId: 100, mutate: (cfg) => { delete cfg.steps.s_kitclos1; } });
  // The kit route (published 3) now has one: it names the dialog.
  assert.equal(pendingVersion(model, 100), 4);
  assert.equal(pendingVersion(draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: wire({ ...ctx, lines: [] }) }), 100), null);
});

test("the head: title, count tags, the version it replaces, the button", () => {
  const ctx = artboard1();
  assert.equal(publishTitleText(5, routeOptionText(ctx.subject.desc, ctx.subject.route_number)), "פרסום גרסה 5 · מארז עמדת עבודה · מסלול 1");
  assert.deepEqual(countTagsText({ changes: 6, stations: 3, routes: 3 }), ["6 שינויים", "3 עמדות", "3 מסלולים"]);
  assert.deepEqual(countTagsText({ changes: 1, stations: 1, routes: 1 }), ["שינוי אחד", COPY_PENDING.stationsOne, COPY_PENDING.routesOne]);
  assert.equal(replacesVersionText(4), "מחליפה את גרסה 4 המפורסמת");
  assert.equal(replacesVersionText(0), null);
  assert.equal(publishButtonText(5), "פרסם גרסה 5");
  assert.equal(publishedSnackText(5), "גרסה 5 פורסמה");
});

test("the warning note: artboard 10's sentence, one kit per route, and the COPY-PENDING forms", () => {
  const ctx = artboard1();
  assert.equal(
    sharedNoteText(artboard10Impact(), ctx),
    "השינויים יחולו גם מחוץ למארז הזה: מסלול 1 של מסך משמש גם ב'מארז ציוד היקפי', ומסלול 1 של מחשב משמש גם ב'מארז מחשב'.",
  );
  assert.equal(sharedNoteText({ shared_outside: [] }, ctx), null);
  const three = { shared_outside: [
    { route_id: 1, item_type_desc: "א", route_number: 1, kits: [{ package_type_id: 1, desc: "ק1" }, { package_type_id: 2, desc: "ק2" }, { package_type_id: 3, desc: "ק3" }] },
    { route_id: 2, item_type_desc: "ב", route_number: 2, kits: [{ package_type_id: 1, desc: "ק1" }] },
    { route_id: 3, item_type_desc: "ג", route_number: 3, kits: [{ package_type_id: 1, desc: "ק1" }] },
  ] };
  assert.equal(
    sharedNoteText(three, ctx),
    "השינויים יחולו גם מחוץ למארז הזה: מסלול 1 של א משמש גם ב'ק1', ב'ק2' וב'ק3', מסלול 2 של ב משמש גם ב'ק1', ומסלול 3 של ג משמש גם ב'ק1'.",
  );
  const itemCtx: FieldsContextJson = { ...ctx, kind: "item" };
  assert.equal(sharedNoteText({ shared_outside: [three.shared_outside[1]] }, itemCtx), PUBLISH_COPY_PENDING.sharedLeadItemRoute + "מסלול 2 של ב משמש גם ב'ק1'.");
});

test("the info note and the scope cards: artboard 10's two texts", () => {
  const v = { items: 9, notReached: 4, version: 5, fromVersion: 4 };
  assert.equal(infoNoteText({ ...v, pending: false }),
    "9 פריטים נמצאים כעת במסלולים האלה. הם ימשיכו לפי גרסה 4 עד סוף המסלול; פריטים שייקלטו מעכשיו יקבלו גרסה 5.");
  assert.equal(infoNoteText({ ...v, pending: true }),
    "9 פריטים נמצאים כעת במסלולים האלה. 4 מהם, שטרם הגיעו לעמדה ששונתה, יעברו לגרסה 5 בעמדה הבאה שלהם; 5 האחרים ימשיכו לפי גרסה 4 עד סוף המסלול. פריטים שייקלטו מעכשיו יקבלו גרסה 5.");
  assert.equal(scopeLabelText(5), "על מי תחול גרסה 5");
  assert.equal(scopeNewSubText(4), "פריטים שכבר בדרך ממשיכים לפי גרסה 4 עד סוף המסלול");
  assert.equal(scopePendingTitleText(4), "גם לפריטים שטרם הגיעו לעמדה ששונתה · 4 פריטים");
  assert.equal(scopePendingSubText(5), "יעברו לגרסה 5 בעמדה הבאה שלהם; תוצאות שכבר נשמרו לא ישתנו");
});

test("the info note's COPY-PENDING forms: none, one, all moving, nothing moving, a first publish", () => {
  const tail = "פריטים שייקלטו מעכשיו יקבלו גרסה 5.";
  assert.equal(infoNoteText({ pending: true, items: 0, notReached: 0, version: 5, fromVersion: 4 }), PUBLISH_COPY_PENDING.noItemsHead + " " + tail);
  assert.equal(infoNoteText({ pending: false, items: 1, notReached: 1, version: 5, fromVersion: 4 }),
    PUBLISH_COPY_PENDING.oneItemHead + " הוא ימשיך לפי גרסה 4 עד סוף המסלול; " + tail);
  assert.equal(infoNoteText({ pending: true, items: 1, notReached: 1, version: 5, fromVersion: 4 }),
    PUBLISH_COPY_PENDING.oneItemHead + " " + PUBLISH_COPY_PENDING.onlyItemMovesPrefix + "5 בעמדה הבאה שלו. " + tail);
  // Nothing to move: the pending note is the new one.
  assert.equal(infoNoteText({ pending: true, items: 9, notReached: 0, version: 5, fromVersion: 4 }),
    infoNoteText({ pending: false, items: 9, notReached: 0, version: 5, fromVersion: 4 }));
  assert.equal(infoNoteText({ pending: true, items: 3, notReached: 3, version: 5, fromVersion: 4 }),
    "3 פריטים נמצאים כעת במסלולים האלה. 3 מהם, שטרם הגיעו לעמדה ששונתה, יעברו לגרסה 5 בעמדה הבאה שלהם. " + tail);
  assert.equal(infoNoteText({ pending: true, items: 3, notReached: 1, version: 5, fromVersion: 4 }),
    "3 פריטים נמצאים כעת במסלולים האלה. " + PUBLISH_COPY_PENDING.oneMovedPrefix + "5" + PUBLISH_COPY_PENDING.oneMovedSuffix + "; 2 האחרים ימשיכו לפי גרסה 4 עד סוף המסלול. " + tail);
  assert.equal(infoNoteText({ pending: true, items: 3, notReached: 2, version: 5, fromVersion: 4 }),
    "3 פריטים נמצאים כעת במסלולים האלה. 2 מהם, שטרם הגיעו לעמדה ששונתה, יעברו לגרסה 5 בעמדה הבאה שלהם; " + PUBLISH_COPY_PENDING.oneOtherContinues + " לפי גרסה 4 עד סוף המסלול. " + tail);
  assert.equal(infoNoteText({ pending: false, items: 2, notReached: 0, version: 1, fromVersion: 0 }),
    "2 פריטים נמצאים כעת במסלולים האלה. הם ימשיכו " + PUBLISH_COPY_PENDING.noVersionPhrase + " עד סוף המסלול; פריטים שייקלטו מעכשיו יקבלו גרסה 1.");
  assert.equal(scopeNewSubText(0), "פריטים שכבר בדרך ממשיכים " + PUBLISH_COPY_PENDING.noVersionPhrase + " עד סוף המסלול");
  assert.equal(scopePendingTitleText(1), "גם לפריטים שטרם הגיעו לעמדה ששונתה · " + PUBLISH_COPY_PENDING.oneItem);
  assert.equal(filledWarnText(0), null);
  assert.equal(setFilledText(2, null), "2 תאים מולאו" + PUBLISH_COPY_PENDING.setFilledUnnamed);
});

test("requests: the preview body names the kit on screen; publish sends the previewed revs", () => {
  assert.deepEqual(previewRequestBody([100, 101], 50), { route_ids: [100, 101], context_kit_id: 50 });
  assert.deepEqual(previewRequestBody([101], null), { route_ids: [101] });
  assert.deepEqual(publishRequestBody([100, 101], { base_revs: { 100: 7, 101: 4, 102: 3 } }, "not_reached", "הערה"), {
    route_ids: [100, 101], base_revs: { 100: 7, 101: 4 }, apply_mode: "not_reached", note: "הערה",
  });
});

test("answers: the impact and the result are checked; set names and error codes are read", () => {
  const impact = wire(artboard10Impact());
  assert.deepEqual(parsePublishImpact(impact), impact);
  assert.equal(parsePublishImpact({ ...impact, totals: null }), null);
  assert.equal(parsePublishImpact({ ...impact, routes: [{ ...impact.routes[0], changes: [{ kind: "field_added" }] }] }), null);
  assert.equal(parsePublishImpact({ ...impact, base_revs: { 100: -1 } }), null);
  assert.equal(parsePublishImpact([]), null);
  assert.deepEqual(fromSetIds(impact), [9]);
  const result = { publish_batch: "b", versions: { 100: 5 }, bumped_items: 0 };
  assert.deepEqual(parsePublishResult(result), result);
  assert.equal(publishedVersionOf(parsePublishResult(wire(result)), 100), 5);
  assert.equal(publishedVersionOf({ publish_batch: "b", versions: { 101: 3, 102: 7 }, bumped_items: 2 }, 100), 7);
  assert.equal(publishedVersionOf({ publish_batch: "b", versions: {}, bumped_items: 0 }, 100), null);
  assert.equal(publishedVersionOf(null, 100), null);
  assert.equal(parsePublishResult({ versions: {} }), null);
  assert.deepEqual(parseSetNames([{ id: 9, name: " קבלת פריט במארז " }, { id: "x" }, null]), { 9: "קבלת פריט במארז" });
  assert.deepEqual(parseSetNames({ error: "no" }), {});
  assert.equal(errorCode({ error: "x", code: "DRAFT_CONFLICT" }), "DRAFT_CONFLICT");
  assert.equal(errorCode(null), null);
});
