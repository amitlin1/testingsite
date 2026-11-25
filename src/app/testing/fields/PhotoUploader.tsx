"use client";
import * as React from "react";
import { Alert, Box, Button, CircularProgress, IconButton, Typography } from "@/components/ui";
import {
  AddAPhoto as AddAPhotoIcon, Check as CheckIcon, Close as CloseIcon, PhotoLibrary as PhotoLibraryIcon, Warning as WarningIcon,
} from "@/components/ui/icons";
import type { DraftShot } from "@/app/lib/station-fields/evaluate";
import { BLUE, GREEN, HAIR, MUTED, PARCHMENT, RED } from "@/components/ui/colors";
import "./photo-uploader.css";

/** A reference image a shot is compared with (the station type's set). */
export type RefImg = { id: number; url: string };

// Upload cap enforced in the browser, mirroring MAX_FILE_SIZE_MB on
// /api/items/[id]/files/presign (default 100). A plain constant on purpose: a
// NEXT_PUBLIC_ env var is inlined at build time, so a runtime .env change would
// silently not apply here. If an operator lowers the server cap below this the
// server still rejects the file and the shot is marked failed - the guards stack.
const MAX_PHOTO_MB = 100;
const MAX_PHOTO_BYTES = MAX_PHOTO_MB * 1024 * 1024;

/** One filmstrip tile: a reference image or a photo, picking the frame shown large. */
function FilmTile({ src, label, active, shot, badge, onClick }: {
  src?: string; label: string; active: boolean; shot?: DraftShot; badge?: string; onClick: () => void;
}) {
  return (
    <button type="button" className="tst-film" onClick={onClick}
      aria-label={label} aria-current={active ? "true" : undefined}
      style={{ border: shot?.failed ? `2.5px solid ${RED}` : active ? `2.5px solid ${BLUE}` : shot ? `1.5px solid ${GREEN}` : `1.5px solid ${HAIR}` }}>
      {src && <Box component="img" src={src} alt="" sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover", opacity: shot?.uploading ? 0.5 : 1 }} />}
      {badge && <Box component="span" sx={{ position: "absolute", bottom: 5, insetInlineStart: 5, fontSize: "var(--text-micro)", fontWeight: 600, color: "var(--color-on-primary)", bgcolor: "color-mix(in srgb, var(--color-ink) 55%, transparent)", borderRadius: "6px", px: 0.75, py: "1px", fontVariantNumeric: "tabular-nums" }}>{badge}</Box>}
      {shot && !shot.uploading && (
        <Box component="span" sx={{ position: "absolute", top: 4, insetInlineStart: 4, width: 20, height: 20, borderRadius: "var(--r-pill)", bgcolor: shot.failed ? RED : GREEN, color: "var(--color-on-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {shot.failed ? <WarningIcon sx={{ fontSize: 12 }} aria-hidden /> : <CheckIcon sx={{ fontSize: 13 }} aria-hidden />}
        </Box>
      )}
      {/* Centred by inset + auto margins (a physical left:50% with a logical margin drifted in RTL). */}
      {shot?.uploading && <CircularProgress size={18} aria-hidden sx={{ position: "absolute", inset: 0, margin: "auto" }} />}
    </button>
  );
}

/**
 * The reference images and the worker's photos are two rows, both always on
 * screen: a photo never covers the reference it is compared with, however many
 * are taken. The counter still reads photos against the reference count. Large
 * focused frame + big upload button + the two rows.
 */
export function PhotoUploader({ photos, refImages, onPick, onRemove }: {
  photos: DraftShot[]; refImages: RefImg[]; onPick: (file: File) => void; onRemove: (idx: number) => void;
}) {
  // One picker: the device's files, several images in one go, like the
  // reference-items screen. No direct camera — `capture` makes the browser
  // ignore `multiple`, and the stations do not run on https anyway.
  const galleryRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  // Files the last pick refused, listed until the next pick replaces them.
  const [rejected, setRejected] = React.useState<string[]>([]);
  const total = refImages.length;
  const captured = photos.length;
  const hasSlots = total > 0;

  // The frame shown large: a new or removed shot shows the last photo (the
  // first reference while there is none); a tile picks it by hand. Adjusted
  // during render.
  type Active = { kind: "ref" | "shot"; idx: number };
  const [active, setActive] = React.useState<Active>({ kind: "ref", idx: 0 });
  const [activeFor, setActiveFor] = React.useState<{ captured: number; total: number } | null>(null);
  if (!activeFor || activeFor.captured !== captured || activeFor.total !== total) {
    setActiveFor({ captured, total });
    setActive(captured > 0 ? { kind: "shot", idx: captured - 1 } : { kind: "ref", idx: 0 });
  }

  const openGallery = () => galleryRef.current?.click();

  // Every image in the selection becomes its own shot (one upload each, so a
  // single failure never takes the rest down). Non-images and oversized files are
  // refused here, before any bytes leave the browser, instead of coming back as a
  // 400 that nothing on screen explains.
  const takeFiles = (list: FileList | null) => {
    const picked = [...(list ?? [])];
    const bad = picked.filter((f) => !f.type.startsWith("image/") || f.size > MAX_PHOTO_BYTES);
    setRejected(bad.map((f) => f.name));
    picked.filter((f) => !bad.includes(f)).forEach(onPick);
  };

  const activeShot: DraftShot | undefined = active.kind === "shot" ? photos[active.idx] : undefined;
  const activeRef: RefImg | undefined = active.kind === "ref" ? refImages[active.idx] : undefined;
  const activeIsCaptured = !!activeShot;
  const bigSrc = activeShot?.previewUrl ?? activeRef?.url;

  const failedCount = photos.filter((s) => s.failed).length;
  const pillText = activeShot?.failed ? "ההעלאה נכשלה" : activeIsCaptured ? `התמונה שלי ${active.idx + 1}` : `תמונת ייחוס ${active.idx + 1}`;
  const groupTitle = { fontSize: "var(--text-small)", fontWeight: 600, color: "var(--color-ink-muted-80)" } as const;
  // One line covering both ways a photo can fail to reach storage: refused here
  // before upload, or refused by the server mid-upload.
  const rejectedMsg = rejected.length === 1
    ? `הקובץ ${rejected[0]} לא הועלה — חריגה מ-${MAX_PHOTO_MB}MB או קובץ שאינו תמונה`
    : rejected.length > 1
      ? `${rejected.length} קבצים לא הועלו — חריגה מ-${MAX_PHOTO_MB}MB או קבצים שאינם תמונה`
      : "";
  const failedMsg = failedCount === 1
    ? "העלאת תמונה אחת נכשלה (מסומנת באדום) — יש להסיר ולצלם שוב"
    : failedCount > 1
      ? `העלאת ${failedCount} תמונות נכשלה (מסומנות באדום) — יש להסיר ולצלם שוב`
      : "";
  const alertMsg = [rejectedMsg, failedMsg].filter(Boolean).join(" · ");
  // Extra photos beyond the reference slots get their own tail on the counter.
  // The "a / b" ratio is isolated LTR, or RTL would show it as "b / a".
  const extra = hasSlots ? Math.max(0, captured - total) : 0;
  const counter = hasSlots
    ? <><bdi dir="ltr">{Math.min(captured, total)} / {total}</bdi> צולמו{extra ? ` (+${extra})` : ""}</>
    : <>{captured} צילומים</>;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {/* The counter says it in words; the dots are decoration. */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        {hasSlots && (
          <Box aria-hidden sx={{ flex: 1, display: "flex", gap: "6px" }}>
            {refImages.map((_, i) => (
              <Box key={i} sx={{ flex: 1, height: 4, borderRadius: "var(--r-pill)", bgcolor: photos[i]?.failed ? RED : i < captured ? GREEN : i === captured ? BLUE : HAIR }} />
            ))}
          </Box>
        )}
        {!hasSlots && <Box sx={{ flex: 1 }} />}
        <Typography role="status" sx={{ fontSize: "var(--text-small)", fontWeight: 700, color: BLUE, whiteSpace: "nowrap", bgcolor: "var(--color-primary-soft)", borderRadius: "var(--r-pill)", px: 1.5, py: 0.5, fontVariantNumeric: "tabular-nums" }}>
          {counter}
        </Typography>
      </Box>

      <Box
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); takeFiles(e.dataTransfer.files); }}
        sx={{ position: "relative", height: 420, borderRadius: "var(--r-lg)", overflow: "hidden", border: dragging ? `2px dashed ${BLUE}` : `1px solid ${HAIR}`, bgcolor: dragging ? "var(--color-primary-tint)" : PARCHMENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {bigSrc ? (
          <Box component="img" src={bigSrc} alt={pillText} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, color: MUTED }}>
            <AddAPhotoIcon sx={{ fontSize: 52 }} aria-hidden />
            <Typography sx={{ fontSize: "var(--text-body-sm)" }}>תמונת ייחוס · צלם את הפריט</Typography>
            <Typography sx={{ fontSize: "var(--text-small)" }}>או גרור תמונות לכאן · ניתן לבחור כמה</Typography>
          </Box>
        )}
        {bigSrc && (
          <Box sx={{ position: "absolute", top: 11, insetInlineEnd: 11, fontSize: "var(--text-micro)", fontWeight: 600, color: activeShot?.failed ? RED : activeIsCaptured ? GREEN : "var(--color-ink-muted-70)", bgcolor: "color-mix(in srgb, var(--color-canvas) 85%, transparent)", borderRadius: "var(--r-pill)", px: 1.25, py: 0.5 }}>
            {pillText}
          </Box>
        )}
        {activeIsCaptured && (
          <IconButton size="small" round title="הסר תמונה" onClick={() => onRemove(active.idx)}
            sx={{ position: "absolute", top: 8, insetInlineStart: 8 }}>
            <CloseIcon sx={{ fontSize: 16 }} aria-hidden />
          </IconButton>
        )}
        {activeShot?.uploading && <CircularProgress size={26} aria-label="מעלה תמונה" sx={{ position: "absolute", inset: 0, margin: "auto" }} />}
      </Box>

      <Button onClick={openGallery} size="large" className="tst-photo-btn" startIcon={<PhotoLibraryIcon fontSize={20} aria-hidden />}>
        העלה תמונות
      </Button>

      {alertMsg && <Alert severity="error">{alertMsg}</Alert>}

      {hasSlots && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography sx={groupTitle}>תמונות ייחוס ({total})</Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: "14px" }}>
            {refImages.map((ref, i) => (
              <FilmTile key={ref.id} src={ref.url} label={`תמונת ייחוס ${i + 1}`} badge={total > 1 ? `ייחוס ${i + 1}` : "ייחוס"}
                active={active.kind === "ref" && active.idx === i} onClick={() => setActive({ kind: "ref", idx: i })} />
            ))}
          </Box>
        </Box>
      )}

      {(hasSlots || captured > 0) && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, pb: 0.5 }}>
          {hasSlots && <Typography sx={groupTitle}>התמונות שלי ({captured})</Typography>}
          {captured > 0 ? (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: "14px" }}>
              {photos.map((shot, i) => (
                <FilmTile key={i} src={shot.previewUrl} shot={shot} badge={String(i + 1)}
                  label={`התמונה שלי ${i + 1}${shot.failed ? " — ההעלאה נכשלה" : shot.uploading ? " — מעלה" : ""}`}
                  active={active.kind === "shot" && active.idx === i} onClick={() => setActive({ kind: "shot", idx: i })} />
              ))}
            </Box>
          ) : (
            <Box sx={{ border: `1.5px dashed ${HAIR}`, borderRadius: "13px", p: 2, textAlign: "center", color: MUTED, fontSize: "var(--text-body-sm)" }}>
              עוד לא העלית תמונות. לחץ &quot;העלה תמונות&quot; או גרור לכאן.
            </Box>
          )}
        </Box>
      )}

      <input ref={galleryRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { takeFiles(e.target.files); e.target.value = ""; }} />
    </Box>
  );
}
