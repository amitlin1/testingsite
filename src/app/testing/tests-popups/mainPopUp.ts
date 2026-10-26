import * as React from "react";
import PopUpTestDialog from "../../components/PopUpTestDialog";
import PhotoStation from "./PhotoStation";
import VerdictStation from "./VerdictStation";
import TemplateStation from "./TemplateStation";
import PackageOpenWizard from "./PackageOpenWizard";
import PackageCloseWizard from "./PackageCloseWizard";
import { StationTestDialogProps } from "../../../types";
import { CODE_POPUPS } from "@/app/lib/popup-templates/codePopups";

/**
 * test_station_type_id values → their dedicated wizard. The ids match the real
 * ids in the DB `test_stations_type` table; the wizards are generic and take
 * every title from the station type's name in the DB, so no station name lives
 * in the code. TODO: switch to a stable key (e.g. a wizard_key column) so an id
 * edit in Settings can't unmap a wizard.
 *
 * A station type with a popup template (docs/popup-templates/PLAN.md §3.6) opens
 * TemplateStation instead — `hasTemplate` from /api/testing/stations — and this
 * registry is its fallback when the template is gone. An item in research keeps
 * the registry's popup (PLAN §7, decision 3): the page passes hasTemplate false.
 *
 * Package-level station types (test_stations_type.package_level — opening /
 * closing) are NOT registered here: the testing page opens the package
 * wizards for them by the flag, not by id (docs/packages/PLAN.md §4) —
 * PackageTestDialog, through the type's package template when it has one.
 */

/** A photo wizard that captures the photo_types group `photoTypeId`. */
const photoWizard = (photoTypeId: number) => {
  const config = { photoTypeId };
  const Wizard = (props: StationTestDialogProps) => React.createElement(PhotoStation, { ...props, config });
  return Wizard;
};

// id (test_station_type_id) → the dialog opened on "התחל בדיקה"/"סיום ודיווח" for
// that station type (lib/popup-templates/codePopups.ts — the seed reads the same list).
// Anything not registered falls back to the plain report dialog.
const REGISTRY: Record<number, React.ComponentType<StationTestDialogProps>> = Object.fromEntries(
  Object.entries(CODE_POPUPS).map(([id, p]) => [Number(id), p.kind === "photo" ? photoWizard(p.photoTypeId) : VerdictStation]),
);

/** The popup the code gives a station type (no template). */
const codeDialog = (typeId: number) => REGISTRY[typeId] ?? PopUpTestDialog;

/** True if a station type has a dedicated wizard (so "התחל בדיקה" opens it instead of starting a plain test). */
export const hasStartTestDialog = (typeId: number, hasTemplate = false) => hasTemplate || typeId in REGISTRY;

/** The popup the code gives a station type; with a template, StartTestDialog opens TemplateStation instead. */
export const getStartTestDialog = (typeId: number) => codeDialog(typeId);

/** The dialog a station type opens: its template (TemplateStation, with the code's popup as the
 *  fallback) when it has one, else the code's popup. Every one of them is a module-level component,
 *  so nothing remounts the popup and loses what the worker filled. */
export function StartTestDialog({ typeId, hasTemplate = false, ...props }: StationTestDialogProps & { typeId: number; hasTemplate?: boolean }) {
  const fallback = codeDialog(typeId);
  return hasTemplate
    ? React.createElement(TemplateStation, { ...props, fallback })
    : React.createElement(fallback, props);
}

/**
 * The dialog of a box at a package-level station: the opening or closing wizard by its place on the
 * route (`kind`), or — when the type has a package template — TemplateStation with that role, the
 * wizard as its fallback (docs/popup-templates/PLAN.md §5). A module-level component, like
 * StartTestDialog.
 */
export function PackageTestDialog({ kind, hasTemplate = false, ...props }: StationTestDialogProps & { kind: "open" | "close"; hasTemplate?: boolean }) {
  const wizard = kind === "open" ? PackageOpenWizard : PackageCloseWizard;
  return hasTemplate
    ? React.createElement(TemplateStation, { ...props, fallback: wizard, packageRole: kind === "open" ? "opening" : "closing" })
    : React.createElement(wizard, props);
}
