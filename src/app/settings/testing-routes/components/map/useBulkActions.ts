"use client";
import * as React from "react";
import { currentConfigs } from "../../lib/draftModel";
import { useDraftStore } from "../../lib/draftStore";
import { DEFAULT_IDS } from "../../lib/editorModel";
import { applyAdditions, clearCells, copyCells, pasteSource, planInternalPaste, planTsvPaste } from "../../lib/bulkModel";
import type { BulkClipboard } from "../../lib/bulkModel";
import type { PasteCounts, RouteEdit } from "../../lib/cellFill";
import type { FieldsMapModel, MapCell } from "../../lib/mapModel";
import { useOptionLists } from "../../lib/resources";

/** The page's last copy, and whether its TSV reached the system clipboard. Module level: it outlives
 *  the map while the editor is open. Written by copy() and markOnSystem() only. */
let clipEntry: { clip: BulkClipboard; onSystem: boolean } | null = null;

export type BulkActions = {
  /** Keeps the cells' fields in the internal clipboard; null for no cells. */
  copy: (cells: readonly MapCell[]) => BulkClipboard | null;
  /** The clipboard's TSV reached the system clipboard. */
  markOnSystem: (clip: BulkClipboard) => void;
  /** Pastes into the cells (bulkModel.pasteSource picks the source); null when there is nothing to
   *  paste. `systemText` null = the system clipboard could not be read. */
  paste: (cells: readonly MapCell[], systemText: string | null) => PasteCounts | null;
  /** "נקה": the cells that had fields. */
  clear: (cells: readonly MapCell[]) => number;
};

/** The map's copy / paste / clear on the draft store — one store.edit per route touched. */
export function useBulkActions(model: FieldsMapModel): BulkActions {
  const store = useDraftStore();
  const lists = useOptionLists().data;
  return React.useMemo((): BulkActions => {
    const edit: RouteEdit = (routeId, mutate) => store.edit(routeId, mutate);
    return {
      copy(cells) {
        if (cells.length === 0) return null;
        const clip = copyCells(model, currentConfigs(store.getSnapshot().model), cells);
        clipEntry = { clip, onSystem: false };
        return clip;
      },
      markOnSystem(clip) {
        if (clipEntry?.clip === clip) clipEntry = { clip, onSystem: true };
      },
      paste(cells, systemText) {
        if (cells.length === 0) return null;
        const src = pasteSource(clipEntry?.clip ?? null, systemText, clipEntry?.onSystem ?? false);
        if (src.kind === "empty") return null;
        if (src.kind === "internal") {
          const plan = planInternalPaste(model, src.clip, cells);
          return applyAdditions(edit, plan.additions, DEFAULT_IDS, plan.outside);
        }
        return applyAdditions(edit, planTsvPaste(src.rows, cells, lists));
      },
      clear(cells) {
        return clearCells(edit, cells);
      },
    };
  }, [store, model, lists]);
}
