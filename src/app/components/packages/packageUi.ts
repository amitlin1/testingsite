import { ITEM_STATE_LABEL, PACKAGE_STATUS_LABEL, type PackageItemState, type PackageStatusKey } from "@/app/lib/packages/contract";
import { AMBER, AMBER_INK, BLUE, GREEN, GREY, MUTED, RED } from "@/components/ui/colors";

/**
 * The package screens' colour per state and status (claude-code-handoff/
 * packages/design: Packages.dc.html, Package Stations.dc.html); the labels
 * are the contract's, so the screens and the server's state_label agree.
 */

/** Item state → legend colour + label (design: STATES). */
export const ITEM_STATES: Record<PackageItemState, { label: string; color: string }> = {
  new: { label: ITEM_STATE_LABEL.new, color: GREY },
  queue: { label: ITEM_STATE_LABEL.queue, color: AMBER },
  test: { label: ITEM_STATE_LABEL.test, color: BLUE },
  done: { label: ITEM_STATE_LABEL.done, color: GREEN },
  missing: { label: ITEM_STATE_LABEL.missing, color: RED },
};

/** Item state → the colour its LABEL is written in. ITEM_STATES colours are
 *  for dots and strips (amber is 3.2:1, the grey 1.4:1 — not text). */
export const ITEM_STATE_INK: Record<PackageItemState, string> = {
  new: MUTED,
  queue: AMBER_INK,
  test: BLUE,
  done: GREEN,
  missing: RED,
};

/** Box status → pill label + dot colour (design: PKG_STATUS, plus readyClose). */
export const PKG_STATUS: Record<PackageStatusKey, { label: string; dot: string }> = {
  pending: { label: PACKAGE_STATUS_LABEL.pending, dot: GREY },
  queue: { label: PACKAGE_STATUS_LABEL.queue, dot: AMBER },
  test: { label: PACKAGE_STATUS_LABEL.test, dot: BLUE },
  waitItems: { label: PACKAGE_STATUS_LABEL.waitItems, dot: AMBER },
  readyClose: { label: PACKAGE_STATUS_LABEL.readyClose, dot: AMBER },
  done: { label: PACKAGE_STATUS_LABEL.done, dot: GREEN },
};

/** The item-state legend, in the design's order. */
export const LEGEND: { label: string; color: string }[] = Object.values(ITEM_STATES);

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${fmtDate(iso)} ${hh}:${mi}`;
}
