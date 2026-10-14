"use client";
import * as React from "react";
import { Layers, Link2, Package } from "lucide-react";
import { Tag } from "@/components/ui";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import type { FieldId } from "@/app/lib/station-fields/schema";
import { columnNavKey, filterCounts, findCell, mapErrorBar, mapNavGrid, visibleRows } from "../../lib/mapModel";
import type { CellBinding, FieldsMapModel, MapCell, MapColumn, MapFilter, MapRow } from "../../lib/mapModel";
import type { RouteQuery } from "../../lib/routeQuery";
import { MAP_TEXT, columnCoverageText, columnPickLabel, sharedRowTitle } from "../../lib/labels";
import FieldsMapCell from "./FieldsMapCell";
import FieldsMapErrorBar from "./FieldsMapErrorBar";
import FieldsMapFooter from "./FieldsMapFooter";
import FieldsMapToolbar from "./FieldsMapToolbar";
import { useGridNavigation } from "./useGridNavigation";
import "./map.css";

/**
 * "מפת שדות" — stations × the kit's rows (route-fields spec §5.4; artboard 1, and artboard 11 for a
 * route that holds no fields of its own). Top to bottom:
 *   the error bar (only with an error) → the toolbar (filter chips) → [the selection bar — session
 *   2e] → the map card: <section aria-label="מפת שדות">, white, hairline, radius 16; a horizontal
 *   scroller (min-width 1120) with the grid `240px repeat(N, minmax(176px, 1fr))`, its first column
 *   sticky; the footer.
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
 * Session 2e hooks in here: selection (Ctrl/⌘ + click, Space, Shift + arrows, a column header's
 * "בחירת כל התאים בעמדה …" through `onSelectColumn`), FieldsMapBulkBar under the toolbar, and
 * copy / paste. In this session a column header only takes the focus to its first cell.
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
  /** A column header was activated ("בחירת כל התאים בעמדה {name}") — session 2e selects the
   *  column's relevant cells. */
  onSelectColumn?: (columnKey: string) => void;
  /** Field-set names by id, for a cell's "ערכה: {name}" tag. The fields context carries none (the
   *  library's API is session 2d's); a cell whose set name is unknown shows no tag. */
  setNames?: Readonly<Record<number, string>>;
};

export default function FieldsMap({ context, model, query, onOpenCell, onSelectColumn, setNames }: FieldsMapProps) {
  const [filterChoice, setFilterChoice] = React.useState<MapFilter>("all");
  const counts = React.useMemo(() => filterCounts(model), [model]);
  // A filter that has nothing left to show (its last cell fixed) gives way to "הכל" — for good, so
  // a later cell of that kind does not bring it back unasked.
  const stale = filterChoice !== "all" && counts[filterChoice] === 0;
  if (stale) setFilterChoice("all");
  const filter: MapFilter = stale ? "all" : filterChoice;
  const rows = React.useMemo(() => visibleRows(model, filter), [model, filter]);
  const grid = React.useMemo(() => mapNavGrid(model.columns, rows), [model.columns, rows]);

  const [initialKey] = React.useState<string | null>(() =>
    query.step != null && query.target != null ? findCell(model, query.step, query.target)?.key ?? null : null);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const { gridProps, tabIndexOf, focusKey } = useGridNavigation(gridRef, grid, { initialKey, bodyStart: 1 });

  const errorBar = React.useMemo(() => mapErrorBar(model, context), [model, context]);
  // Artboard 11: while the route holds no fields of its own, a filled cell is another kit's.
  const sharedState = model.onboarding;

  // Session 2e: Ctrl / ⌘ + click toggles the cell's selection instead.
  const activateCell = React.useCallback((cell: MapCell) => onOpenCell(cell.binding), [onOpenCell]);

  const pickColumn = React.useCallback((columnIndex: number, columnKey: string) => {
    onSelectColumn?.(columnKey);
    for (let r = 1; r < grid.length; r++) {
      const key = grid[r][columnIndex];
      if (key != null) {
        focusKey(key);
        return;
      }
    }
  }, [onSelectColumn, grid, focusKey]);

  const gridStyle = { "--rf-map-cols": model.columns.length } as React.CSSProperties;

  return (
    <div className="rf-map-view">
      {errorBar && (
        <FieldsMapErrorBar
          error={errorBar}
          onGoToField={() => {
            if (errorBar.cell) onOpenCell(errorBar.cell.binding, errorBar.fieldId ?? undefined);
          }}
        />
      )}

      <FieldsMapToolbar filter={filter} counts={counts} onFilterChange={setFilterChoice} />

      {/* Session 2e: FieldsMapBulkBar ("{n} תאים נבחרו" …) goes here, while a cell is selected. */}

      <section aria-label={MAP_TEXT.sectionLabel} className="rf-map">
        <div className="rf-map__scroll">
          <div
            ref={gridRef}
            role="grid"
            aria-label={MAP_TEXT.sectionLabel}
            className="rf-map__grid"
            style={gridStyle}
            {...gridProps}
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
                    onPick={() => pickColumn(i, col.key)}
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
  );
}

// ---- column headers -------------------------------------------------------------------------------
type ColumnHeaderProps = {
  column: MapColumn;
  navKey: string;
  tabIndex: 0 | -1;
  onPick: () => void;
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
        onClick={onPick}
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
