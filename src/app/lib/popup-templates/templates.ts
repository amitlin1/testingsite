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
