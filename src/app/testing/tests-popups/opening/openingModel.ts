import type { PackageItemView, PackageView } from "@/app/lib/packages/contract";
import { seq2 } from "@/app/lib/packages/ids";
import type { DraftShot, Drafts, FieldsEvaluation } from "@/app/lib/station-fields/evaluate";
import { FIELDS_UNDRAWN_TEXT, fieldsGateText } from "@/app/lib/station-fields/labels";
import type { StationFieldsState } from "@/app/testing/fields/useStationFields";
import { WORKER_UNDRAWN_TEXT } from "@/app/testing/fields/labels";
import type { RefImg } from "@/app/testing/fields/PhotoUploader";
import { PACKAGE_POPUP_TEXT } from "../boxWizard";
import type { NextStop, NextStopRow } from "../nextStation";
import type { OpeningBoxFacts } from "../packageTemplateModel";
import type { RefSource } from "@/app/lib/test-results/details";
import { emptyPhotos, shotKeys, type Photos } from "../shots";

/**
 * The box's opening, as both wizards run it — the code's (PackageOpenWizard) and a template's
 * (TemplatePackageOpening): pure, so the two and the tests share it.
 */

export const OPENING_TEXT = {
  title: "פתיחת מארז",
  contentsSubtitle: "פתח את הקופסה: סמן מה לא הגיע, הוסף מה שלא היה בתבנית, והזן סריאלי לכל פריט.",
  labelsSubtitle: "מדבקה לכל פריט — הדבק כל אחת על הפריט שלה. מדבקת המארז כבר עליו מהמשלוח (אפשר להדפיס שוב).",
  boxWaits: "ממתין לפריטי המארז",
} as const;

/** Step 1 is the opening for the box and its items alike (lib/packages/lifecycle.ts
 *  enterRoute): an item past it already has its result here. */
export const leftOpening = (it: Pick<PackageItemView, "is_finished" | "current_route_step">): boolean =>
  it.is_finished || (it.current_route_step ?? 1) > 1;

/** The box's item types, in package order: what the package reference covers. */
export function boxTypesOf(items: readonly PackageItemView[]): { id: number; desc: string; count: number }[] {
  return items.reduce<{ id: number; desc: string; count: number }[]>((acc, it) => {
    const row = acc.find((r) => r.id === it.item_type_id);
    if (row) row.count++;
    else acc.push({ id: it.item_type_id, desc: it.item_type_desc, count: 1 });
    return acc;
  }, []);
}

/** How many items the box's template foresees (each line's quantity, at least 1); without a
 *  template, as many as there are. */
export function templateCountOf(pkg: Pick<PackageView, "template_snapshot">, items: readonly unknown[]): number {
  return Array.isArray(pkg.template_snapshot)
    ? (pkg.template_snapshot as { quantity?: number }[]).reduce((n, l) => n + Math.max(1, Number(l.quantity ?? 1)), 0)
    : items.length;
}

/** The contents step's words: the band says what keeps it, or that it is saved. */
export function contentsStepText(c: { error: { text: string } | null; gap: string | null; saved: boolean }) {
  return {
    subtitle: OPENING_TEXT.contentsSubtitle,
    band: c.error ? `לא נשמר — ${c.error.text}` : c.gap ? `כדי להמשיך: ${c.gap}` : c.saved ? "התכולה נשמרה." : "הכול מולא — שמור והמשך.",
    nextLabel: c.saved ? "המשך" : "שמור והמשך",
  };
}

/**
 * What holds the opening's finish before anything is sent: a shot not stored yet (uploading, or
 * failed — a station field's shots included), the station fields not answered ("wait": what is on
 * screen stays), or their gate — artboard 14's message, for the box and the items together.
 * `fieldsStatus` null: no fields are asked here.
 */
export function openingFinishHold(
  shots: readonly DraftShot[],
  fields: readonly { fx: { ev: Pick<FieldsEvaluation, "missingRequired" | "missingNotes">; blocking: (gate: boolean) => boolean } }[],
  fieldsStatus: StationFieldsState["status"] | null,
  gateOn: boolean,
): string | "wait" | null {
  if (shots.some((sh) => sh.uploading || sh.failed)) {
    return shots.some((sh) => sh.failed) ? PACKAGE_POPUP_TEXT.photoFailed : PACKAGE_POPUP_TEXT.photoUploading;
  }
  if (fieldsStatus === "loading") return "wait";
  if (fieldsStatus === "error") return WORKER_UNDRAWN_TEXT.loadFailed;
  const blocked = fields.filter((f) => f.fx.blocking(gateOn));
  if (blocked.length === 0) return null;
  const missing = (k: "missingRequired" | "missingNotes") => (gateOn ? blocked.reduce((n, f) => n + f.fx.ev[k].length, 0) : 0);
  return fieldsGateText(missing("missingRequired"), missing("missingNotes")) ?? FIELDS_UNDRAWN_TEXT.noteTooLong;
}

/** The done step's rows: the box waits at its next (closing) station until its items come back;
 *  each item goes on to its own. An item an earlier opening sent on has no answer here: where it
 *  is now. */
export function openingDoneRows(
  pkg: Pick<PackageView, "item_type_desc">,
  items: readonly PackageItemView[],
  boxStop: NextStop,
  nextStops: ReadonlyMap<string, NextStop>,
): NextStopRow[] {
  return [
    { key: "box", badge: "00", label: pkg.item_type_desc, stop: boxStop, note: boxStop.kind === "station" ? OPENING_TEXT.boxWaits : undefined },
    ...items.map((it) => ({
      key: it.item_id,
      badge: seq2(it.package_seq),
      label: it.item_type_desc,
      stop: nextStops.get(it.item_id) ?? (it.station_name ? { kind: "station" as const, name: it.station_name } : { kind: "unknown" as const }),
    })),
  ];
}

// ---- the code's wizard (PackageOpenWizard) -------------------------------------------------------

/** The code wizard's weight tolerance; a template's weight component sets its own. */
export const TOLERANCE_PCT = 5;

/** The code wizard's weighing against the reference. B9 (an owner decision): a reference of 0 is
 *  compared here (0% → pass), where a template's weighing (templateModel weightOutcome) is not. */
export function weightResult(ref: number | null, meas: string): { diff: number; diffPct: number; pass: boolean } | null {
  if (ref == null || meas.trim() === "") return null;
  const m = Number(meas);
  if (!Number.isFinite(m)) return null;
  const diff = m - ref;
  const diffPct = ref !== 0 ? (Math.abs(diff) / ref) * 100 : 0;
  return { diff, diffPct, pass: diffPct <= TOLERANCE_PCT };
}

/** One item's work in the code wizard. */
export type ItemWork = {
  /** What is typed / scanned on the item's scan screen. */
  scan: string;
  /** The SKU the reference below was looked up by; null until scanned. */
  sku: string | null;
  photos: Photos;
  refImages: RefImg[];
  refWeight: number | null;
  hasRU: boolean | null;
  /** Where the reference came from, and the SKU the package reference expected (null: none). */
  refSource: RefSource | null;
  expectedSku: string | null;
  meas: string;
  done: boolean;
  /** The item's station-field drafts, by FieldId (route-fields; empty without a config). */
  fields: Drafts;
};

export const freshWork = (): ItemWork => ({ scan: "", sku: null, photos: emptyPhotos(), refImages: [], refWeight: null, hasRU: null, refSource: null, expectedSku: null, meas: "", done: false, fields: {} });

/** An item passes unless its verdict fails it or its weight is out of tolerance. */
export function wizardItemPasses(w: ItemWork): boolean {
  const r = weightResult(w.refWeight, w.meas);
  return w.photos.ok !== "fail" && (r == null || r.pass);
}

/** An item's result details at the code wizard's opening (packages/read.ts, the report and the
 *  server read them; a template's add `template` and `components`). */
export function wizardItemDetails(w: ItemWork, packageId: string): Record<string, unknown> {
  const r = weightResult(w.refWeight, w.meas);
  return {
    sku: w.sku, hasRU: w.hasRU, expectedSku: w.expectedSku, refSource: w.refSource,
    weight: r ? { reference: w.refWeight, measured: Number(w.meas), diffPct: Number(r.diffPct.toFixed(1)), pass: r.pass } : null,
    product: { ok: w.photos.ok, note: w.photos.note, photos: shotKeys(w.photos) },
    package_id: packageId, opening: true,
  };
}

/** The box's result details at the code wizard's opening. */
export function wizardBoxDetails(box: { sku: string; hasRU: boolean | null; photos: Photos }, facts: OpeningBoxFacts): Record<string, unknown> {
  return {
    sku: box.sku.trim(), hasRU: box.hasRU,
    packageReference: facts.packageReference,
    pkg: { ok: box.photos.ok, note: box.photos.note, photos: shotKeys(box.photos) },
    itemCount: facts.itemCount, registeredCount: facts.registeredCount, templateCount: facts.templateCount, labelsPrinted: facts.labelsPrinted,
    packageItemIds: facts.packageItemIds, opening: true,
  };
}
