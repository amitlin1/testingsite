import * as React from "react";
import PopUpTestDialog from "./PopUpTestDialog";
import PhotoStation from "./PhotoStation";
import VerdictStation from "./VerdictStation";
import TemplateStation from "./TemplateStation";
import PackageOpenWizard from "./opening/PackageOpenWizard";
import PackageCloseWizard from "./closing/PackageCloseWizard";
import { CODE_POPUPS } from "@/app/lib/popup-templates/codePopups";
import type { StationPopup } from "@/app/lib/testing/popup-kind";
import type { StationPopupProps } from "./props";

/**
 * The components behind a StationPopup (lib/testing/popup-kind.ts decides which one a station
 * opens). The code's popups are keyed by test_station_type_id — the real ids in the DB
 * `test_stations_type` table; the popups are generic and take every title from the station type's
 * name in the DB, so no station name lives in the code. TODO: switch to a stable key (e.g. a
 * wizard_key column) so an id edit in Settings can't unmap a popup.
 *
 * Every component here is module-level, so nothing remounts an open popup and loses what the
 * worker filled.
 */

/** A photo wizard that captures the photo_types group `photoTypeId`. */
const photoWizard = (photoTypeId: number) => {
  const config = { photoTypeId };
  const Wizard = (props: StationPopupProps) => React.createElement(PhotoStation, { ...props, config });
  return Wizard;
};

const REGISTRY: Record<number, React.ComponentType<StationPopupProps>> = Object.fromEntries(
  Object.entries(CODE_POPUPS).map(([id, p]) => [Number(id), p.kind === "photo" ? photoWizard(p.photoTypeId) : VerdictStation]),
);

/** The popup the code gives a station type (no template): its own, or the plain report dialog. */
const codePopupOf = (typeId: number) => REGISTRY[typeId] ?? PopUpTestDialog;

/** The popup a station opens: a template runs in TemplateStation with the code's popup (or the
 *  package wizard of its role) as the fallback when the template is gone. */
export function StationPopupDialog({ popup, ...props }: StationPopupProps & { popup: StationPopup }) {
  if (popup.kind === "package") {
    // stationPopupOf answers "package" only for a row that carries its box.
    const pkg = props.item.package;
    if (!pkg) return null;
    const wizard = React.createElement(popup.role === "opening" ? PackageOpenWizard : PackageCloseWizard, { ...props, pkg });
    return popup.template
      ? React.createElement(TemplateStation, { ...props, fallback: wizard, box: { role: popup.role, pkg } })
      : wizard;
  }
  const fallback = React.createElement(codePopupOf(popup.typeId), props);
  return popup.template ? React.createElement(TemplateStation, { ...props, fallback }) : fallback;
}
