import { TEMPLATE_DEFAULTS } from "@/app/lib/popup-templates/labels";
import { fillVariables } from "@/app/lib/popup-templates/schema";

/**
 * The item popups' words that name the station type. They are the template defaults, so a template
 * made "מהחלון של היום" reads exactly like the popup it replaces; a station type with no name keeps
 * the popups' own wording. Pure: the settings preview reads the finish label from here too.
 */

const named = (text: string, stationTypeName: string | null | undefined, unnamed: string): string =>
  stationTypeName?.trim() ? fillVariables(text, { station: stationTypeName }) : unnamed;

/** "סיום בדיקת {עמדה}" — VerdictStation's and PhotoStation's finish button. */
export const stationFinishLabel = (stationTypeName: string | null | undefined): string =>
  named(TEMPLATE_DEFAULTS.finishLabel, stationTypeName, "סיום בדיקה");

/** "בדיקת {עמדה}" — VerdictStation's check step. */
export const stationCheckTitle = (stationTypeName: string | null | undefined): string =>
  named(TEMPLATE_DEFAULTS.checkStepTitle, stationTypeName, "בדיקת הפריט");
