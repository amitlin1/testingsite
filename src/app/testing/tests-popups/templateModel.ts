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
  /** The rows ticked per checklist component, and the text per notes component (the package base). */
  checks: Record<string, string[]>;
  notes: Record<string, string>;
};

export const emptyRunState = (sku = ""): TemplateRunState => ({
  sku, hasRU: null, refWeight: null, photos: {}, weights: {}, verdict: { ok: "", note: "" }, checks: {}, notes: {},
});

/** Words of the blockers (the shell's error line), and of the saved labels. */
export const TEMPLATE_RUN_TEXT = {
  skuMissing: "יש לסרוק את מק״ט היצרן",
  photoUploading: "יש צילום שעדיין עולה — המתן לסיום ההעלאה.",
  photoFailed: "יש צילום שההעלאה שלו נכשלה — הסר אותו וצלם שוב.",
  photosMissing: (title: string, min: number) => (min === 1 ? `ב"${title}" נדרש צילום אחד לפחות` : `ב"${title}" נדרשים לפחות ${min} צילומים`),
  weightMissing: "יש להזין את המשקל שנמדד",
  verdictMissing: "יש לבחור תקין או לא תקין",
  checksMissing: (title: string) => `יש לסמן את כל השורות ב"${title}"`,
  fieldsMissing: "יש להשלים את שדות הבדיקה",
  skuLabel: "מק״ט יצרן",
  weightLabel: "משקל",
  gramUnit: "גר׳",
} as const;

/** The shots that reached storage. */
const stored = (shots: readonly Shot[] | undefined) => (shots ?? []).filter((s) => !s.uploading && !s.failed && s.objectKey);

/** The object keys of every shot that reached storage, over the given components' photo groups. */
export function storedPhotoKeys(components: readonly TemplateComponent[], s: TemplateRunState): string[] {
  return components.flatMap((c) => (c.kind === "photo" ? stored(s.photos[c.id]).map((x) => x.objectKey as string) : []));
}

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
 *  at the place of the route_fields component itself). Without one, before the verdict. The package
 *  base asks it of its box steps and of its item flow alike. */
export function routeFieldsSlot(cfg: { steps: readonly TemplateStep[] }): { stepIndex: number; componentId: string; atComponent: boolean } | null {
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
    case "checklist": {
      const ticked = s.checks[c.id] ?? [];
      return c.items.every((row) => ticked.includes(row.id)) ? null : TEMPLATE_RUN_TEXT.checksMissing(fillVariables(c.title, { station }));
    }
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

/** One component's answer as saved: its id and a FieldValue (the route fields' format, label at
 *  save time). A list, not an object keyed by id: details is jsonb, which keeps an array's order
 *  but not an object's keys', and the report prints the components in popup order. */
export type SavedComponent = { id: string } & FieldValue;

/**
 * The result's details (PLAN §3.5). `sku` / `hasRU` keep today's keys (the next station starts
 * from details.sku), `verdict` today's { ok, note }; every component's answer goes into
 * `components` (SavedComponent[], popup order), so the item's report prints it like a field.
 * Blank answers are left out. The route's fields block is merged on top by the popup (its verdict
 * carries ok / note too).
 */
export function buildTemplateDetails(
  cfg: PopupTemplateConfig,
  ctx: { stationTypeId: number; version: number; station: string },
  s: TemplateRunState,
): Record<string, unknown> {
  const all = cfg.steps.flatMap((st) => st.components);
  const hasSku = all.some((c) => c.kind === "sku_scan");
  return {
    station: `type-${ctx.stationTypeId}`,
    template: { v: ctx.version },
    ...(hasSku ? { sku: s.sku.trim(), hasRU: s.hasRU } : {}),
    components: savedComponents(all, s, ctx.station),
    verdict: { ok: s.verdict.ok, note: s.verdict.note },
  };
}

/** The components' answers as saved, in order; blank ones left out. The package base saves its
 *  box's and every item's this way too (packageTemplateModel.ts). */
export function savedComponents(components: readonly TemplateComponent[], s: TemplateRunState, station: string): SavedComponent[] {
  const out: SavedComponent[] = [];
  for (const c of components) {
    if (c.kind === "sku_scan") {
      if (s.sku.trim()) out.push({ id: c.id, t: "scan", label: TEMPLATE_RUN_TEXT.skuLabel, value: s.sku.trim() });
    } else if (c.kind === "photo") {
      const keys = stored(s.photos[c.id]).map((x) => x.objectKey as string);
      if (keys.length > 0) out.push({ id: c.id, ...photoValue(c, keys, station) });
    } else if (c.kind === "weight") {
      const w = weightOutcome(c, s.refWeight, s.weights[c.id]);
      if (w.measured != null) {
        out.push({ id: c.id, t: "number", label: TEMPLATE_RUN_TEXT.weightLabel, value: w.measured, unit: TEMPLATE_RUN_TEXT.gramUnit, in_range: w.pass });
      }
    } else if (c.kind === "checklist") {
      const ticked = s.checks[c.id] ?? [];
      out.push({ id: c.id, t: "checklist", label: fillVariables(c.title, { station }), items: c.items.map((row) => ({ id: row.id, label: row.label, ok: ticked.includes(row.id) })) });
    } else if (c.kind === "notes") {
      const text = (s.notes[c.id] ?? "").trim();
      if (text) out.push({ id: c.id, t: "textarea", label: fillVariables(c.label, { station }), value: text });
    }
  }
  return out;
}

const photoValue = (c: PhotoComponent, photos: string[], station: string): FieldValue =>
  ({ t: "photo", label: fillVariables(c.title, { station }), photo_type: c.photo_code, photos });
