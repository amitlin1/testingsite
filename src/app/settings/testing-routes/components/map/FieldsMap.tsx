"use client";
import * as React from "react";
import { Layers, Link2, Package } from "lucide-react";
import { ConfirmDialog, Snackbar, Tag } from "@/components/ui";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import type { FieldId } from "@/app/lib/station-fields/schema";
import { columnNavKey, filterCounts, findCell, mapErrorBar, mapNavGrid, visibleRows } from "../../lib/mapModel";
import type { CellBinding, FieldsMapModel, MapCell, MapColumn, MapFilter, MapRow } from "../../lib/mapModel";
import type { RouteQuery } from "../../lib/routeQuery";
import { BULK_TEXT, MAP_TEXT, columnCoverageText, columnPickLabel, sharedRowTitle } from "../../lib/labels";
import { BULK_UNDRAWN_TEXT, clearCellsMessage, clearCellsTitle, copiedText, pastedText } from "../../lib/bulkLabels";
import FieldsMapBulkBar, { PasteTextDialog, readClipboardText, useBulkActions, writeClipboardText } from "./FieldsMapBulkBar";
import FieldsMapCell from "./FieldsMapCell";
import FieldsMapErrorBar from "./FieldsMapErrorBar";
import FieldsMapFooter from "./FieldsMapFooter";
import FieldsMapToolbar from "./FieldsMapToolbar";
import { useGridNavigation } from "./useGridNavigation";
import { useGridSelection } from "./useGridSelection";
import "./map.css";

/**
 * "מפת שדות" — stations × the kit's rows (route-fields spec §5.4; artboard 1, and artboard 11 for a
 * route that holds no fields of its own). Top to bottom:
 *   the error bar (only with an error) → the toolbar (filter chips; none on artboard 11's map of a
 *   route without fields of its own — the page draws FieldsOnboarding above the map then) → the
 *   selection bar (while a cell is selected) → the map card: <section aria-label="מפת שדות">, white,
 *   hairline, radius 16; a
 *   horizontal scroller (min-width 1120) with the grid `240px repeat(N, minmax(176px, 1fr))`, its
 *   first column sticky; the footer.
 *
 * Rows and columns come from mapModel (FieldsMapModel); a kit's map has "הקופסה", "כל פריט במארז"
 * and a row per template line, a single item route one row (no artboard — spec §5.4.1). A
 * package-level column is one continuous frame ("כרטיס אחד לכל המארז"); a per-item column separate
 * tiles (FieldsMapCell).
 *
 * A click on a cell OPENS ITS EDITOR (spec §10.3: artboard 11's "לחיצה על תא פותחת את עורך השדות"
 * over artboard 1's click-to-select demo). Keyboard: role="grid", roving tabindex, arrows between
 * the cells that can hold fields, Home / End, Enter opens (useGridNavigation).
 *
 * Selection (spec §5.14, §5.16; useGridSelection): Ctrl / ⌘ + click or Space toggles a cell;
 * Shift + click / Shift + arrows a rectangle ("—" is never selected); a column header selects the
 * column's cells (with Ctrl / ⌘ it adds them); Escape or "בטל בחירה" clears. Kit and item columns
 * mix freely. The selection lives here: opening a cell's editor leaves the map, and with it the
 * selection.
 *
 * Actions (FieldsMapBulkBar, bulkModel): "העתק" / Ctrl C, "הדבק" / Ctrl V, "נקה" (after a confirm —
 * undrawn) and "החל ערכת שדות…" (`onApplySet`, artboard 9). They act on the selected cells; with
 * none selected, Ctrl C / Ctrl V act on the focused cell, like a spreadsheet. Ctrl C writes the TSV
 * through the copy event and Ctrl V reads the paste event (both work on plain http); when a browser
 * sends no such event for a focused button, the clipboard API is the fallback. Every change is a
 * draft edit, one per route touched (autosave per route). A message after a copy or a paste is
 * undrawn (spec §10.4).
 */

export type FieldsMapProps = {
  /** The fields context the model was built from (useFieldsContext "ready"). */
  context: FieldsContextJson;
  /** useFieldsMap(context): the map with every route's working copy. */
  model: FieldsMapModel;
  /** The URL state. A step / target in it names the cell the grid starts on. */
  query: RouteQuery;
  /** Open the cell editor on a cell (withEditor(query, step_uid, target, field)); `field` from the
   *  error bar's "עבור לשדה". */
  onOpenCell: (binding: CellBinding, field?: FieldId) => void;
  /** A column header was activated ("בחירת כל התאים בעמדה {name}"); the map has already selected
   *  the column's cells. */
  onSelectColumn?: (columnKey: string) => void;
  /** Field-set names by id, for a cell's "ערכה: {name}" tag. The fields context carries none (the
   *  library's API is session 2d's); a cell whose set name is unknown shows no tag. */
  setNames?: Readonly<Record<number, string>>;
  /** The selection bar's "החל ערכת שדות…" (artboard 9's dialog): the selected cells, in map order.
   *  Without it the button is not drawn. */
  onApplySet?: (cells: MapCell[]) => void;
};

const navKeyOf = (target: EventTarget | null): string | null => {
  const el = target instanceof Element ? target.closest<HTMLElement>("[data-nav-key]") : null;
  return el?.dataset.navKey ?? null;
};

/** Ctrl / ⌘ + C or V on any keyboard layout (a Hebrew layout's key reads "ב" / "ה"). */
function clipboardShortcut(e: React.KeyboardEvent): "copy" | "paste" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null;
  if (e.code === "KeyC" || e.key === "c" || e.key === "C") return "copy";
  if (e.code === "KeyV" || e.key === "v" || e.key === "V") return "paste";
  return null;
}

export default function FieldsMap({ context, model, query, onOpenCell, onSelectColumn, setNames, onApplySet }: FieldsMapProps) {
  const [filterChoice, setFilterChoice] = React.useState<MapFilter>("all");
  const counts = React.useMemo(() => filterCounts(model), [model]);
  // A filter that has nothing left to show (its last cell fixed) gives way to "הכל" — for good, so
  // a later cell of that kind does not bring it back unasked.
  const stale = filterChoice !== "all" && counts[filterChoice] === 0;
  if (stale) setFilterChoice("all");
  // Artboard 11 draws no toolbar over a route without fields of its own: the whole map shows.
  const filter: MapFilter = stale || model.onboarding ? "all" : filterChoice;
  const rows = React.useMemo(() => visibleRows(model, filter), [model, filter]);
  const grid = React.useMemo(() => mapNavGrid(model.columns, rows), [model.columns, rows]);

  const [initialKey] = React.useState<string | null>(() =>
    query.step != null && query.target != null ? findCell(model, query.step, query.target)?.key ?? null : null);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const selection = useGridSelection(grid, 1);
  const { extend: extendSelection, toggle: toggleSelection, selectColumn, clear: clearSelection } = selection;
  // Shift + arrows: the focus moved from `from` to `to` — the range grows to `to`.
  const onExtend = React.useCallback((from: string, to: string) => extendSelection(to, from), [extendSelection]);
  const { gridProps, tabIndexOf, focusKey, activeKey } = useGridNavigation(gridRef, grid, { initialKey, bodyStart: 1, onExtend });

  const errorBar = React.useMemo(() => mapErrorBar(model, context), [model, context]);
  // Artboard 11: while the route holds no fields of its own, a filled cell is another kit's.
  const sharedState = model.onboarding;

  // ---- selection ---------------------------------------------------------------------------------
  const selectedCells = React.useMemo(() => {
    const out: MapCell[] = [];
    for (const k of selection.selected) {
      const c = model.cells.get(k);
      if (c && !c.na) out.push(c);
    }
    return out;
  }, [selection.selected, model]);

  const activateCell = React.useCallback((cell: MapCell, e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.metaKey) {
      toggleSelection(cell.key);
      return;
    }
    if (e.shiftKey) {
      // The cell that had the focus anchors a first range; the clicked one takes the focus.
      extendSelection(cell.key, activeKey);
      focusKey(cell.key);
      return;
    }
    onOpenCell(cell.binding);
  }, [toggleSelection, extendSelection, activeKey, focusKey, onOpenCell]);

  const pickColumn = React.useCallback((columnIndex: number, columnKey: string, add: boolean) => {
    selectColumn(columnIndex, add);
    onSelectColumn?.(columnKey);
    for (let r = 1; r < grid.length; r++) {
      const key = grid[r][columnIndex];
      if (key != null) {
        focusKey(key);
        return;
      }
    }
  }, [selectColumn, onSelectColumn, grid, focusKey]);

  /** "בטל בחירה" / Escape: the bar goes, so the focus goes back to the grid. */
  const deselect = React.useCallback((refocus: boolean) => {
    clearSelection();
    if (refocus && activeKey != null) focusKey(activeKey);
  }, [clearSelection, activeKey, focusKey]);

  /** After the paste box or the clear confirm: ui/Dialog has no trigger to give the focus back to, so
   *  it would drop to the page — the grid takes it, once the dialog has let go of it. */
  const refocusGridSoon = React.useCallback(() => {
    window.setTimeout(() => {
      if (activeKey != null) focusKey(activeKey);
    }, 0);
  }, [activeKey, focusKey]);

  // ---- actions -------------------------------------------------------------------------------------
  const bulk = useBulkActions(model);
  // The message after a copy or a paste; a new one restarts the Snackbar (its key).
  const [notice, setNoticeState] = React.useState<{ text: string; seq: number } | null>(null);
  const setNotice = React.useCallback((text: string) => setNoticeState((n) => ({ text, seq: (n?.seq ?? 0) + 1 })), []);
  // The cells stay with a closed dialog, so its text does not change while it closes.
  const [clearBox, setClearBox] = React.useState<{ open: boolean; cells: MapCell[] }>({ open: false, cells: [] });
  const [pasteBox, setPasteBox] = React.useState<{ open: boolean; cells: MapCell[] }>({ open: false, cells: [] });
  // Ctrl C / Ctrl V seen on the keyboard whose copy / paste event has not come (yet).
  const pendingShortcut = React.useRef<"copy" | "paste" | null>(null);

  /** The selected cells; with none, the focused cell (a spreadsheet's active cell). */
  const actionTargets = React.useCallback((): MapCell[] => {
    if (selectedCells.length > 0) return selectedCells;
    const key = navKeyOf(typeof document === "undefined" ? null : document.activeElement);
    const cell = key != null && gridRef.current?.contains(document.activeElement) ? model.cells.get(key) : undefined;
    return cell && !cell.na ? [cell] : [];
  }, [selectedCells, model]);

  const copyCellsOut = React.useCallback((cells: MapCell[], data: DataTransfer | null) => {
    const clip = bulk.copy(cells);
    if (!clip) return;
    if (data) {
      data.setData("text/plain", clip.tsv);
      bulk.markOnSystem(clip);
    } else {
      void writeClipboardText(clip.tsv).then((ok) => {
        if (ok) bulk.markOnSystem(clip);
      });
    }
    setNotice(copiedText(cells.length));
  }, [bulk, setNotice]);

  const pasteCellsIn = React.useCallback((cells: MapCell[], text: string | null) => {
    if (cells.length === 0) return;
    const counts = bulk.paste(cells, text);
    if (counts) setNotice(pastedText(counts));
    else if (text == null) setPasteBox({ open: true, cells });   // nothing of ours, and the clipboard unread
    else setNotice(BULK_UNDRAWN_TEXT.nothingToPaste);
  }, [bulk, setNotice]);

  const pasteFromClipboard = React.useCallback((cells: MapCell[]) => {
    void readClipboardText().then((text) => pasteCellsIn(cells, text));
  }, [pasteCellsIn]);

  const onViewKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    if (e.key === "Escape" && selectedCells.length > 0) {
      e.preventDefault();
      deselect(!gridRef.current?.contains(document.activeElement));
      return;
    }
    const shortcut = clipboardShortcut(e);
    if (!shortcut || actionTargets().length === 0) return;
    // The browser's copy / paste event follows this key in the same task; when it does not come
    // (no event for a focused button), the clipboard API does the job.
    pendingShortcut.current = shortcut;
    window.setTimeout(() => {
      if (pendingShortcut.current !== shortcut) return;
      pendingShortcut.current = null;
      const cells = actionTargets();
      if (shortcut === "copy") copyCellsOut(cells, null);
      else pasteFromClipboard(cells);
    }, 0);
  };

  const onViewCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    pendingShortcut.current = null;
    if (e.defaultPrevented) return;
    const cells = actionTargets();
    if (cells.length === 0) return;
    e.preventDefault();
    copyCellsOut(cells, e.clipboardData);
  };

  const onViewPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    pendingShortcut.current = null;
    if (e.defaultPrevented) return;
    const cells = actionTargets();
    if (cells.length === 0) return;
    e.preventDefault();
    pasteCellsIn(cells, e.clipboardData.getData("text/plain"));
  };

  // Space on a cell toggles it — and must not also press the cell's button (that opens the editor).
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    gridProps.onKeyDown(e);
    if (e.defaultPrevented || e.key !== " " || e.ctrlKey || e.altKey || e.metaKey) return;
    const key = navKeyOf(e.target);
    const cell = key != null ? model.cells.get(key) : undefined;
    if (!cell || cell.na) return;
    e.preventDefault();
    toggleSelection(cell.key);
  };
  const onGridKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== " ") return;
    const key = navKeyOf(e.target);
    const cell = key != null ? model.cells.get(key) : undefined;
    if (cell && !cell.na) e.preventDefault();
  };

  const gridStyle = { "--rf-map-cols": model.columns.length } as React.CSSProperties;
  const clearCount = clearBox.cells.length;

  return (
    <>
      <div className="rf-map-view" onKeyDown={onViewKeyDown} onCopy={onViewCopy} onPaste={onViewPaste}>
        {errorBar && (
          <FieldsMapErrorBar
            error={errorBar}
            onGoToField={() => {
              if (errorBar.cell) onOpenCell(errorBar.cell.binding, errorBar.fieldId ?? undefined);
            }}
          />
        )}

        {!model.onboarding && <FieldsMapToolbar filter={filter} counts={counts} onFilterChange={setFilterChoice} />}

        {selectedCells.length > 0 && (
          <FieldsMapBulkBar
            count={selectedCells.length}
            onApplySet={onApplySet ? () => onApplySet(selectedCells) : undefined}
            onPaste={() => pasteFromClipboard(selectedCells)}
            onCopy={() => copyCellsOut(selectedCells, null)}
            onClear={() => setClearBox({ open: true, cells: selectedCells })}
            onDeselect={() => deselect(true)}
          />
        )}

        <section aria-label={MAP_TEXT.sectionLabel} className="rf-map">
          <div className="rf-map__scroll">
            <div
              ref={gridRef}
              role="grid"
              aria-label={MAP_TEXT.sectionLabel}
              aria-multiselectable="true"
              className="rf-map__grid"
              style={gridStyle}
              onFocus={gridProps.onFocus}
              onKeyDown={onGridKeyDown}
              onKeyUp={onGridKeyUp}
            >
              <div role="row" className="rf-map__row rf-map__row--head">
                <div role="columnheader" className="rf-map__corner">{MAP_TEXT.corner}</div>
                {model.columns.map((col, i) => {
                  const key = columnNavKey(col.key);
                  return (
                    <ColumnHeader
                      key={col.key}
                      column={col}
                      navKey={key}
                      tabIndex={tabIndexOf(key)}
                      onPick={(add) => pickColumn(i, col.key, add)}
                    />
                  );
                })}
              </div>
              {rows.map((row, ri) => (
                <div key={row.key} role="row" className="rf-map__row">
                  <RowHeader row={row} />
                  {model.columns.map((col) => {
                    const cell = row.cells.find((c) => c.columnKey === col.key);
                    if (!cell) return <div key={col.key} role="gridcell" className="rf-map__slot" />;
                    const setName = !cell.na && cell.fromSet ? setNames?.[cell.fromSet.id] ?? null : null;
                    return (
                      <FieldsMapCell
                        key={cell.key}
                        cell={cell}
                        row={row}
                        column={col}
                        firstRow={ri === 0}
                        lastRow={ri === rows.length - 1}
                        sharedState={sharedState}
                        setName={setName}
                        navKey={cell.key}
                        tabIndex={tabIndexOf(cell.key)}
                        onActivate={activateCell}
                        selected={cell.na ? undefined : selection.isSelected(cell.key)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <FieldsMapFooter model={model} />
        </section>
      </div>

      {/* Outside the view: their keys and paste events are not the map's. */}
      <ConfirmDialog
        open={clearBox.open}
        title={clearCellsTitle(clearCount)}
        message={clearCellsMessage(clearCount)}
        confirmText={BULK_TEXT.clear}
        cancelText={BULK_UNDRAWN_TEXT.clearCancel}
        destructive
        draggable={false}
        onCancel={() => {
          setClearBox((b) => ({ ...b, open: false }));
          refocusGridSoon();
        }}
        onConfirm={() => {
          bulk.clear(clearBox.cells);
          setClearBox((b) => ({ ...b, open: false }));
          refocusGridSoon();
        }}
      />
      <PasteTextDialog
        open={pasteBox.open}
        onCancel={() => {
          setPasteBox((b) => ({ ...b, open: false }));
          refocusGridSoon();
        }}
        onPaste={(text) => {
          setPasteBox((b) => ({ ...b, open: false }));
          pasteCellsIn(pasteBox.cells, text);
          refocusGridSoon();
        }}
      />
      <Snackbar
        key={notice?.seq ?? 0}
        open={notice != null}
        message={notice?.text}
        autoHideDuration={5000}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        onClose={() => setNoticeState(null)}
      />
    </>
  );
}

// ---- column headers -------------------------------------------------------------------------------
type ColumnHeaderProps = {
  column: MapColumn;
  navKey: string;
  tabIndex: 0 | -1;
  /** `add`: Ctrl / ⌘ was down — the column joins the selection. */
  onPick: (add: boolean) => void;
};

/** A station's header (spec §5.4.2): the number in a 20px blue circle, the name (13/600), the Tag
 *  "כרטיס מארז" (Package 12px) on a package-level column or "לכל פריט בנפרד", and "מוגדרים {x}/{y}".
 *  The header cell is named by the station; its button by artboard 1's "בחירת כל התאים בעמדה
 *  {name}", with the rest as its description. */
function ColumnHeader({ column, navKey, tabIndex, onPick }: ColumnHeaderProps) {
  const metaId = React.useId();
  return (
    <div role="columnheader" aria-label={column.label} className="rf-map__colhead">
      <button
        type="button"
        data-nav-key={navKey}
        tabIndex={tabIndex}
        className="rf-map__colbtn"
        aria-label={columnPickLabel(column.label)}
        aria-describedby={metaId}
        onClick={(e) => onPick(e.ctrlKey || e.metaKey)}
      >
        <span className="rf-map__col-title">
          <span className="rf-map__col-n" aria-hidden="true">{column.n}</span>
          <span className="rf-map__col-name">{column.label}</span>
        </span>
        <span id={metaId} className="rf-map__col-meta-group">
          {column.packageLevel ? (
            <Tag tone="primary" icon={<Package size={12} strokeWidth={1.75} aria-hidden />}>{MAP_TEXT.kitCard}</Tag>
          ) : (
            <span className="rf-map__col-meta">{MAP_TEXT.perItem}</span>
          )}
          <span className="rf-map__col-meta">{columnCoverageText(column.defined, column.relevant)}</span>
        </span>
      </button>
    </div>
  );
}

// ---- row headers --------------------------------------------------------------------------------
/** A row's header (spec §5.4.1): "הקופסה" / "כל פריט במארז" on a 30px soft-blue tile (Package /
 *  Layers) with their sub-lines; a template line "{item} ×{qty}" after its 26px parchment seq badge,
 *  "מסלול {r} · {n} עמדות" under it, and Link2 ("משותף ל: {kits}") when other kits run its route.
 *  A single item route's row has no tile. */
function RowHeader({ row }: { row: MapRow }) {
  return (
    <div role="rowheader" className="rf-map__rowhead">
      {row.kind === "box" && (
        <span className="rf-map__row-icon" aria-hidden="true"><Package size={16} strokeWidth={1.75} /></span>
      )}
      {row.kind === "each_item" && (
        <span className="rf-map__row-icon" aria-hidden="true"><Layers size={16} strokeWidth={1.75} /></span>
      )}
      {row.kind === "line" && row.seq !== "" && <span className="rf-map__seq" dir="ltr">{row.seq}</span>}
      <span className="rf-map__row-text">
        <span className="rf-map__row-name">
          <span className="rf-map__row-label">{row.label}</span>
          {row.qty !== "" && <span className="rf-map__qty" dir="ltr">{row.qty}</span>}
          {row.sharedWith.length > 0 && (
            <span className="rf-map__row-link" title={sharedRowTitle(row.sharedWith.map((k) => k.desc))}>
              <Link2 size={12} strokeWidth={1.75} role="img" aria-label={MAP_TEXT.sharedIconLabel} />
            </span>
          )}
        </span>
        <span className="rf-map__row-sub">{row.sub}</span>
      </span>
    </div>
  );
}
