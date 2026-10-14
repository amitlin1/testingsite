"use client";
import * as React from "react";
import { CircleAlert, Link2, Plus } from "lucide-react";
import { Tooltip, cn } from "@/components/ui";
import type { AnyMapCell, MapCell, MapColumn, MapNaCell, MapRow } from "../../lib/mapModel";
import {
  COPY_PENDING, MAP_TEXT, cellErrorsText, cellLabel, emptyCellLabel, fieldsText, notOnRouteTooltip, setTagText,
  sharedCellLabel, sharedCellTooltip,
} from "../../lib/labels";

/**
 * One cell of the fields map (route-fields spec §5.4.2, §5.4.3; artboard 1, and artboard 11 for the
 * shared state): the role="gridcell" slot and what it shows.
 *
 * The slot is the grid's cell. In a per-item column it holds a separate tile; in a package-level
 * column the slots of all rows make ONE continuous frame (tint, primary-border edges and dividers,
 * 11px corners on the first and last row, "כרטיס אחד לכל המארז" on top) and the tiles inside it are
 * transparent.
 *
 * | state                 | look                                          | text                                   |
 * |-----------------------|-----------------------------------------------|----------------------------------------|
 * | defined               | white, hairline (transparent in a kit column) | "{N} שדות" / "שדה אחד", ≤4 tone dots,   |
 * |                       |                                               | "ערכה: {name}" (ellipsis)              |
 * | empty                 | white, divider-soft (transparent in a kit col)| "ללא שדות"                             |
 * |   hover / focus       | 1.5px dashed border-strong                    | Plus + "הגדר שדות"                     |
 * | n/a ("—")             | parchment, muted-40, not in the tab order     | "—", aria-label "לא במסלול", tooltip   |
 * | error                 | warning-bg + warning-border                   | "{N} שדות" + CircleAlert "שגיאה אחת"   |
 * | unpublished           | 6px status-late dot in the corner              | title "שינוי שלא פורסם"                |
 * | set updated           | 11/600 warning-ink                            | "הערכה עודכנה"                         |
 * | shared (artboard 11)  | Link2 beside the count, a tooltip             | "הוגדר במסלול {r} של {item} · משותף עם {kits}" |
 *
 * The accessible name is "{station} · {row}" (artboard 1); an empty cell "{station} · {row} · ללא
 * שדות" and a shared one "{station} · {row} · {n} שדות משותפים" (artboard 11). The rest of what the
 * tile shows (count, error, unpublished, the set) is its description (aria-describedby), so a
 * screen reader hears it too. The tone dots are decoration: the editor names every tone in words.
 *
 * Selection (artboard 1's 2px primary frame and Check badge, aria-pressed) is session 2e's: a click
 * hands the event to `onActivate`, which FieldsMap turns into "open the editor" (spec §10.3).
 */

export type FieldsMapCellProps = {
  cell: AnyMapCell;
  row: MapRow;
  column: MapColumn;
  /** The first / last row the map draws — the package-level frame's top and bottom. */
  firstRow: boolean;
  lastRow: boolean;
  /** Artboard 11 (the route holds no fields of its own): a defined cell whose route other kits run
   *  is drawn as theirs — Link2, the tooltip, "… · {n} שדות משותפים". */
  sharedState: boolean;
  /** The name of the field set the cell's fields came from (cell.fromSet), when it is known. */
  setName: string | null;
  /** useGridNavigation: the cell's key and its roving tabindex. */
  navKey: string;
  tabIndex: 0 | -1;
  /** A click (or Enter) on the cell. FieldsMap opens the editor; the event is there for session
   *  2e's Ctrl / ⌘ + click. */
  onActivate: (cell: MapCell, e: React.MouseEvent<HTMLButtonElement>) => void;
};

type CellState = "defined" | "empty" | "error";

/** Which of the three looks a cell that can hold fields takes. */
export function cellState(cell: MapCell): CellState {
  if (cell.errorCount > 0) return "error";
  return cell.fieldCount > 0 ? "defined" : "empty";
}

/** The dark tooltip of a "—" cell, or null (artboard 1 gives one only to an item that does not
 *  pass the station). */
export function naTooltip(cell: MapNaCell): string | null {
  if (cell.reason === "not_on_route" && cell.tooltip) {
    return notOnRouteTooltip(cell.tooltip.item, cell.tooltip.station, cell.tooltip.routeNumber);
  }
  if (cell.reason === "package_level") return COPY_PENDING.packageLevelOnItemRoute;
  return null;
}

/** The shared state applies: artboard 11's map, a defined cell, a route other kits run. */
function isShared(cell: MapCell, sharedState: boolean): boolean {
  return sharedState && cell.fieldCount > 0 && cell.errorCount === 0 && cell.sharedWith.length > 0;
}

/** The cell's accessible name (see the table above). */
export function cellAccessibleName(cell: MapCell, sharedState: boolean): string {
  if (cellState(cell) === "empty") return emptyCellLabel(cell.stationLabel, cell.rowLabel);
  if (isShared(cell, sharedState)) return sharedCellLabel(cell.stationLabel, cell.rowLabel, cell.fieldCount);
  return cellLabel(cell.stationLabel, cell.rowLabel);
}

/** Artboard 11's tooltip of a shared cell: the route that holds the fields and the other kits. */
function sharedTooltipText(cell: MapCell, row: MapRow): string | null {
  if (row.routeNumber == null) return null;
  return sharedCellTooltip(row.routeNumber, row.label, cell.sharedWith.map((k) => k.desc));
}

/** The tooltip's text, 12px as the artboards draw it (the primitive's own size is 13px). */
const tipContent = (text: string) => <span className="rf-map__tip">{text}</span>;

export default function FieldsMapCell({
  cell, row, column, firstRow, lastRow, sharedState, setName, navKey, tabIndex, onActivate,
}: FieldsMapCellProps) {
  const descId = React.useId();
  const kit = column.packageLevel;
  const slotClass = cn(
    "rf-map__slot",
    kit && "rf-map__slot--kit",
    kit && firstRow && "rf-map__slot--first",
    kit && lastRow && "rf-map__slot--last",
  );
  // The frame's caption: the column header's "כרטיס מארז" Tag already says it to a screen reader.
  const caption = kit && firstRow
    ? <span className="rf-map__frame-caption" aria-hidden="true">{MAP_TEXT.oneCardForKit}</span>
    : null;

  if (cell.na) {
    const tip = naTooltip(cell);
    const dash = <div className="rf-map__na" aria-hidden="true">{MAP_TEXT.na}</div>;
    return (
      <div role="gridcell" aria-label={MAP_TEXT.naLabel} className={slotClass}>
        {caption}
        {tip ? <Tooltip title={tipContent(tip)} placement="top">{dash}</Tooltip> : dash}
      </div>
    );
  }

  const state = cellState(cell);
  const shared = isShared(cell, sharedState);
  const sharedTip = shared ? sharedTooltipText(cell, row) : null;

  const button = (
    <button
      type="button"
      data-nav-key={navKey}
      tabIndex={tabIndex}
      className={cn("rf-cell", `rf-cell--${state}`, kit && "rf-cell--kit")}
      aria-label={cellAccessibleName(cell, sharedState)}
      aria-describedby={state === "empty" ? undefined : descId}
      onClick={(e) => onActivate(cell, e)}
    >
      <span id={descId} className="rf-cell__body">
        {state === "empty" ? (
          <>
            <span className="rf-cell__empty">{MAP_TEXT.empty}</span>
            <span className="rf-cell__define" aria-hidden="true">
              <Plus size={14} strokeWidth={1.75} aria-hidden />
              {MAP_TEXT.defineFields}
            </span>
          </>
        ) : (
          <span className={cell.fieldCount > 0 ? "rf-cell__count" : "rf-cell__empty"}>
            {cell.fieldCount > 0 ? fieldsText(cell.fieldCount) : MAP_TEXT.empty}
            {shared && <Link2 className="rf-cell__shared-icon" size={13} strokeWidth={1.75} aria-hidden />}
          </span>
        )}
        {state === "defined" && cell.tones.length > 0 && (
          <span className="rf-cell__dots" aria-hidden="true">
            {cell.tones.map((t) => <span key={t} className={`rf-cell__dot rf-cell__dot--${t}`} />)}
          </span>
        )}
        {state === "defined" && setName != null && (
          <span className="rf-cell__set" title={setTagText(setName)}>{setTagText(setName)}</span>
        )}
        {state === "error" && (
          <span className="rf-cell__error">
            <CircleAlert size={14} strokeWidth={1.75} aria-hidden />
            {cellErrorsText(cell.errorCount)}
          </span>
        )}
        {state === "defined" && cell.outdated && <span className="rf-cell__set-updated">{MAP_TEXT.setUpdated}</span>}
        {sharedTip && <span className="sh-visually-hidden">{sharedTip}</span>}
        {cell.unpublished && (
          <span className="rf-cell__unpub" role="img" aria-label={MAP_TEXT.unpublished} title={MAP_TEXT.unpublished} />
        )}
      </span>
    </button>
  );

  return (
    <div role="gridcell" className={slotClass}>
      {caption}
      {sharedTip ? <Tooltip title={tipContent(sharedTip)} placement="top">{button}</Tooltip> : button}
    </div>
  );
}
