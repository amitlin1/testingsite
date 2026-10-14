"use client";
import * as React from "react";
import { MAP_FILTERS } from "../../lib/mapModel";
import type { MapFilter } from "../../lib/mapModel";
import { MAP_TEXT, filterChipText } from "../../lib/labels";

/**
 * The toolbar above the fields map (route-fields spec §5.4.4; artboard 1): on its inline start
 * <div role="group" aria-label="סינון תאים"> with four chips — "הכל · 20", "ללא שדות · 5",
 * "שגיאות · 1", "לא פורסמו · 1" — one pressed at a time.
 *
 * Its inline end ("תצוגה מקדימה כעובד", "העתק ממסלול אחר…") is not built here: the preview opens the
 * station's own popup (spec §5.4.4, a later session) and the copy dialog is not drawn (לא אומת).
 *
 * A chip whose count is 0 is disabled, so no filter can leave the map without rows — an empty
 * filtered map has no drawing and no text (לא אומת). "הכל" never is.
 */

const FILTER_LABEL: Record<MapFilter, string> = {
  all: MAP_TEXT.filterAll,
  empty: MAP_TEXT.filterEmpty,
  errors: MAP_TEXT.filterErrors,
  unpublished: MAP_TEXT.filterUnpublished,
};

export type FieldsMapToolbarProps = {
  /** The pressed chip. */
  filter: MapFilter;
  /** mapModel.filterCounts. */
  counts: Record<MapFilter, number>;
  onFilterChange: (filter: MapFilter) => void;
};

export default function FieldsMapToolbar({ filter, counts, onFilterChange }: FieldsMapToolbarProps) {
  return (
    <div className="rf-map-toolbar">
      <div role="group" aria-label={MAP_TEXT.filterGroupLabel} className="rf-map-filters">
        {MAP_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="rf-filter-chip"
            aria-pressed={f === filter}
            disabled={f !== "all" && f !== filter && counts[f] === 0}
            onClick={() => onFilterChange(f)}
          >
            {filterChipText(FILTER_LABEL[f], counts[f])}
          </button>
        ))}
      </div>
    </div>
  );
}
