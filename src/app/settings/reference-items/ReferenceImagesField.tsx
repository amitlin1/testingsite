"use client";

import * as React from "react";
import { IconButton } from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";
import { CloudUploadOutlined as CloudUploadOutlinedIcon } from "@/components/ui/icons";
import { Star as StarIcon } from "@/components/ui/icons";
import type { FormImage, PhotoType } from "./referenceForm";

/**
 * The images of a reference item's form: the photo group new files go to
 * ("צילום אריזה" / "צילום פריט" / ...), the drop zone, and the thumbnails
 * grouped by photo type, with the cover star. States (hover / focus / drag)
 * live in settings.css (.ri-*).
 */
export default function ReferenceImagesField({ idPrefix, photoTypes, images, primaryKey, uploadType, onUploadType, onAddFiles, onRemove, onPrimary }: {
  idPrefix: string;
  photoTypes: PhotoType[];
  images: FormImage[];
  primaryKey: string | null;
  uploadType: string;
  onUploadType: (code: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemove: (key: string) => void;
  onPrimary: (key: string) => void;
}) {
  const [dragOver, setDragOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const labelId = `${idPrefix}-images-label`;

  // Thumbnails grouped by photo type — one section per group so it's obvious
  // which reference set each image belongs to.
  const knownCodes = photoTypes.map((pt) => pt.code);
  const groups: Array<{ code: string; label: string; images: FormImage[] }> = [
    ...photoTypes.map((pt) => ({ code: pt.code, label: pt.photo_type_desc, images: images.filter((i) => i.photoType === pt.code) })),
    // Safety net: images whose code isn't in the active list (e.g. a type
    // deactivated after upload) still render, under their code.
    ...[...new Set(images.map((i) => i.photoType).filter((c) => !knownCodes.includes(c)))]
      .map((code) => ({ code, label: code, images: images.filter((i) => i.photoType === code) })),
  ].filter((g) => g.images.length > 0);

  return (
    <div role="group" aria-labelledby={labelId}>
      <div id={labelId} className="sh-field-label">תמונות ייחוס</div>

      {/* Photo-group selector: newly-added files are tagged with the active group. */}
      {photoTypes.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>העלאה אל:</span>
          {photoTypes.map((pt) => (
            <button key={pt.code} type="button" className="ri-chip" aria-pressed={pt.code === uploadType} onClick={() => onUploadType(pt.code)}>
              {pt.photo_type_desc}
            </button>
          ))}
        </div>
      )}

      {/* Drop zone: a click or Enter / Space opens the file picker. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="הוספת תמונות ייחוס: גרור תמונות לכאן או לחץ לבחירה"
        className={"ri-drop" + (dragOver ? " ri-drop--over" : "")}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); }
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onAddFiles([...(e.dataTransfer?.files ?? [])]); }}
      >
        <span style={{ width: 40, height: 40, borderRadius: "var(--r-pill)", background: "var(--color-canvas)", border: "1px solid var(--color-hairline)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-ink-muted-48)" }}>
          <CloudUploadOutlinedIcon fontSize={20} aria-hidden />
        </span>
        <span style={{ fontSize: "var(--text-body-sm)", color: "var(--color-ink)" }}>
          גרור תמונות לכאן, או{" "}
          <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>לחץ לבחירה</span>
        </span>
        <span style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>
          PNG או JPG · עד 50MB לתמונה · ניתן לבחור כמה
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          tabIndex={-1}
          aria-hidden
          onChange={(e) => { onAddFiles([...(e.target.files ?? [])]); e.target.value = ""; }}
          style={{ display: "none" }}
        />
      </div>

      {groups.map((group) => (
        <div key={group.code} style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", marginBottom: "var(--space-xs)" }}>
            <span style={{ fontSize: "var(--text-small)", fontWeight: 600, color: "var(--color-ink)" }}>{group.label}</span>
            <span style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)", fontVariantNumeric: "tabular-nums" }}>
              {group.images.length} תמונות
            </span>
            <span style={{ flex: 1, height: 1, background: "var(--color-divider-soft)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: "var(--space-sm)" }}>
            {group.images.map((img) => {
              const isPrimary = img.key === primaryKey;
              return (
                <div
                  key={img.key}
                  style={{
                    position: "relative",
                    aspectRatio: "1 / 1",
                    borderRadius: "var(--r-sm)",
                    overflow: "hidden",
                    border: isPrimary ? "2px solid var(--color-primary)" : "1px solid var(--color-hairline)",
                    background: "var(--color-canvas-parchment)",
                  }}
                >
                  {/* contain so the full image is visible in the square preview */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.fileName} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                  <div style={{ position: "absolute", top: 4, insetInlineStart: 4, display: "flex", gap: 4 }}>
                    <IconButton
                      size="small"
                      round
                      color={isPrimary ? "primary" : "default"}
                      title={isPrimary ? "תמונת הכריכה" : `הגדר את ${img.fileName} כתמונת כריכה`}
                      aria-pressed={isPrimary}
                      onClick={(e) => { e.stopPropagation(); onPrimary(img.key); }}
                    >
                      <StarIcon fontSize={14} fill={isPrimary ? "currentColor" : "none"} aria-hidden />
                    </IconButton>
                    <IconButton
                      size="small"
                      round
                      color="error"
                      title={`הסר את ${img.fileName}`}
                      onClick={(e) => { e.stopPropagation(); onRemove(img.key); }}
                    >
                      <CloseIcon fontSize={14} aria-hidden />
                    </IconButton>
                  </div>
                  {isPrimary && (
                    <span style={{ position: "absolute", bottom: 0, insetInline: 0, background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: "var(--text-micro)", fontWeight: 600, textAlign: "center", padding: "2px 0" }}>
                      כריכה
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
