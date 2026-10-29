import { componentsOf } from "@/app/lib/popup-templates/schema";
import type { PopupTemplateConfig, TemplateStep, WeightComponent } from "@/app/lib/popup-templates/schema";
import type { Drafts } from "@/app/lib/station-fields/evaluate";
import type { RefSource } from "./packageReference";
import type { RefImg } from "./stationKit";
import { emptyRunState, savedComponents, storedPhotoKeys, weightOutcome, type TemplateRunState } from "./templateModel";

/**
 * The package base's opening, run from a template (docs/popup-templates/PLAN.md §5, step 2.2) —
 * pure, so the popup (TemplatePackageOpening.tsx) and the tests share it. The box's steps are the
 * template's steps; the "items" step runs every item through the template's item_flow. What the
 * results save keeps today's keys exactly (PLAN §5.2): packages/read.ts, the report and the
 * server read them. Each result adds `template.v` and `components`, as in the item base.
 */

/** A box step: one of the opening's system parts (alone in its step), or the admin's components. */
export type OpeningStepKind = "contents" | "items" | "labels" | "components";

export function openingStepKind(step: TemplateStep): OpeningStepKind {
  const only = step.components.length === 1 ? step.components[0].kind : null;
  return only === "contents" || only === "items" || only === "labels" ? only : "components";
}

/** The step's message components, as the wizard's instruction band; null = none. */
export function bandOf(step: TemplateStep, fill: (text: string) => string): string | null {
  const texts = step.components.flatMap((c) => (c.kind === "message" ? [fill(c.text).trim()] : [])).filter(Boolean);
  return texts.length > 0 ? texts.join(" ") : null;
}

/** "סריקה, צילום ושקילה" — titles as a Hebrew list. */
export function hebrewList(titles: readonly string[]): string {
  const t = titles.map((x) => x.trim()).filter(Boolean);
  return t.length <= 1 ? t.join("") : `${t.slice(0, -1).join(", ")} ו${t[t.length - 1]}`;
}

/** The items step's line under its title, from the item flow's phases — the wizard's own words
 *  when the flow is today's (scan, photo, weigh). */
export function itemsLine(flow: readonly TemplateStep[], fill: (text: string) => string): string {
  const list = hebrewList(flow.map((p) => fill(p.title)));
  return list ? `כל פריט עובר ${list}. אפשר לעבוד בכל סדר.` : "אפשר לעבוד בכל סדר.";
}

/** One item's work at the opening: what the worker filled in its flow (`run.sku` is the scan as
 *  typed), and the reference it is compared against, resolved when its scan is left. */
export type OpeningItemWork = {
  run: TemplateRunState;
  /** The SKU the reference below was resolved for; null until then. */
  sku: string | null;
  /** The reference's images, by photo group (photo_types.code). */
  refImages: RefImg[];
  refSource: RefSource | null;
  expectedSku: string | null;
  done: boolean;
  /** The item's station-field drafts, by FieldId (empty without a config). */
  fields: Drafts;
};

export const freshItemWork = (scan = ""): OpeningItemWork => ({
  run: emptyRunState(scan), sku: null, refImages: [], refSource: null, expectedSku: null, done: false, fields: {},
});

/** Today's `weight` key: the flow's first weight component against the item's reference, or null
 *  while either side is missing. */
export type SavedWeight = { reference: number; measured: number; diffPct: number; pass: boolean } | null;

const flowComponents = (flow: readonly TemplateStep[]) => flow.flatMap((p) => p.components);

/** The item's saved weight, and whether it passes: not failed by its verdict, and no measured
 *  weight outside its tolerance. */
export function itemOutcome(flow: readonly TemplateStep[], run: TemplateRunState): { weight: SavedWeight; pass: boolean } {
  const weights = flowComponents(flow).filter((c): c is WeightComponent => c.kind === "weight");
  const outcomes = weights.map((c) => weightOutcome(c, run.refWeight, run.weights[c.id]));
  const first = outcomes[0];
  const weight = first && first.measured != null && first.diffPct != null && first.pass != null && run.refWeight != null
    ? { reference: run.refWeight, measured: first.measured, diffPct: Number(first.diffPct.toFixed(1)), pass: first.pass }
    : null;
  return { weight, pass: run.verdict.ok !== "fail" && outcomes.every((o) => o.pass !== false) };
}

/** The box passes on its verdict ("האריזה תקינה?"); a template without one has nothing to fail it. */
export function boxPasses(cfg: PopupTemplateConfig, box: TemplateRunState): boolean {
  return componentsOf(cfg).some((c) => c.kind === "verdict") ? box.verdict.ok === "pass" : true;
}

/** An item's result details at the opening (today's keys, PackageOpenWizard). */
export function buildOpeningItemDetails(
  flow: readonly TemplateStep[],
  ctx: { version: number; station: string; packageId: string },
  w: OpeningItemWork,
): Record<string, unknown> {
  const comps = flowComponents(flow);
  return {
    sku: w.sku, hasRU: w.run.hasRU, expectedSku: w.expectedSku, refSource: w.refSource,
    weight: itemOutcome(flow, w.run).weight,
    product: { ok: w.run.verdict.ok, note: w.run.verdict.note, photos: storedPhotoKeys(comps, w.run) },
    package_id: ctx.packageId, opening: true,
    template: { v: ctx.version },
    components: savedComponents(comps, w.run, ctx.station),
  };
}

/** The box's result details at the opening (today's keys, PackageOpenWizard). `box.hasRU` is the
 *  box label's lookup. */
export function buildOpeningBoxDetails(
  cfg: PopupTemplateConfig,
  ctx: { version: number; station: string },
  box: TemplateRunState,
  facts: {
    packageReference: { referenceItemId: number | null; members: number } | null;
    itemCount: number; registeredCount: number; templateCount: number; labelsPrinted: boolean; packageItemIds: string[];
  },
): Record<string, unknown> {
  const comps = componentsOf(cfg);
  return {
    sku: box.sku.trim(), hasRU: box.hasRU,
    packageReference: facts.packageReference,
    pkg: { ok: box.verdict.ok, note: box.verdict.note, photos: storedPhotoKeys(comps, box) },
    itemCount: facts.itemCount, registeredCount: facts.registeredCount, templateCount: facts.templateCount, labelsPrinted: facts.labelsPrinted,
    packageItemIds: facts.packageItemIds, opening: true,
    template: { v: ctx.version },
    components: savedComponents(comps, box, ctx.station),
  };
}

// ---- the closing (step 2.3) ---------------------------------------------------------

/** A closing step: the arrival and packing (its system part, alone in its step), or the admin's
 *  components. */
export function closingStepKind(step: TemplateStep): "arrival" | "components" {
  return step.components.length === 1 && step.components[0].kind === "arrival" ? "arrival" : "components";
}

/** Today's `checks`: every checklist row over the template's steps, ticked or not. */
export function closingChecks(cfg: PopupTemplateConfig, box: TemplateRunState): { label: string; ok: boolean }[] {
  return componentsOf(cfg).flatMap((c) => (c.kind === "checklist"
    ? c.items.map((row) => ({ label: row.label, ok: (box.checks[c.id] ?? []).includes(row.id) }))
    : []));
}

/** Today's `note` (and the result's comment): the first notes component's text. */
export function closingNote(cfg: PopupTemplateConfig, box: TemplateRunState): string {
  const notes = componentsOf(cfg).find((c) => c.kind === "notes");
  return notes ? box.notes[notes.id] ?? "" : "";
}

/** The box passes when no item is "חסר במארז" — as today — and its verdict, when the template asks
 *  one, is not a fail. */
export function closingPasses(cfg: PopupTemplateConfig, box: TemplateRunState, anyMissing: boolean): boolean {
  const asks = componentsOf(cfg).some((c) => c.kind === "verdict");
  return !anyMissing && !(asks && box.verdict.ok === "fail");
}

/** The box's result details at the closing (today's keys, PackageCloseWizard). `box.hasRU` is the
 *  box label's lookup; `verdict` only when the template asks one. */
export function buildClosingBoxDetails(
  cfg: PopupTemplateConfig,
  ctx: { version: number; station: string },
  box: TemplateRunState,
  facts: { packed: string[]; decisions: unknown[] },
): Record<string, unknown> {
  const comps = componentsOf(cfg);
  return {
    sku: box.sku.trim(), hasRU: box.hasRU, closing: true,
    checks: closingChecks(cfg, box), note: closingNote(cfg, box),
    packed: facts.packed, decisions: facts.decisions,
    ...(comps.some((c) => c.kind === "verdict") ? { verdict: { ok: box.verdict.ok, note: box.verdict.note } } : {}),
    template: { v: ctx.version },
    components: savedComponents(comps, box, ctx.station),
  };
}
