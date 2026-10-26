import { fillVariables } from "@/app/lib/popup-templates/schema";
import type {
  PhotoComponent, PopupTemplateConfig, TemplateComponent, TemplateStep, WeightComponent,
} from "@/app/lib/popup-templates/schema";
import type { FieldValue } from "@/app/lib/station-fields/schema";
import type { Shot } from "./stationKit";

/**
 * The state of a popup built from a template (docs/popup-templates/PLAN.md §3, step 1.3) — pure, so
 * the popup (TemplateStation.tsx), the settings preview and the tests share it: what the worker
 * filled per component, what keeps a step from going on, where the route's fields appear, and the
 * `details` the result saves (PLAN §3.5).
 */

export type TemplateRunState = {
  /** The manufacturer SKU, as scanned or typed. */
  sku: string;
  /** The reference lookup's answer; null = not looked up (yet, or the template has no lookup). */
  hasRU: boolean | null;
  /** The reference item's weight in grams; null = none. */
  refWeight: number | null;
  /** Shots per photo component. */
  photos: Record<string, Shot[]>;
  /** The measured weight per weight component, as typed. */
  weights: Record<string, string>;
  verdict: { ok: "" | "pass" | "fail"; note: string };
};

export const emptyRunState = (sku = ""): TemplateRunState => ({
  sku, hasRU: null, refWeight: null, photos: {}, weights: {}, verdict: { ok: "", note: "" },
});

/** Words of the blockers (the shell's error line), and of the saved labels. */
export const TEMPLATE_RUN_TEXT = {
  skuMissing: "יש לסרוק את מק״ט היצרן",
  photoUploading: "יש צילום שעדיין עולה — המתן לסיום ההעלאה.",
  photoFailed: "יש צילום שההעלאה שלו נכשלה — הסר אותו וצלם שוב.",
  photosMissing: (title: string, min: number) => (min === 1 ? `ב"${title}" נדרש צילום אחד לפחות` : `ב"${title}" נדרשים לפחות ${min} צילומים`),
  weightMissing: "יש להזין את המשקל שנמדד",
  verdictMissing: "יש לבחור תקין או לא תקין",
  fieldsMissing: "יש להשלים את שדות הבדיקה",
  skuLabel: "מק״ט יצרן",
  weightLabel: "משקל",
  gramUnit: "גר׳",
} as const;

/** The shots that reached storage. */
const stored = (shots: readonly Shot[] | undefined) => (shots ?? []).filter((s) => !s.uploading && !s.failed && s.objectKey);

/** A weight component's outcome: the measured number, its deviation from the reference, and
 *  whether it is within the tolerance (null while either side is unknown). */
export function weightOutcome(c: WeightComponent, refWeight: number | null, typed: string | undefined): {
  measured: number | null; diffPct: number | null; pass: boolean | null;
} {
  const text = (typed ?? "").trim();
  const measured = text === "" ? null : Number(text);
  if (measured == null || !Number.isFinite(measured) || measured < 0) return { measured: null, diffPct: null, pass: null };
  if (refWeight == null || refWeight <= 0) return { measured, diffPct: null, pass: null };
  const diffPct = (Math.abs(measured - refWeight) / refWeight) * 100;
  return { measured, diffPct, pass: diffPct <= c.tolerance_pct };
}

/** Where the route's station fields appear: the step, and the component they come before (null =
 *  at the place of the route_fields component itself). Without one, before the verdict. */
export function routeFieldsSlot(cfg: PopupTemplateConfig): { stepIndex: number; componentId: string; atComponent: boolean } | null {
  for (let i = 0; i < cfg.steps.length; i++) {
    const c = cfg.steps[i].components.find((x) => x.kind === "route_fields");
    if (c) return { stepIndex: i, componentId: c.id, atComponent: true };
  }
  for (let i = 0; i < cfg.steps.length; i++) {
    const c = cfg.steps[i].components.find((x) => x.kind === "verdict");
    if (c) return { stepIndex: i, componentId: c.id, atComponent: false };
  }
  return null;
}

/** What keeps one component from being done; null = nothing. */
function componentBlocker(c: TemplateComponent, s: TemplateRunState, station: string): string | null {
  switch (c.kind) {
    case "sku_scan":
      return c.required && !s.sku.trim() ? TEMPLATE_RUN_TEXT.skuMissing : null;
    case "photo": {
      const shots = s.photos[c.id] ?? [];
      if (shots.some((x) => x.uploading)) return TEMPLATE_RUN_TEXT.photoUploading;
      if (shots.some((x) => x.failed)) return TEMPLATE_RUN_TEXT.photoFailed;
      return stored(shots).length < c.min ? TEMPLATE_RUN_TEXT.photosMissing(fillVariables(c.title, { station }), c.min) : null;
    }
    case "weight":
      return c.required && weightOutcome(c, s.refWeight, s.weights[c.id]).measured == null ? TEMPLATE_RUN_TEXT.weightMissing : null;
    case "verdict":
      return s.verdict.ok === "" ? TEMPLATE_RUN_TEXT.verdictMissing : null;
    default:
      return null;
  }
}

/** What keeps a step from going on (its first blocker), or null. `fieldsBlocking`: the route's
 *  fields sit in this step and are not done (or not loaded). */
export function stepBlocker(step: TemplateStep, s: TemplateRunState, station: string, fieldsBlocking = false): string | null {
  for (const c of step.components) {
    const b = componentBlocker(c, s, station);
    if (b) return b;
  }
  return fieldsBlocking ? TEMPLATE_RUN_TEXT.fieldsMissing : null;
}

/** What keeps the popup from finishing (the first blocker of any step), or null. */
export function finishBlocker(cfg: PopupTemplateConfig, s: TemplateRunState, station: string, fieldsBlocking = false): string | null {
  const slot = routeFieldsSlot(cfg);
  for (let i = 0; i < cfg.steps.length; i++) {
    const b = stepBlocker(cfg.steps[i], s, station, fieldsBlocking && slot?.stepIndex === i);
    if (b) return b;
  }
  return null;
}

/**
 * The result's details (PLAN §3.5). `sku` / `hasRU` keep today's keys (the next station starts
 * from details.sku), `verdict` today's { ok, note }; every component's answer goes into
 * `components` as a FieldValue — the route fields' format, label at save time — so the item's
 * report prints it like a field. Blank answers are left out. The route's fields block is merged
 * on top by the popup (its verdict carries ok / note too).
 */
export function buildTemplateDetails(
  cfg: PopupTemplateConfig,
  ctx: { stationTypeId: number; version: number; station: string },
  s: TemplateRunState,
): Record<string, unknown> {
  const components: Record<string, FieldValue> = {};
  let hasSku = false;
  for (const c of cfg.steps.flatMap((st) => st.components)) {
    if (c.kind === "sku_scan") {
      hasSku = true;
      if (s.sku.trim()) components[c.id] = { t: "scan", label: TEMPLATE_RUN_TEXT.skuLabel, value: s.sku.trim() };
    } else if (c.kind === "photo") {
      const keys = stored(s.photos[c.id]).map((x) => x.objectKey as string);
      if (keys.length > 0) components[c.id] = photoValue(c, keys, ctx.station);
    } else if (c.kind === "weight") {
      const w = weightOutcome(c, s.refWeight, s.weights[c.id]);
      if (w.measured != null) {
        components[c.id] = { t: "number", label: TEMPLATE_RUN_TEXT.weightLabel, value: w.measured, unit: TEMPLATE_RUN_TEXT.gramUnit, in_range: w.pass };
      }
    }
  }
  return {
    station: `type-${ctx.stationTypeId}`,
    template: { v: ctx.version },
    ...(hasSku ? { sku: s.sku.trim(), hasRU: s.hasRU } : {}),
    components,
    verdict: { ok: s.verdict.ok, note: s.verdict.note },
  };
}

const photoValue = (c: PhotoComponent, photos: string[], station: string): FieldValue =>
  ({ t: "photo", label: fillVariables(c.title, { station }), photo_type: c.photo_code, photos });
