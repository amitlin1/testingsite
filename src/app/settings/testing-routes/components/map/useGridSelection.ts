"use client";
import * as React from "react";
import { navPosition } from "./useGridNavigation";
import type { NavGrid } from "./useGridNavigation";

/**
 * The fields map's multi-select (route-fields spec §5.14, §5.16, §10.3; artboard 1's selection
 * bar), over the same matrix of navigation keys the arrows walk (mapModel.mapNavGrid: row 0 = the
 * column headers, null = "—", which is never selected).
 *
 *   Ctrl / ⌘ + click, Space   toggle one cell (a plain click OPENS the editor — spec §10.3)
 *   Shift + click / arrows    a rectangle from the anchor to the cell, on top of what was selected
 *                             before the anchor was set (like a spreadsheet: the last range grows)
 *   column header             every cell of the column that can hold fields (artboard 1 `pickCol`
 *                             replaces the selection); with Ctrl / ⌘ the column is added to it, so
 *                             kit and item columns can be mixed from the headers too
 *   Escape, "בטל בחירה"       clear
 * The anchor is the last cell toggled on (or the first of a picked column) while it stays selected;
 * else the cell that had the focus.
 *
 * Only keys the grid has count: a filter that hides a selected cell's row leaves it out of the
 * selection the bar counts and acts on, until the row is shown again.
 */

export type SelectionState = {
  keys: ReadonlySet<string>;
  /** Where a Shift range starts. */
  anchor: string | null;
  /** The selection before the anchor was set: a Shift range is drawn on top of it. */
  base: ReadonlySet<string>;
};

export const EMPTY_SELECTION: SelectionState = Object.freeze({ keys: new Set<string>(), anchor: null, base: new Set<string>() });

/** A key of the grid's body (not a header, not "—"). */
export function isBodyKey(grid: NavGrid, key: string | null, bodyStart: number): key is string {
  if (key == null) return false;
  const p = navPosition(grid, key);
  return p != null && p.row >= bodyStart;
}

/** The selectable keys of the rectangle between two body keys, in reading order. */
export function rangeKeys(grid: NavGrid, from: string, to: string, bodyStart: number): string[] {
  const a = navPosition(grid, from);
  const b = navPosition(grid, to);
  if (!a || !b || a.row < bodyStart || b.row < bodyStart) return [];
  const out: string[] = [];
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) {
      const k = grid[r]?.[c];
      if (k != null) out.push(k);
    }
  }
  return out;
}

/** The selectable keys of a column of the body, top to bottom. */
export function columnKeys(grid: NavGrid, col: number, bodyStart: number): string[] {
  const out: string[] = [];
  for (let r = bodyStart; r < grid.length; r++) {
    const k = grid[r]?.[col];
    if (k != null) out.push(k);
  }
  return out;
}

/** Ctrl / ⌘ + click, Space: in or out; the cell becomes the anchor. */
export function toggleKey(s: SelectionState, key: string): SelectionState {
  const keys = new Set(s.keys);
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  return { keys, anchor: key, base: keys };
}

/** Shift + click / arrows: the rectangle from the anchor to `key`, on top of the selection the
 *  anchor was set on. The anchor holds while it is selected; one toggled off (or none) gives way to
 *  `fallback` — the cell that had the focus — else to the key itself. */
export function extendTo(s: SelectionState, key: string, grid: NavGrid, bodyStart: number, fallback: string | null = null): SelectionState {
  if (!isBodyKey(grid, key, bodyStart)) return s;
  const held = isBodyKey(grid, s.anchor, bodyStart) && s.keys.has(s.anchor);
  const anchor = held && s.anchor != null ? s.anchor : isBodyKey(grid, fallback, bodyStart) ? fallback : key;
  const keys = new Set(s.base);
  for (const k of rangeKeys(grid, anchor, key, bodyStart)) keys.add(k);
  return { keys, anchor, base: s.base };
}

/** A column header: the column's cells instead of the selection, or (`add`) on top of it. */
export function pickColumn(s: SelectionState, keys: readonly string[], add: boolean): SelectionState {
  const next = new Set(add ? s.keys : []);
  for (const k of keys) next.add(k);
  return { keys: next, anchor: keys[0] ?? s.anchor, base: add ? next : new Set() };
}

/** The selected keys the grid has, in reading order. */
export function visibleSelection(s: SelectionState, grid: NavGrid, bodyStart: number): string[] {
  if (s.keys.size === 0) return [];
  const out: string[] = [];
  for (let r = bodyStart; r < grid.length; r++) for (const k of grid[r] ?? []) if (k != null && s.keys.has(k)) out.push(k);
  return out;
}

export type GridSelection = {
  /** The selected keys the grid shows, in reading order. */
  selected: string[];
  isSelected: (key: string) => boolean;
  toggle: (key: string) => void;
  /** `fallback`: the anchor when there is none yet (the focused cell). */
  extend: (key: string, fallback?: string | null) => void;
  /** A column header (`col` = its index in the grid); `add` keeps what is selected. */
  selectColumn: (col: number, add?: boolean) => void;
  clear: () => void;
};

export function useGridSelection(grid: NavGrid, bodyStart = 1): GridSelection {
  const [state, setState] = React.useState<SelectionState>(EMPTY_SELECTION);
  const selected = React.useMemo(() => visibleSelection(state, grid, bodyStart), [state, grid, bodyStart]);
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);

  const isSelected = React.useCallback((key: string) => selectedSet.has(key), [selectedSet]);
  const toggle = React.useCallback((key: string) => {
    if (isBodyKey(grid, key, bodyStart)) setState((s) => toggleKey(s, key));
  }, [grid, bodyStart]);
  const extend = React.useCallback((key: string, fallback: string | null = null) => {
    setState((s) => extendTo(s, key, grid, bodyStart, fallback));
  }, [grid, bodyStart]);
  const selectColumn = React.useCallback((col: number, add = false) => {
    setState((s) => pickColumn(s, columnKeys(grid, col, bodyStart), add));
  }, [grid, bodyStart]);
  const clear = React.useCallback(() => setState(EMPTY_SELECTION), []);

  return { selected, isSelected, toggle, extend, selectColumn, clear };
}
