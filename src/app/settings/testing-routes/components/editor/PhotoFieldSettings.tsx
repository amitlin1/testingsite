"use client";
import * as React from "react";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import { apiFetch } from "@/lib/api/client";
import type { PhotoField } from "@/app/lib/station-fields/schema";
import { FIELD_SETTINGS_UNDRAWN_TEXT } from "../../lib/labels";
import { parsePhotoMin, withPhotoType } from "../../lib/editorModel";

/**
 * The settings of a photo row (spec §5.5.2: "photo: photo_type מ-GET /api/settings/photo-types
 * (קיים) ו-min"; no artboard draws them), in the options column: the photo type — a dense 38px
 * SearchableCombobox over the active photo types, by `code` — and "מינ׳", a 38px whole number
 * 0..20 (how many shots the worker must take). Every word is undrawn (labels.ts
 * FIELD_SETTINGS_UNDRAWN_TEXT).
 *
 * A code the list does not hold (a type deactivated after it was chosen) still shows, as its code —
 * the reference-items screen's rule for the same case. A row without a type is the lint's
 * PHOTO_TYPE_EMPTY (red edge here; the message under the row).
 */

export type PhotoFieldSettingsProps = {
  field: PhotoField;
  /** The minimum input's id (its <label htmlFor>). */
  minId: string;
  /** The lint's PHOTO_TYPE_EMPTY is on the field. */
  typeMissing: boolean;
  onChange: (next: PhotoField) => void;
};

type PhotoTypeOption = { code: string; label: string };

// ---- the photo types (one request for every photo row on screen) ---------------------------------
let photoTypesRequest: Promise<PhotoTypeOption[]> | null = null;

function readPhotoTypes(data: unknown): PhotoTypeOption[] {
  if (!Array.isArray(data)) return [];
  const out: PhotoTypeOption[] = [];
  for (const row of data) {
    if (typeof row !== "object" || row === null) continue;
    const { code, photo_type_desc: desc } = row as Record<string, unknown>;
    if (typeof code !== "string" || !code) continue;
    out.push({ code, label: typeof desc === "string" && desc.trim() ? desc.trim() : code });
  }
  return out;
}

/** GET /api/settings/photo-types (active types, in their sort order). A failed or empty answer is
 *  not kept, so the next photo row asks again. */
function loadPhotoTypes(): Promise<PhotoTypeOption[]> {
  if (!photoTypesRequest) {
    const request = apiFetch("/api/settings/photo-types")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return readPhotoTypes(await res.json());
      })
      .then((types) => {
        if (types.length === 0 && photoTypesRequest === request) photoTypesRequest = null;
        return types;
      }, (err: unknown) => {
        if (photoTypesRequest === request) photoTypesRequest = null;
        throw err;
      });
    photoTypesRequest = request;
  }
  return photoTypesRequest;
}

/** The photo types once loaded; null while loading. A failed load reads as no types. */
function usePhotoTypes(): PhotoTypeOption[] | null {
  const [types, setTypes] = React.useState<PhotoTypeOption[] | null>(null);
  React.useEffect(() => {
    let live = true;
    loadPhotoTypes().then(
      (t) => { if (live) setTypes(t); },
      (err: unknown) => {
        console.error("Failed to load photo types", err);
        if (live) setTypes([]);
      },
    );
    return () => { live = false; };
  }, []);
  return types;
}

// ---- the settings ---------------------------------------------------------------------------------
export function PhotoFieldSettings({ field, minId, typeMissing, onChange }: PhotoFieldSettingsProps) {
  const types = usePhotoTypes();
  const code = field.photo_type;
  const options = React.useMemo((): PhotoTypeOption[] => {
    const list = types ?? [];
    return code && !list.some((t) => t.code === code) ? [...list, { code, label: code }] : list;
  }, [types, code]);
  const value = options.find((t) => t.code === code) ?? null;
  // The minimum as typed while its input is focused; an emptied input keeps the stored minimum.
  const [minText, setMinText] = React.useState<string | null>(null);

  return (
    <div className="sfe-photo">
      <div className="sfe-photo__type">
        <SearchableCombobox<PhotoTypeOption>
          dense
          denseHeight={38}
          options={options}
          value={value}
          loading={types == null}
          onChange={(t) => {
            if (t && t.code !== code) onChange(withPhotoType(field, t.code));
          }}
          getOptionLabel={(t) => t.label}
          isOptionEqualToValue={(a, b) => a.code === b.code}
          disableClearable
          placeholder={FIELD_SETTINGS_UNDRAWN_TEXT.photoTypePlaceholder}
          ariaLabel={FIELD_SETTINGS_UNDRAWN_TEXT.photoTypeLabel}
          error={typeMissing}
          inputAttributes={{ "aria-invalid": typeMissing || undefined }}
        />
      </div>
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
