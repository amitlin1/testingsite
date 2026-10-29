"use client";
import * as React from "react";
import type { PhotoField } from "@/app/lib/station-fields/schema";
import { FIELD_SETTINGS_UNDRAWN_TEXT } from "../../lib/labels";
import { parsePhotoMin } from "../../lib/editorModel";

/**
 * The settings of a photo row (spec §5.5.2; no artboard draws them), in the options column: "מינ׳",
 * a 38px whole number 0..20 (how many shots the worker must take). Every word is undrawn (labels.ts
 * FIELD_SETTINGS_UNDRAWN_TEXT).
 *
 * There is no photo group to pick: the field owns its group (schema.ts fieldPhotoCode), which
 * publishing names "{station type} · {field label}".
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
        className="stp-input stp-input--num sfe-photo__min"
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

export default PhotoFieldSettings;
