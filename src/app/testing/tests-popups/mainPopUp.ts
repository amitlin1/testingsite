import PopUpTestDialog from "../../components/PopUpTestDialog";
import Photo from "./Photo";
import { StationTestDialogProps } from "../../../types";

/**
 * test_station_type_id of the "קליטה וצילום" station type. IDs are editable in
 * Settings, so set this to the real id in your DB (create the station type +
 * station first). Left at 0 as a safe placeholder — no station has type 0, so the
 * wizard stays inert until wired. TODO: switch to a stable key (e.g. a wizard_key
 * column) so an id edit can't unmap it.
 */
export const KELITA_TZILUM_TYPE_ID = 1;

// id (test_station_type_id) → the dialog opened on "התחל בדיקה"/"סיום ודיווח" for
// that station type. Anything not registered falls back to the plain report dialog.
const REGISTRY: Record<number, React.ComponentType<StationTestDialogProps>> = {
  [KELITA_TZILUM_TYPE_ID]: Photo,
};

/** True if a station type has a dedicated wizard (so "התחל בדיקה" opens it instead of starting a plain test). */
export const hasStartTestDialog = (typeId: number) => typeId in REGISTRY;

export const getStartTestDialog = (typeId: number) =>
  REGISTRY[typeId] ?? PopUpTestDialog;