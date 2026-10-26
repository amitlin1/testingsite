import { NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import { newPrefixedId } from "@/app/lib/station-fields/step-uids";
import type { RandomSource } from "@/app/lib/station-fields/step-uids";
import type { ComponentId, PopupTemplateConfig, TemplateStepId } from "./schema";
import { TEMPLATE_DEFAULTS } from "./labels";

/**
 * Ids, and the templates that reproduce today's popups (docs/popup-templates/PLAN.md §4, step 1.5):
 * a station type seeded with one of these opens exactly the popup it opened before, from the template.
 * Titles use {עמדה}, as the popups use the station type's name from the DB — no name lives here.
 */

/** Minted in the browser (the editor) and by the seed; the shape check enforces format and uniqueness. */
export const newTemplateStepId = (random?: RandomSource): TemplateStepId => newPrefixedId("p_", random);
export const newComponentId = (random?: RandomSource): ComponentId => newPrefixedId("k_", random);

/** The first step of both popups: the manufacturer SKU, carried on from the previous station. */
function skuStep(lookupReference: boolean, random?: RandomSource) {
  return {
    id: newTemplateStepId(random),
    title: TEMPLATE_DEFAULTS.skuStepTitle,
    desc: TEMPLATE_DEFAULTS.skuStepDesc,
    components: [{ id: newComponentId(random), kind: "sku_scan" as const, required: true, carry_last: true, lookup_reference: lookupReference }],
  };
}

/** Today's photo popup (tests-popups/PhotoStation.tsx): SKU with a reference lookup → the station's
 *  photos over the reference images of `photoCode`, the route's fields, the verdict. */
export function photoStationTemplate(photoCode: string, random?: RandomSource): PopupTemplateConfig {
  return {
    steps: [
      skuStep(true, random),
      {
        id: newTemplateStepId(random),
        title: "צילום {עמדה}",
        desc: "צלם את הפריט לפי תמונות הייחוס, ואשר את תקינותו.",
        components: [
          { id: newComponentId(random), kind: "photo", title: TEMPLATE_DEFAULTS.photoTitle, photo_code: photoCode, min: 0, show_reference: true },
          { id: newComponentId(random), kind: "route_fields" },
          { id: newComponentId(random), kind: "verdict", question: TEMPLATE_DEFAULTS.verdictQuestion, note_max: NOTE_MAX_DEFAULT },
        ],
      },
    ],
    finish_label: TEMPLATE_DEFAULTS.finishLabel,
  };
}

/**
 * Today's opening wizard (tests-popups/PackageOpenWizard.tsx) as a package template (PLAN.md §5.2):
 * the box's label → the box's photos, its fields and "האריזה תקינה?" → contents and serials → every
 * item (scan → photo, its fields and "הפריט תקין?" → weigh, ±5%) → labels. `boxCode` / `itemCode`:
 * the photo groups the wizard captures into today, so the reference images stay where they are.
 */
export function openingTemplate(boxCode: string, itemCode: string, random?: RandomSource): PopupTemplateConfig {
  const c = (kind: "contents" | "items" | "labels") => ({ id: newComponentId(random), kind });
  return {
    role: "opening",
    steps: [
      { id: newTemplateStepId(random), title: "סריקת מק״ט המארז", desc: "מדבקת המארז", components: [
        { id: newComponentId(random), kind: "sku_scan", required: true, carry_last: false, lookup_reference: true },
      ] },
      { id: newTemplateStepId(random), title: "צילום הקופסה", desc: "3 זוויות + תקינות", components: [
        { id: newComponentId(random), kind: "photo", title: "צילום הקופסה", photo_code: boxCode, min: 0, show_reference: true },
        { id: newComponentId(random), kind: "route_fields" },
        { id: newComponentId(random), kind: "verdict", question: TEMPLATE_DEFAULTS.boxQuestion, note_max: NOTE_MAX_DEFAULT },
      ] },
      { id: newTemplateStepId(random), title: "תכולה וסריאליים", desc: "מה בקופסה, סריאלי לכל פריט", components: [c("contents")] },
      { id: newTemplateStepId(random), title: "פריטים במארז", desc: "סריקה, צילום ושקילה לכל פריט", components: [c("items")] },
      { id: newTemplateStepId(random), title: "מדבקות", desc: "מדבקה לכל פריט", components: [c("labels")] },
    ],
    item_flow: [
      { id: newTemplateStepId(random), title: "סריקה", desc: "", components: [
        { id: newComponentId(random), kind: "sku_scan", required: true, carry_last: false, lookup_reference: true },
      ] },
      { id: newTemplateStepId(random), title: "צילום", desc: "", components: [
        { id: newComponentId(random), kind: "photo", title: "צילום הפריט", photo_code: itemCode, min: 0, show_reference: true },
        { id: newComponentId(random), kind: "route_fields" },
        { id: newComponentId(random), kind: "verdict", question: TEMPLATE_DEFAULTS.itemQuestion, note_max: NOTE_MAX_DEFAULT },
      ] },
      { id: newTemplateStepId(random), title: "שקילה", desc: "", components: [
        { id: newComponentId(random), kind: "weight", required: true, tolerance_pct: 5 },
      ] },
    ],
    finish_label: TEMPLATE_DEFAULTS.openFinish,
  };
}

/**
 * Today's closing wizard (tests-popups/PackageCloseWizard.tsx) as a package template: the box's
 * label (starting from the one scanned at the opening) → arrival and packing → the box's fields,
 * the three packing checks and the packing note.
 */
export function closingTemplate(random?: RandomSource): PopupTemplateConfig {
  return {
    role: "closing",
    steps: [
      { id: newTemplateStepId(random), title: "סריקת מק״ט המארז", desc: "מדבקת המארז", components: [
        { id: newComponentId(random), kind: "sku_scan", required: true, carry_last: true, lookup_reference: true },
      ] },
      { id: newTemplateStepId(random), title: "פריטים ואריזה", desc: "מצב הגעה + נארז", components: [
        { id: newComponentId(random), kind: "arrival" },
      ] },
      { id: newTemplateStepId(random), title: "תקינות האריזה", desc: "אישור סופי", components: [
        { id: newComponentId(random), kind: "route_fields" },
        { id: newComponentId(random), kind: "checklist", title: "בדיקות האריזה",
          items: TEMPLATE_DEFAULTS.packChecks.map((label) => ({ id: newPrefixedId("i_", random), label })) },
        { id: newComponentId(random), kind: "notes", label: TEMPLATE_DEFAULTS.packNote },
      ] },
    ],
    finish_label: TEMPLATE_DEFAULTS.closeFinish,
  };
}

/** Today's verdict popup (tests-popups/VerdictStation.tsx): SKU → the instruction with the SKU in
 *  it, the route's fields, the verdict. */
export function verdictStationTemplate(random?: RandomSource): PopupTemplateConfig {
  return {
    steps: [
      skuStep(false, random),
      {
        id: newTemplateStepId(random),
        title: "בדיקת {עמדה}",
        desc: "בצע את הבדיקה לפי ההנחיה ואשר את תקינות הפריט.",
        components: [
          { id: newComponentId(random), kind: "message", text: "נא לבצע את הבדיקה עפ״י מק״ט {מק״ט}" },
          { id: newComponentId(random), kind: "route_fields" },
          { id: newComponentId(random), kind: "verdict", question: TEMPLATE_DEFAULTS.verdictQuestion, note_max: NOTE_MAX_DEFAULT },
        ],
      },
    ],
    finish_label: TEMPLATE_DEFAULTS.finishLabel,
  };
}
