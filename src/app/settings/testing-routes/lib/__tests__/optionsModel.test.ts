import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoiceOption, ChoiceRowField, MultiChoiceField } from "@/app/lib/station-fields/schema";
import { ID_PATTERNS } from "@/app/lib/station-fields/schema";
import { newOptionId } from "@/app/lib/station-fields/step-uids";
import { LIMITS, optionListLine } from "@/app/lib/station-fields/validate";
import {
  UNDRAWN_TEXT, localOptionsNote, localOptionsTitle, optionDragLabel, optionKeyTitle, optionListTitle, optionNameLabel,
  optionRemoveLabel, optionRowLabel, optionsCountText, toneButtonLabel,
} from "../labels";
import {
  addOption, applyLocalOptions, canAddOption, cycleOptionTone, moveOption, nextTone, optionKey, removeOption, renameOption,
} from "../optionsModel";

const opts: ChoiceOption[] = [
  { id: "o_aaaaaaa1", label: "תקין", tone: "pass" },
  { id: "o_aaaaaaa2", label: "מהבהבת", tone: "warn" },
  { id: "o_aaaaaaa3", label: "לא דולקת", tone: "fail" },
  { id: "o_aaaaaaa4", label: "לא נבדק", tone: "neutral" },
];
const labels = (list: readonly ChoiceOption[]) => list.map((o) => o.label);
let counter = 0;
const fixedId = () => "o_new0000" + (counter++ % 10);

test("the tone button cycles תקין ← אזהרה ← כשל ← ניטרלי and back", () => {
  assert.equal(nextTone("pass"), "warn");
  assert.equal(nextTone("warn"), "fail");
  assert.equal(nextTone("fail"), "neutral");
  assert.equal(nextTone("neutral"), "pass");
  const once = cycleOptionTone(opts, 0);
  assert.equal(once[0].tone, "warn");
  assert.equal(opts[0].tone, "pass", "the input list is left alone");
  assert.equal(once[1], opts[1], "other options keep their identity");
});

test("keys 1–4 reach the first four options; the fifth on has none", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 7].map(optionKey), ["1", "2", "3", "4", null, null]);
  assert.equal(optionKeyTitle(0), "מקש 1 לבחירה מהירה");
  assert.equal(optionKeyTitle(4), "אין מקש קיצור לאפשרות זו");
});

test("add: trimmed, neutral, at the end; blank text or a full list adds nothing", () => {
  const added = addOption(opts, "  חלשה ", fixedId);
  assert.equal(added.length, 5);
  assert.deepEqual({ label: added[4].label, tone: added[4].tone }, { label: "חלשה", tone: "neutral" });
  assert.equal(addOption(opts, "   ", fixedId).length, 4);
  const full = Array.from({ length: LIMITS.options }, (_, i) => ({ id: `o_full000${i % 10}`, label: "x" + i, tone: "pass" as const }));
  assert.equal(canAddOption(full), false);
  assert.equal(addOption(full, "עוד", fixedId).length, LIMITS.options);
  assert.equal(canAddOption(opts), true);
  assert.match(addOption(opts, "x", () => newOptionId())[4].id, ID_PATTERNS.option);
  assert.equal(addOption(opts, "א".repeat(80), fixedId)[4].label.length, LIMITS.optionLabel);
});

test("rename keeps the text as typed; remove and move", () => {
  assert.equal(renameOption(opts, 1, "מהבהבת ").at(1)?.label, "מהבהבת ");
  assert.deepEqual(labels(removeOption(opts, 0)), ["מהבהבת", "לא דולקת", "לא נבדק"]);
  assert.deepEqual(labels(moveOption(opts, 0, 2)), ["מהבהבת", "לא דולקת", "תקין", "לא נבדק"]);
  assert.deepEqual(labels(moveOption(opts, 3, 0)), ["לא נבדק", "תקין", "מהבהבת", "לא דולקת"]);
  assert.deepEqual(labels(moveOption(opts, 0, 9)), labels(opts), "out of range changes nothing");
  assert.deepEqual(labels(moveOption(opts, 2, 2)), labels(opts));
});

test("apply in local mode: the options, and no list link", () => {
  const linked: ChoiceRowField = {
    id: "f_aaaaaaa1", type: "choice_row", label: "נורית מתח", required: true, notes: "required_on_fail",
    options: opts, list_ref: { id: 4, ver: 2 },
  };
  const next = applyLocalOptions(linked, removeOption(opts, 3));
  assert.equal("list_ref" in next, false);
  assert.equal(next.options.length, 3);
  assert.equal(next.type, "choice_row");
  assert.equal(linked.list_ref?.id, 4, "the input field is left alone");
  const multi: MultiChoiceField = { ...linked, type: "multi_choice" };
  assert.equal(applyLocalOptions(multi, opts).type, "multi_choice");
});

test("the validation line follows artboard 4 (validate.ts optionListLine)", () => {
  assert.deepEqual(optionListLine(opts), { level: "ok", text: "4 אפשרויות · אחת נחשבת 'כשל'" });
  assert.equal(optionListLine(renameOption(opts, 2, " ")).text, "אפשרות ריקה — מלאו או הסירו");
  assert.equal(optionListLine(removeOption(opts, 2)).text, "אף אפשרות לא נחשבת 'כשל'");
});

test("artboard 4's texts", () => {
  assert.equal(optionListTitle("נורית מתח"), "אפשרויות · נורית מתח");
  assert.equal(localOptionsTitle("חשמל", "מחשב"), "אפשרויות מקומיות · חשמל · מחשב");
  assert.equal(
    localOptionsNote("נורית מתח", "מצב נורית"),
    "הועתקו מהרשימה \"מצב נורית\". שינוי כאן חל רק על נורית מתח ולא ישפיע על שדות אחרים.",
  );
  assert.equal(
    localOptionsNote("נורית מתח", null),
    UNDRAWN_TEXT.optionsCopiedFromSharedList + " שינוי כאן חל רק על נורית מתח ולא ישפיע על שדות אחרים.",
  );
  assert.equal(optionsCountText(4, true), "אפשרויות לשדה הזה · 4");
  assert.equal(optionsCountText(4, false), "אפשרויות · 4");
  assert.equal(optionRowLabel(0, "תקין", "pass"), "אפשרות 1: תקין · תקין");
  assert.equal(optionRowLabel(4, "", "neutral"), "אפשרות 5: ריקה · ניטרלי");
  assert.equal(toneButtonLabel("pass", nextTone("pass")), "סוג האפשרות: תקין. לחיצה מחליפה לאזהרה");
  assert.equal(toneButtonLabel("neutral", nextTone("neutral")), "סוג האפשרות: ניטרלי. לחיצה מחליפה לתקין");
  assert.equal(optionNameLabel(2), "שם האפשרות 3");
  assert.equal(optionDragLabel("תקין"), "גרירה לשינוי סדר: תקין");
  assert.equal(optionRemoveLabel("תקין"), "הסרת האפשרות תקין");
});
