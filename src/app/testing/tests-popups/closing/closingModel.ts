import type { PackageItemView, PackageView } from "@/app/lib/packages/contract";
import { seq2 } from "@/app/lib/packages/ids";
import type { DraftShot, FieldsEvaluation } from "@/app/lib/station-fields/evaluate";
import { fieldsGateText, missLabel } from "@/app/lib/station-fields/labels";
import type { FieldsResultBlock } from "@/app/lib/station-fields/schema";
import { PACKAGE_POPUP_TEXT } from "../boxWizard";
import type { NextStop, NextStopRow } from "../nextStation";
import type { PackDecision as RecordedDecision } from "@/app/lib/packages/rules";

/**
 * The box's closing, as both wizards run it — the code's (PackageCloseWizard) and a template's
 * (TemplatePackageClosing): pure, so the two and the tests share it.
 */

export const CLOSING_TEXT = {
  title: "סגירת מארז",
  boxScanMissing: (type: string) => `לא נמצא פריט ייחוס של ${type} עם המק״ט הזה — בדוק שזו הקופסה הנכונה`,
  boxScanFilled: "הושלם מסריקת הפתיחה",
  arrivalSubtitle: "סמן כל פריט שנארז. פריט שלא הגיע דורש החלטה מפורשת.",
  needsDecision: "נדרשת החלטה לכל פריט",
  arrivalHold: "אי אפשר לאשר תקינות אריזה לפני שכל פריט סומן כנארז או קיבל החלטה מפורשת.",
  doneNext: "סיום וחזרה לתור",
} as const;

/** The heading over the box scan's suggestions (referenceScan closingSkuSuggestions). */
export const closingSkusLabel = (pkg: Pick<PackageView, "item_type_desc">, fromOpening: boolean): string =>
  fromOpening ? "מק״ט הפתיחה" : `מק״טים מיוחסים ל־${pkg.item_type_desc}`;

/** The worker's choice for an item that did not reach the closing — in the words the box's closing
 *  result records them (packages/rules.ts reads them back). */
export type PackDecision = Exclude<RecordedDecision["decision"], "packed">;

/** An item that did not reach the closing: what the worker decided, and why. */
export type Decision = { decision: PackDecision; note: string };

/** Required fields and notes still missing over several field lists (never the same field twice). */
export function countMissing(states: readonly { ev: Pick<FieldsEvaluation, "missingRequired" | "missingNotes"> }[]): { required: number; notes: number } {
  let required = 0;
  let notes = 0;
  for (const { ev } of states) {
    required += ev.missingRequired.length;
    notes += ev.missingNotes.length;
  }
  return { required, notes };
}

/** The next button's words for what is missing (artboards 17/18 `missLabel`), or null. */
export function missText(m: { required: number; notes: number }): string | null {
  return m.required + m.notes > 0 ? missLabel(m.required, m.notes) : null;
}

/**
 * What holds the closing's finish — the steps' holds again, which the rail can skip: a shown field
 * missing (with the gate on: the server's own 422 text), or a shot not stored yet (a field's, or
 * `moreShots` the wizard takes itself). null = go.
 */
export function closingFinishHold(
  shown: readonly { ev: Pick<FieldsEvaluation, "missingRequired" | "missingNotes">; photosPending: readonly string[]; drafts: Readonly<Record<string, { photos?: DraftShot[] }>> }[],
  moreShots: readonly DraftShot[],
  gate: boolean,
): string | null {
  const missing = countMissing(shown);
  const shots = [...shown.flatMap((fx) => fx.photosPending.flatMap((id) => fx.drafts[id]?.photos ?? [])), ...moreShots];
  return (gate ? fieldsGateText(missing.required, missing.notes) : null)
    ?? (shots.length === 0 ? null : shots.some((s) => s.failed) ? PACKAGE_POPUP_TEXT.photoFailed : PACKAGE_POPUP_TEXT.photoUploading);
}

/** The arrived items marked "נארז". */
export const packedIds = (items: readonly PackageItemView[], packed: Readonly<Record<string, boolean>>): string[] =>
  items.filter((it) => it.arrived_at_closing && packed[it.item_id]).map((it) => it.item_id);

/** The decisions for the items that did not arrive. Every "נארז בכל זאת" carries `fields` when the
 *  kit has a config, filled or not (D5) — an item packed anyway has no result row of its own;
 *  "חסר במארז" carries none. */
export function decisionsOf(
  items: readonly PackageItemView[],
  decisions: Readonly<Record<string, Decision>>,
  fieldsOf: ((it: PackageItemView) => Pick<FieldsResultBlock, "fields"> & { suggested: FieldsResultBlock["verdict"]["suggested"] }) | null,
): unknown[] {
  return items.filter((it) => decisions[it.item_id]).map((it) => ({
    item_id: it.item_id, decision: decisions[it.item_id].decision, note: decisions[it.item_id].note,
    ...(fieldsOf && decisions[it.item_id].decision === "packed_anyway" ? fieldsOf(it) : {}),
  }));
}

/** An arrived item's result details at the closing; a template's add `template`. */
export function closingItemDetails(packageId: string, templateVersion: number | null, fields: FieldsResultBlock | null): Record<string, unknown> {
  return {
    closing: true, packed: true, package_id: packageId,
    ...(templateVersion != null ? { template: { v: templateVersion } } : {}),
    ...(fields ?? {}),
  };
}

/** The done step's rows. The closing is the last step of the box's route and of its items'
 *  (docs/packages/PLAN.md §4), so this is normally one "no next station" line; a route drawn
 *  otherwise names its station. */
export function closingDoneRows(
  pkg: Pick<PackageView, "item_type_desc">,
  items: readonly PackageItemView[],
  boxStop: NextStop,
  nextStops: ReadonlyMap<string, NextStop>,
): NextStopRow[] {
  return [
    { key: "box", badge: "00", label: pkg.item_type_desc, stop: boxStop },
    ...items.filter((it) => nextStops.has(it.item_id)).map((it) => ({
      key: it.item_id, badge: seq2(it.package_seq), label: it.item_type_desc, stop: nextStops.get(it.item_id)!,
    })),
  ];
}
