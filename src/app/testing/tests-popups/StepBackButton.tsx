"use client";
import React from "react";
import { Undo2 } from "lucide-react";
import type { PackageItemView } from "@/app/lib/packages/read";

/**
 * "החזר" beside an item's name in the closing wizard's items step: back to the
 * test before the closing (api/testing/step-back stops the closing for it).
 * Shown for an item that reached the closing whose step before is its own —
 * not the box's opening — and only when the page gave the handler (managers).
 */
export function StepBackButton({ it, onStepBackItem }: {
  it: PackageItemView;
  onStepBackItem?: (item: PackageItemView) => void;
}) {
  if (!onStepBackItem || !it.arrived_at_closing || !it.prev_step_desc || it.prev_step_package_level) return null;
  return (
    <button type="button" className="tst-step-back" onClick={() => onStepBackItem(it)}
      title={`החזרה ל${it.prev_step_desc}`} aria-label={`החזרת ${it.item_type_desc} ל${it.prev_step_desc}`}>
      <Undo2 size={12} strokeWidth={2} aria-hidden />
      החזר
    </button>
  );
}
