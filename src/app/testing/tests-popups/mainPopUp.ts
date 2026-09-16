import PopUpTestDialog from "../../components/PopUpTestDialog";
import Disassembly from "./Disassembly";
import Assembly from "./Assembly";
import Xray from "./Xray";
import BlackMirror from "./BlackMirror";
import { StationTestDialogProps } from "../../../types";

/**
 * test_station_type_id values → their dedicated wizard. These match the real ids
 * in the DB `test_stations_type` table (2 פירוק · 3 שיקוף · 4 מראה שחורה ·
 * 5 הרכבה). TODO: switch to a stable key (e.g. a wizard_key column) so an id
 * edit in Settings can't unmap a wizard.
 *
 * Package-level station types (test_stations_type.package_level — opening /
 * closing) are NOT registered here: the testing page opens the package
 * wizards for them by the flag, not by id (docs/packages/PLAN.md §4). The old
 * "קליטה וצילום" (1) and "אריזה" (6) wizards were replaced by those.
 */
export const PIRUK_TYPE_ID = 2;         // פירוק (disassembly)
export const SHIKUF_TYPE_ID = 3;        // שיקוף (X-ray)
export const MARA_SHCHORA_TYPE_ID = 4;  // מראה שחורה (black mirror)
export const HARKAVA_TYPE_ID = 5;       // הרכבה (assembly)

// id (test_station_type_id) → the dialog opened on "התחל בדיקה"/"סיום ודיווח" for
// that station type. Anything not registered falls back to the plain report dialog.
const REGISTRY: Record<number, React.ComponentType<StationTestDialogProps>> = {
  [PIRUK_TYPE_ID]: Disassembly,
  [SHIKUF_TYPE_ID]: Xray,
  [MARA_SHCHORA_TYPE_ID]: BlackMirror,
  [HARKAVA_TYPE_ID]: Assembly,
};

/** True if a station type has a dedicated wizard (so "התחל בדיקה" opens it instead of starting a plain test). */
export const hasStartTestDialog = (typeId: number) => typeId in REGISTRY;

export const getStartTestDialog = (typeId: number) =>
  REGISTRY[typeId] ?? PopUpTestDialog;
