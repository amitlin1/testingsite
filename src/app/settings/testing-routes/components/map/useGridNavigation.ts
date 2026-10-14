"use client";
import * as React from "react";

/**
 * Keyboard movement in the fields map (route-fields spec §5.16, §8.11; artboard 1's "חיצים לניווט ·
 * … · Enter לעריכה"): role="grid" with a roving tabindex — the grid is ONE tab stop, the arrows
 * move between the cells that can hold fields.
 *
 * The grid is given as a matrix of navigation keys (mapModel.mapNavGrid): each focusable element
 * carries `data-nav-key` with its key; null marks a place nothing can focus ("—"), which the arrows
 * skip. Keys, not indices, hold the active cell, so it survives a filter that hides rows (a key that
 * left the grid falls back to the first cell).
 *
 *   ArrowUp / ArrowDown     the nearest focusable place above / below in the column
 *   ArrowLeft / ArrowRight  the nearest one in the row, by the grid's direction: in RTL ArrowLeft
 *                           moves toward the inline end (the next column)
 *   Home / End              the first / last in the row; with Ctrl, the first / last cell of the body
 *   Enter                   not handled here: every focusable place is a <button>, whose own Enter
 *                           click opens the cell (FieldsMap)
 * Shift + arrows (a range), Space, Escape and Ctrl C / Ctrl V are the selection's — session 2e —
 * and pass through untouched.
 */

/** Rows × columns of navigation keys; null = nothing to focus there. */
export type NavGrid = ReadonlyArray<ReadonlyArray<string | null>>;

export type NavPos = { row: number; col: number };

export type NavKeyOptions = {
  /** The grid's direction is right-to-left (ArrowLeft = the next column). */
  rtl: boolean;
  /** Ctrl is down: Home / End go to the first / last cell of the body. */
  ctrlKey?: boolean;
  /** The first row of the body (rows above it are headers). Default 0. */
  bodyStart?: number;
};

const NAV_KEYS: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

/** Where a key sits in the grid, or null. */
export function navPosition(grid: NavGrid, key: string): NavPos | null {
  for (let row = 0; row < grid.length; row++) {
    const col = grid[row].indexOf(key);
    if (col >= 0) return { row, col };
  }
  return null;
}

/** The first key in reading order from `fromRow` on; the rows above it only when there is none. */
export function firstNavKey(grid: NavGrid, fromRow = 0): string | null {
  const scan = (start: number, end: number): string | null => {
    for (let r = start; r < end; r++) for (const k of grid[r] ?? []) if (k != null) return k;
    return null;
  };
  return scan(Math.max(0, fromRow), grid.length) ?? scan(0, Math.min(fromRow, grid.length));
}

function lastNavKey(grid: NavGrid, fromRow: number): string | null {
  for (let r = grid.length - 1; r >= Math.max(0, fromRow); r--) {
    const row = grid[r];
    for (let c = row.length - 1; c >= 0; c--) if (row[c] != null) return row[c];
  }
  return null;
}

/** The first key from (row, col) on, stepping by `step` along the row. */
function scanRow(grid: NavGrid, row: number, col: number, step: 1 | -1): string | null {
  const cells = grid[row] ?? [];
  for (let c = col; c >= 0 && c < cells.length; c += step) if (cells[c] != null) return cells[c];
  return null;
}

/** The first key from (row, col) on, stepping by `step` down / up the column. */
function scanCol(grid: NavGrid, col: number, row: number, step: 1 | -1): string | null {
  for (let r = row; r >= 0 && r < grid.length; r += step) {
    const k = grid[r]?.[col];
    if (k != null) return k;
  }
  return null;
}

/** The key a navigation key moves to from `from`; null = no move (an edge, or not a navigation
 *  key). Pure — the hook below and the tests use it. */
export function navTarget(grid: NavGrid, from: string, key: string, opts: NavKeyOptions): string | null {
  const pos = navPosition(grid, from);
  if (!pos) return null;
  // +1 = the next column in DOM order (the inline end).
  const right: 1 | -1 = opts.rtl ? -1 : 1;
  const left: 1 | -1 = opts.rtl ? 1 : -1;
  const width = grid[pos.row].length;
  switch (key) {
    case "ArrowDown": return scanCol(grid, pos.col, pos.row + 1, 1);
    case "ArrowUp": return scanCol(grid, pos.col, pos.row - 1, -1);
    case "ArrowRight": return scanRow(grid, pos.row, pos.col + right, right);
    case "ArrowLeft": return scanRow(grid, pos.row, pos.col + left, left);
    case "Home": return opts.ctrlKey ? firstNavKey(grid, opts.bodyStart ?? 0) : scanRow(grid, pos.row, 0, 1);
    case "End": return opts.ctrlKey ? lastNavKey(grid, opts.bodyStart ?? 0) : scanRow(grid, pos.row, width - 1, -1);
    default: return null;
  }
}

export type GridNavigationOptions = {
  /** The key active before anything is focused (else the first cell of the body). */
  initialKey?: string | null;
  /** The first row of the body in the grid (1 when row 0 is the column headers). */
  bodyStart?: number;
};

export type GridNavigation = {
  /** onKeyDown / onFocus for the role="grid" element (focus and keys bubble up from the cells). */
  gridProps: {
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    onFocus: (e: React.FocusEvent<HTMLElement>) => void;
  };
  /** The one key in the tab order. */
  activeKey: string | null;
  /** tabIndex of a focusable place: 0 for the active key, -1 for the others. */
  tabIndexOf: (key: string) => 0 | -1;
  /** Focus the place with this key (and make it the active one). */
  focusKey: (key: string) => void;
};

const navKeyOf = (target: EventTarget | null): string | null => {
  const el = target instanceof Element ? target.closest<HTMLElement>("[data-nav-key]") : null;
  return el?.dataset.navKey ?? null;
};

/** `gridRef` is the role="grid" element's ref (the component owns it); `grid` its navigation keys. */
export function useGridNavigation(
  gridRef: React.RefObject<HTMLElement | null>,
  grid: NavGrid,
  options: GridNavigationOptions = {},
): GridNavigation {
  const bodyStart = options.bodyStart ?? 0;
  const [active, setActive] = React.useState<string | null>(options.initialKey ?? null);
  // A key the grid no longer has (a filter hid its row, the context changed) gives way to the first.
  const activeKey = React.useMemo(
    () => (active != null && navPosition(grid, active) ? active : firstNavKey(grid, bodyStart)),
    [grid, active, bodyStart],
  );

  const focusKey = React.useCallback((key: string) => {
    const root = gridRef.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>("[data-nav-key]")) {
      if (el.dataset.navKey === key) {
        setActive(key);
        el.focus();
        return;
      }
    }
  }, [gridRef]);

  const onKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (!NAV_KEYS.has(e.key) || e.altKey || e.metaKey || e.shiftKey) return;
    if (e.ctrlKey && e.key !== "Home" && e.key !== "End") return;
    const from = navKeyOf(e.target) ?? activeKey;
    if (from == null) return;
    const root = gridRef.current;
    const rtl = root ? getComputedStyle(root).direction === "rtl" : true;
    e.preventDefault();
    const next = navTarget(grid, from, e.key, { rtl, ctrlKey: e.ctrlKey, bodyStart });
    if (next != null && next !== from) focusKey(next);
  }, [gridRef, grid, activeKey, bodyStart, focusKey]);

  const onFocus = React.useCallback((e: React.FocusEvent<HTMLElement>) => {
    const key = navKeyOf(e.target);
    if (key != null) setActive(key);
  }, []);

  const tabIndexOf = React.useCallback((key: string): 0 | -1 => (key === activeKey ? 0 : -1), [activeKey]);

  const gridProps = React.useMemo(() => ({ onKeyDown, onFocus }), [onKeyDown, onFocus]);
  return { gridProps, activeKey, tabIndexOf, focusKey };
}
