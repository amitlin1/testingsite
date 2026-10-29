"use client";

import * as React from "react";
import { TextField } from "@/components/ui";
import ReferenceImagesField from "./ReferenceImagesField";
import { withFiles, withStation, withoutImage, type FieldErrors, type FieldKey, type ItemDraft, type StationsFor } from "./referenceForm";

/**
 * A reference item's fields — the type slot, manufacturer SKU, weight,
 * manufacturer, name, images and notes. The regular dialog, the package
 * reference's box and each of its content lines all use it, so they are the
 * same form. `typeField` is the type slot: a combobox in the regular dialog,
 * a locked field in the package one.
 */
export default function ReferenceItemFields({ idPrefix, draft, onDraft, errors, onClearError, stations, typeField, skuHelp, nameLabel = "שם הפריט", namePlaceholder = "תיאור קצר", weightLabel = "משקל (גר׳)" }: {
  idPrefix: string;
  /** The stations of the item type's routes that show reference images, in route order. */
  stations: StationsFor;
  draft: ItemDraft;
  onDraft: (next: ItemDraft) => void;
  errors: FieldErrors;
  onClearError: (key: FieldKey) => void;
  typeField: React.ReactNode;
  skuHelp?: string;
  nameLabel?: string;
  namePlaceholder?: string;
  weightLabel?: string;
}) {
  const set = (key: FieldKey | "notes", patch: Partial<ItemDraft>) => {
    onDraft({ ...draft, ...patch });
    if (key !== "notes") onClearError(key);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-ml)" }}>
      <div className="ri-form-grid">
        {typeField}
        <TextField
          id={`${idPrefix}-sku`}
          label="מק״ט יצרן"
          required
          fullWidth
          value={draft.sku}
          onChange={(e) => set("sku", { sku: e.target.value })}
          placeholder="לדוגמה: 745781-4"
          error={!!errors.sku}
          helperText={errors.sku ?? skuHelp}
          // A code: typed left-to-right, aligned with the Hebrew labels.
          inputProps={{ dir: "ltr", style: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
        />
        <TextField
          id={`${idPrefix}-weight`}
          label={weightLabel}
          required
          fullWidth
          value={draft.weight}
          onChange={(e) => set("weight", { weight: e.target.value })}
          placeholder="לדוגמה: 500"
          error={!!errors.weight}
          helperText={errors.weight}
          inputProps={{ dir: "ltr", inputMode: "decimal", style: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
        />
      </div>

      <div className="ri-form-grid">
        <TextField
          id={`${idPrefix}-manu`}
          label="יצרן"
          required
          fullWidth
          value={draft.manu}
          onChange={(e) => set("manu", { manu: e.target.value })}
          placeholder="לדוגמה: TE Connectivity"
          error={!!errors.manu}
          helperText={errors.manu}
        />
        <TextField
          id={`${idPrefix}-name`}
          label={nameLabel}
          required
          fullWidth
          value={draft.name}
          onChange={(e) => set("name", { name: e.target.value })}
          placeholder={namePlaceholder}
          error={!!errors.name}
          helperText={errors.name}
        />
      </div>

      <ReferenceImagesField
        idPrefix={idPrefix}
        stations={stations}
        images={draft.images}
        primaryKey={draft.primaryKey}
        onAddFiles={(stationTypeId, files) => onDraft(withFiles(draft, files, stationTypeId))}
        onStation={(key, stationTypeId) => onDraft(withStation(draft, key, stationTypeId))}
        onRemove={(key) => onDraft(withoutImage(draft, key))}
        onPrimary={(key) => onDraft({ ...draft, primaryKey: key })}
      />

      <TextField
        id={`${idPrefix}-notes`}
        label={<>הערות <span style={{ color: "var(--color-ink-muted-48)", fontWeight: 400 }}>· לא חובה</span></>}
        value={draft.notes}
        onChange={(e) => set("notes", { notes: e.target.value })}
        placeholder="נקודות לבדיקה, מאפיינים מיוחדים, או סטיות מותרות…"
        multiline
        minRows={3}
        fullWidth
      />
    </div>
  );
}
