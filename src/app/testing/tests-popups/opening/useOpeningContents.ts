"use client";
import React from "react";
import type { PackageItemView, PackageView } from "@/app/lib/packages/contract";
import { useItemTypes } from "@/app/components/lookups";
import { memberTypesOf } from "@/app/components/packages/data";
import { playCue } from "@/lib/scan/sound";
import { boxDetailsOf, contentsProblem, rowsFromItems, saveContents, type ContentRow } from "./OpeningContents";

/**
 * The contents step ("תכולה וסריאליים", OpeningContents) of both opening wizards: its rows,
 * whether they are saved as they stand, the save's refusal on its row, and the item types an added
 * row picks from. Its "המשך" saves the contents before anything else happens to the items: the
 * items step works on the box as the server now has it (`onSaved`), and added items can bring
 * station fields of their own (`onAdded`).
 */
export function useOpeningContents(boxId: number, pkg: PackageView, onSaved: (items: PackageItemView[]) => void, onAdded: () => void) {
  const [rows, setRowsRaw] = React.useState<ContentRow[]>(() => rowsFromItems(pkg.items, boxDetailsOf(pkg)));
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<{ text: string; rowIndex: number | null } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const { data: itemTypes } = useItemTypes();
  const memberTypes = memberTypesOf(itemTypes ?? []);

  const setRows = React.useCallback((next: ContentRow[] | ((rs: ContentRow[]) => ContentRow[])) => {
    setRowsRaw(next); setSaved(false); setError(null);
  }, []);

  const save = async (): Promise<boolean> => {
    if (saved) return true;
    setBusy(true); setError(null);
    try {
      const result = await saveContents(boxId, rows);
      if ("error" in result) { setError({ text: result.error, rowIndex: result.rowIndex }); playCue("error"); return false; }
      const added = rows.some((r) => !r.gone && r.itemId == null);
      onSaved(result.items);
      setRowsRaw(rowsFromItems(result.items));
      setSaved(true);
      playCue("ok");
      if (added) onAdded();
      return true;
    } finally {
      setBusy(false);
    }
  };

  return { rows, setRows, saved, error, busy, gap: contentsProblem(rows), memberTypes, save };
}

export type OpeningContentsState = ReturnType<typeof useOpeningContents>;
