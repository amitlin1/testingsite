"use client";
import * as React from "react";
import { CircleAlert } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import type { MapErrorBar } from "../../lib/mapModel";
import { MAP_TEXT } from "../../lib/labels";

/**
 * The error bar above the map (route-fields spec §5.4.4; artboard 1, tweak showIssue): the FIRST
 * error (mapModel.mapErrorBar) and "עבור לשדה", which opens the cell's editor on that field. The
 * header's "{n} בעיות לתיקון" counts them all; a full list is not drawn (לא אומת).
 */

/** The id of "עבור לשדה": the header's "בעיה אחת לתיקון" brings the bar into view and focuses it
 *  (spec §5.2). */
export const MAP_ERROR_ACTION_ID = "rf-map-error-action";

export type FieldsMapErrorBarProps = {
  /** mapModel.mapErrorBar. */
  error: MapErrorBar;
  /** "עבור לשדה" — only when the error is on a cell. */
  onGoToField: () => void;
};

export default function FieldsMapErrorBar({ error, onGoToField }: FieldsMapErrorBarProps) {
  return (
    <Alert
      severity="warning"
      icon={<CircleAlert size={18} strokeWidth={1.75} aria-hidden />}
      className="rf-map-error"
      style={{ alignItems: "center" }}
      action={error.cell ? (
        <Button id={MAP_ERROR_ACTION_ID} variant="text" size="small" className="rf-map-error__action" onClick={onGoToField}>
          {MAP_TEXT.goToField}
        </Button>
      ) : undefined}
    >
      {error.text}
    </Alert>
  );
}
