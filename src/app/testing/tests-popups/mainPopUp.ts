import * as React from "react";
import PopUpTestDialog from "../../components/PopUpTestDialog";
import PhotoStation from "./PhotoStation";
import VerdictStation from "./VerdictStation";
import { StationTestDialogProps } from "../../../types";

/**
 * test_station_type_id values → their dedicated wizard. The ids match the real
 * ids in the DB `test_stations_type` table; the wizards are generic and take
 * every title from the station type's name in the DB, so no station name lives
 * in the code. TODO: switch to a stable key (e.g. a wizard_key column) so an id
 * edit in Settings can't unmap a wizard.
 *
 * Package-level station types (test_stations_type.package_level — opening /
 * closing) are NOT registered here: the testing page opens the package
 * wizards for them by the flag, not by id (docs/packages/PLAN.md §4).
 */

/** A photo wizard that captures the photo_types group `photoTypeId`. */
const photoWizard = (photoTypeId: number) => {
  const config = { photoTypeId };
  const Wizard = (props: StationTestDialogProps) => React.createElement(PhotoStation, { ...props, config });
  return Wizard;
};

// id (test_station_type_id) → the dialog opened on "התחל בדיקה"/"סיום ודיווח" for
// that station type. Anything not registered falls back to the plain report dialog.
const REGISTRY: Record<number, React.ComponentType<StationTestDialogProps>> = {
  2: photoWizard(3),
  3: VerdictStation,
  4: VerdictStation,
  5: photoWizard(4),
};

/** True if a station type has a dedicated wizard (so "התחל בדיקה" opens it instead of starting a plain test). */
export const hasStartTestDialog = (typeId: number) => typeId in REGISTRY;

export const getStartTestDialog = (typeId: number) =>
  REGISTRY[typeId] ?? PopUpTestDialog;
