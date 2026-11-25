"use client";
import * as React from "react";
import type { PhotoField } from "@/app/lib/station-fields/schema";
import { FIELD_SETTINGS_UNDRAWN_TEXT } from "../../lib/labels";
import { parsePhotoMin } from "../../lib/editorModel";

/**
 * The settings of a photo row (spec §5.5.2; no artboard draws them): how many shots the worker must
 * take (editorModel.parsePhotoMin). Every word is undrawn.
 *
 * There is no photo group to pick: the field owns its group (photo-groups.ts), which publishing names
 * after the station type and the field.
 */

export type PhotoFieldSettingsProps = {
  field: PhotoField;
  /** The minimum input's id (its <label htmlFor>). */
  minId: string;
  onChange: (next: PhotoField) => void;
};

export function PhotoFieldSettings({ field, minId, onChange }: PhotoFieldSettingsProps) {
  // The minimum as typed while its input is focused; an emptied input keeps the stored minimum.
  const [minText, setMinText] = React.useState<string | null>(null);

  return (
    <div className="sfe-photo">
      <label htmlFor={minId}>{FIELD_SETTINGS_UNDRAWN_TEXT.photoMinLabel}</label>
      <input
        id={minId}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        className="set-input set-input--num sfe-photo__min"
        title={FIELD_SETTINGS_UNDRAWN_TEXT.photoMinTitle}
        value={minText ?? String(field.min)}
        onChange={(e) => {
          const n = parsePhotoMin(e.target.value);
          setMinText(n == null ? "" : String(n));
          if (n != null && n !== field.min) onChange({ ...field, min: n });
        }}
        onBlur={() => setMinText(null)}
      />
    </div>
  );
}
