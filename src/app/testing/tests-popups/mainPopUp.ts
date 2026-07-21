import PopUpTestDialog from "../../components/PopUpTestDialog";
import Photo from "./Photo";
import Disassembly from "./Disassembly";
import Assembly from "./Assembly";
import Xray from "./Xray";
import BlackMirror from "./BlackMirror";
import Packaging from "./Packaging";
import { StationTestDialogProps } from "../../../types";

/**
 * test_station_type_id values → their dedicated wizard. These match the real ids
 * in the DB `test_stations_type` table (1 צילום · 2 פירוק · 3 שיקוף · 4 מראה
 * שחורה · 5 הרכבה · 6 אריזה · 7 דוח סופי). TODO: switch to a stable key (e.g. a
 * wizard_key column) so an id edit in Settings can't unmap a wizard.
 */
export const KELITA_TZILUM_TYPE_ID = 1; // צילום
export const PIRUK_TYPE_ID = 2;         // פירוק (disassembly)
export const SHIKUF_TYPE_ID = 3;        // שיקוף (X-ray)
export const MARA_SHCHORA_TYPE_ID = 4;  // מראה שחורה (black mirror)
export const HARKAVA_TYPE_ID = 5;       // הרכבה (assembly)
export const ARIZA_TYPE_ID = 6;         // אריזה (packaging)

// id (test_station_type_id) → the dialog opened on "התחל בדיקה"/"סיום ודיווח" for
// that station type. Anything not registered falls back to the plain report dialog.
const REGISTRY: Record<number, React.ComponentType<StationTestDialogProps>> = {
  [KELITA_TZILUM_TYPE_ID]: Photo,
  [PIRUK_TYPE_ID]: Disassembly,
  [SHIKUF_TYPE_ID]: Xray,
  [MARA_SHCHORA_TYPE_ID]: BlackMirror,
  [HARKAVA_TYPE_ID]: Assembly,
  [ARIZA_TYPE_ID]: Packaging,
};

/** True if a station type has a dedicated wizard (so "התחל בדיקה" opens it instead of starting a plain test). */
export const hasStartTestDialog = (typeId: number) => typeId in REGISTRY;

export const getStartTestDialog = (typeId: number) =>
  REGISTRY[typeId] ?? PopUpTestDialog;