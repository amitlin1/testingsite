import type { CSSProperties } from "react";
import type { PackageItemState, PackageStatusKey } from "@/app/lib/packages/read";

/**
 * Shared vocabulary of the package screens — colours, labels and id
 * formatting from claude-code-handoff/packages/design (Packages.dc.html,
 * Package Stations.dc.html). One place, so every screen agrees.
 */

export const BLUE = "var(--color-primary)";
export const BLUE_HOVER = "var(--color-primary-hover)";
export const BLUE_SOFT = "var(--color-primary-soft)";
export const FOCUS = "var(--color-primary-focus)";
export const INK = "var(--color-ink)";
export const INK_2 = "var(--color-ink-muted-70)";
export const MUTED = "var(--color-ink-muted-48)";
export const MUTED_LT = "var(--color-ink-muted-48)";
export const HAIR = "var(--color-hairline)";
export const HAIR_2 = "var(--color-divider-soft)";
export const PAGE_BG = "var(--color-canvas-parchment)";
export const AMBER = "var(--color-status-late)";  // dots and fills; text uses AMBER_INK
export const AMBER_INK = "var(--color-warning-ink)";
export const AMBER_BG = "var(--color-warning-bg)";
export const AMBER_BORDER = "var(--color-warning-border)";
export const GREEN = "var(--color-success-ink)";
export const GREEN_BG = "var(--color-success-bg)";
export const RED = "var(--color-destructive)";
export const RED_HOVER = "var(--color-destructive-hover)";
export const RED_BG = "var(--color-danger-bg)";
export const GREY = "var(--color-border-strong)";
export const SHADOW = "var(--shadow-modal)";

/** Item state → legend colour + label (design: STATES). */
export const ITEM_STATES: Record<PackageItemState, { label: string; color: string }> = {
  new: { label: "טרם נפתח", color: GREY },
  queue: { label: "ממתין", color: AMBER },
  test: { label: "בבדיקה", color: BLUE },
  done: { label: "הושלם", color: GREEN },
  missing: { label: "חסר במארז", color: RED },
};

/** Box status → pill label + dot colour (design: PKG_STATUS, plus readyClose). */
export const PKG_STATUS: Record<PackageStatusKey, { label: string; dot: string }> = {
  queue: { label: "ממתין לפתיחה", dot: AMBER },
  test: { label: "בבדיקה", dot: BLUE },
  waitItems: { label: "ממתין לפריטי המארז", dot: AMBER },
  readyClose: { label: "ממתין לסגירה", dot: AMBER },
  done: { label: "הושלם", dot: GREEN },
};

export const LEGEND: { label: string; color: string }[] = [
  { label: "טרם נפתח", color: GREY },
  { label: "ממתין", color: AMBER },
  { label: "בבדיקה", color: BLUE },
  { label: "הושלם", color: GREEN },
  { label: "חסר במארז", color: RED },
];

/** 16-digit id → { head: "1005 1509 2600 03", suffix: "00" }. A legacy id
 *  (shorter) has no suffix convention: head = the whole id, suffix = "". */
export function fmtId(id: string | number | bigint): { head: string; suffix: string } {
  const s = String(id);
  if (s.length === 16) {
    return { head: s.slice(0, 14).replace(/(\d{4})(?=\d)/g, "$1 "), suffix: s.slice(14) };
  }
  return { head: s.replace(/(\d{4})(?=\d)/g, "$1 "), suffix: "" };
}

/** Compact form for chips and dense tables: "…2600 03". */
export function shortId(id: string | number | bigint): string {
  const s = String(id);
  if (s.length === 16) return `…${s.slice(10, 14)} ${s.slice(14)}`;
  return s.length > 8 ? `…${s.slice(-8)}` : s;
}

/** Two-digit position: 1 → "01". */
export function seq2(n: number | null | undefined): string {
  return n == null ? "—" : String(n).padStart(2, "0");
}

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

/** Barcode payload — the app-wide "id-sourceId" shape. */
export function barcodeOf(id: string | number | bigint, sourceId?: number | null): string {
  return sourceId ? `${id}-${sourceId}` : String(id);
}

/** Pill button styles shared by the package dialogs. */
export const pillPrimary: CSSProperties = {
  background: BLUE, color: "var(--color-on-primary)", border: 0, borderRadius: 9999, padding: "11px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
export const pillGhost: CSSProperties = {
  background: "var(--color-canvas)", border: `1px solid ${HAIR}`, borderRadius: 9999, padding: "11px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", color: INK,
};
export const pillDanger: CSSProperties = {
  background: RED, color: "var(--color-on-primary)", border: 0, borderRadius: 9999, padding: "11px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
export const fieldInput: CSSProperties = {
  width: "100%", height: 44, border: `1px solid ${HAIR}`, borderRadius: 10, padding: "0 13px", fontSize: 14, outline: "none", background: "var(--color-canvas)", fontFamily: "inherit", color: INK,
};
/**
 * Stacking for the package dialogs and wizards. AppShell puts the top bar at
 * 1100 and the navigation rail at 1200, the design-system dialogs sit at 1300
 * and the combobox / menu poppers at 1400+. Package overlays therefore live
 * between the chrome and the primitives; secondary dialogs that open on top
 * of a primary one (delete, the closing decision) add 10, the ones a wizard
 * or the list opens underneath another (edit, labels, the wizard shell)
 * subtract 10.
 */
export const DIALOG_Z = 1250;

export const overlay: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: DIALOG_Z, display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
};
