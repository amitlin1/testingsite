import { CODE_POPUPS } from "@/app/lib/popup-templates/codePopups";
import { roleAtStep } from "@/app/lib/popup-templates/placement";
import type { PackageRole } from "@/app/lib/popup-templates/schema";
import { ItemStatus } from "@/lib/item-status";
import type { QueueRow, TestStationType } from "./contract";

/**
 * Which popup a station type opens, decided once — the testing screen opens it
 * (tests-popups/mainPopUp.ts maps it to the component), the settings previews
 * can ask the same. Pure data: no React, no popup imports.
 *
 *   package   a box at a package-level station: the opening or the closing
 *             wizard by its place on the package route (placement.ts
 *             roleAtStep), from the type's package template when it has one
 *             (docs/features/packages/PLAN.md §4, docs/features/popup-templates/PLAN.md §5)
 *   item      everything else: the type's popup template, or the code's popup
 *             (CODE_POPUPS; none = the plain report dialog). An item in
 *             research keeps the code's popup (popup-templates PLAN §7,
 *             decision 3).
 */
export type StationPopup =
  | { kind: "package"; role: PackageRole; template: boolean }
  | { kind: "item"; typeId: number; template: boolean };

/** The code's own popup for a station type (no template). */
export type CodePopupKind = "photo" | "verdict" | "dialog";

export const codePopupKindOf = (typeId: number): CodePopupKind => CODE_POPUPS[typeId]?.kind ?? "dialog";

/** "התחל בדיקה" opens a popup right after the start — the type has a template or a code popup of
 *  its own; with only the plain report dialog the start just starts the test. */
export const opensOnStart = (type: TestStationType): boolean =>
  type.popupTemplate != null || CODE_POPUPS[type.id] != null;

/** The package wizard role of a box at its current step. */
export function packageRoleOf(row: Pick<QueueRow, "route_steps" | "current_route_step">): PackageRole {
  return roleAtStep((row.current_route_step ?? 1) - 1, row.route_steps?.length ?? 0);
}

/** The popup a station of `type` opens for `row`. */
export function stationPopupOf(
  type: TestStationType,
  row: Pick<QueueRow, "is_package" | "package" | "current_status" | "route_steps" | "current_route_step">,
): StationPopup {
  if (type.packageLevel && row.is_package && row.package) {
    return { kind: "package", role: packageRoleOf(row), template: type.popupTemplate?.base === "package" };
  }
  return { kind: "item", typeId: type.id, template: type.popupTemplate != null && row.current_status !== ItemStatus.InResearch };
}
