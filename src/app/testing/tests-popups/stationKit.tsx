"use client";
import * as React from "react";
import {
  Dialog, Box, Typography, Button, TextField, Stack, Alert, IconButton,
  CircularProgress, useMediaQuery,
} from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";
import { ArrowForward as ArrowForwardIcon } from "@/components/ui/icons";
import { ArrowBack as ArrowBackIcon } from "@/components/ui/icons";
import { CheckCircle as CheckCircleIcon } from "@/components/ui/icons";
import { AddAPhoto as AddAPhotoIcon } from "@/components/ui/icons";
import { PhotoLibrary as PhotoLibraryIcon } from "@/components/ui/icons";
import { Warning as WarningIcon } from "@/components/ui/icons";
import { Check as CheckIcon } from "@/components/ui/icons";
import { Person as PersonIcon } from "@/components/ui/icons";
import type { ItemRow } from "../../../types";
import { apiFetch } from "@/lib/api/client";

/**
 * stationKit — the shared visual language for the testing-station wizards
 * (Shifthouse "3A" handoff). One copy of the dialog chrome (rail + stepper +
 * header + footer), the SKU screen, the verdict card and the photo uploader, so
 * every station dialog reads as one system. Photo.tsx predates this kit and keeps
 * its own copies; new stations (PhotoStation / VerdictStation) build on it.
 */

// ---- Design tokens ----
export const BLUE = "#0066cc";
export const OK = "#1f8a5b";
export const BAD = "#bf3535";
export const INK = "#1d1d1f";
export const MUTED = "#7a7a7a";
export const MUTED_LT = "#9a9aa0";
export const HAIR = "#e0e0e0";
export const PARCHMENT = "#f5f5f7";
export const CHIP_BG = "#f0f0f2";
export const PRODUCT_SHADOW = "rgba(0,0,0,0.22) 3px 5px 30px";

export type RefImg = { id: number; url: string };
export type Shot = { previewUrl: string; objectKey?: string; uploading?: boolean; failed?: boolean };
export type Photos = { photos: Shot[]; ok: "" | "pass" | "fail"; note: string };
export const emptyPhotos = (): Photos => ({ photos: [], ok: "", note: "" });

// Upload cap enforced in the browser, mirroring MAX_FILE_SIZE_MB on
// /api/items/[id]/files (default 100). A plain constant on purpose: a
// NEXT_PUBLIC_ env var is inlined at build time, so a runtime .env change would
// silently not apply here. If an operator lowers the server cap below this the
// server still rejects the file and the shot is marked failed - the guards stack.
const MAX_PHOTO_MB = 100;
const MAX_PHOTO_BYTES = MAX_PHOTO_MB * 1024 * 1024;

// The manufacturer-SKU scan screen is identical across every station.
export const SKU_TITLE = "סריקת מק״ט יצרן";
export const SKU_DESC = "סרוק את מק״ט היצרן של המוצר לזיהוי פריט הייחוס.";

/** Reference ("RU") lookup — reference weight + images grouped by photo-type code. */
export async function lookupRU(sku: string, itemTypeId: number | null) {
  const qs = new URLSearchParams({ sku });
  if (itemTypeId != null) qs.set("itemTypeId", String(itemTypeId));
  const res = await apiFetch(`/api/testing/reference-lookup?${qs.toString()}`);
  const d = await res.json();
  return {
    hasRU: !!d.hasRU,
    imagesByType: (d.imagesByType ?? {}) as Record<string, RefImg[]>,
  };
}

// ---- presentational helpers ----
export function SystemNote({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ bgcolor: "rgba(0,102,204,0.05)", border: "1px solid rgba(0,102,204,0.14)", borderRadius: "14px", p: "14px 16px" }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: BLUE, letterSpacing: "0.02em", mb: 0.5 }}>הודעת מערכת</Typography>
      <Typography sx={{ fontSize: 15, lineHeight: 1.5, color: INK }}>{children}</Typography>
    </Box>
  );
}

export function PassFail({ value, onChange }: { value: Photos["ok"]; onChange: (v: "pass" | "fail") => void }) {
  const opt = (v: "pass" | "fail") => {
    const active = value === v;
    const color = v === "pass" ? OK : BAD;
    const tint = v === "pass" ? "rgba(31,138,91,0.08)" : "rgba(191,53,53,0.08)";
    return (
      <Button key={v} onClick={() => onChange(v)} disableElevation
        startIcon={v === "pass" ? <CheckIcon /> : <CloseIcon />}
        sx={{
          flex: 1, height: 56, borderRadius: "13px", fontWeight: 600, fontSize: 16,
          textTransform: "none", boxShadow: "none",
          border: `1.5px solid ${active ? color : HAIR}`,
          bgcolor: active ? tint : "#fff", color: active ? color : INK,
          "&:hover": { bgcolor: active ? tint : "#fafafc", borderColor: active ? color : "#c7c7cf" },
          "&:active": { transform: "scale(0.98)" },
        }}>
        {v === "pass" ? "תקין" : "לא תקין"}
      </Button>
    );
  };
  return <Stack direction="row" spacing={1.5}>{opt("pass")}{opt("fail")}</Stack>;
}

/** Section header for the photos block: "תיעוד בתמונות" + soft divider line. */
export function PhotoSection({ children }: { children: React.ReactNode }) {
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, pb: "12px", borderBottom: "1px solid #ececec", mb: 2 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.2px", color: INK, whiteSpace: "nowrap" }}>תיעוד בתמונות</Typography>
      </Box>
      {children}
    </Box>
  );
}

/** Verdict + notes card — "בדיקה תקינה?" pass/fail + free-text notes. */
export function VerdictCard({ ok, note, onOk, onNote, rows = 3 }: {
  ok: Photos["ok"]; note: string; onOk: (v: "pass" | "fail") => void; onNote: (v: string) => void; rows?: number;
}) {
  return (
    <Box sx={{ border: `1px solid ${HAIR}`, borderRadius: "18px", p: "22px 24px", display: "flex", flexDirection: "column", gap: 2.25 }}>
      <Box>
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: INK, mb: 1.5 }}>בדיקה תקינה?</Typography>
        <PassFail value={ok} onChange={onOk} />
      </Box>
      <Box>
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: INK, mb: 1.25 }}>הערות</Typography>
        <TextField value={note} onChange={(e) => onNote(e.target.value)} placeholder="הוסף הערה…" multiline rows={rows} fullWidth />
      </Box>
    </Box>
  );
}

/** The manufacturer-SKU scan screen body — shared by every station's first step. */
export function SkuScreen({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Stack spacing={1.5}>
      <SystemNote>יש לסרוק את מק״ט היצרן של המוצר. פרטי הסריקה נשמרים במערכת ובדו״ח.</SystemNote>
      <TextField autoFocus label="מק״ט יצרן" value={value} onChange={(e) => onChange(e.target.value)} placeholder="סרוק או הזן מק״ט…" fullWidth />
    </Stack>
  );
}

/**
 * PhotoUploader — slots model: each reference image is a slot to fill; photos[i]
 * fills slot i. Large focused frame + big capture button + filmstrip + counter.
 */
export function PhotoUploader({ photos, refImages, onPick, onRemove }: {
  photos: Shot[]; refImages: RefImg[]; onPick: (file: File) => void; onRemove: (idx: number) => void;
}) {
  // Two pickers, because one input cannot do both: where the browser honours
  // `capture` it ignores `multiple`. Camera = one shot at a time; the gallery
  // picker takes several images in one go, like the reference-items screen.
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const galleryRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  // Files the last pick refused, listed until the next pick replaces them.
  const [rejected, setRejected] = React.useState<string[]>([]);
  const total = refImages.length;
  const captured = photos.length;
  const hasSlots = total > 0;

  const [activeIdx, setActiveIdx] = React.useState(0);
  React.useEffect(() => {
    const target = hasSlots ? Math.min(captured, total - 1) : Math.max(0, captured - 1);
    setActiveIdx(target < 0 ? 0 : target);
  }, [captured, total, hasSlots]);

  const openCamera = () => cameraRef.current?.click();
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

  const activeShot: Shot | undefined = photos[activeIdx];
  const activeRef: RefImg | undefined = refImages[activeIdx];
  const activeIsCaptured = !!activeShot;
  const bigSrc = activeShot?.previewUrl ?? activeRef?.url;

  const failedCount = photos.filter((s) => s.failed).length;
  const pillText = activeShot?.failed ? "ההעלאה נכשלה" : activeIsCaptured ? "צולם" : "תמונת ייחוס";
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
  // Extra photos beyond the reference slots are legitimate now that a pick can
  // bring in several at once, so they get their own tail on the counter.
  const extra = hasSlots ? Math.max(0, captured - total) : 0;
  const counterText = hasSlots
    ? `${Math.min(captured, total)} / ${total} צולמו${extra ? ` (+${extra})` : ""}`
    : `${captured} צילומים`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {/* Progress: dots + counter */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        {hasSlots && (
          <Box sx={{ flex: 1, display: "flex", gap: "6px" }}>
            {refImages.map((_, i) => (
              <Box key={i} sx={{ flex: 1, height: 4, borderRadius: "9999px", bgcolor: photos[i]?.failed ? BAD : i < captured ? OK : i === activeIdx ? BLUE : HAIR }} />
            ))}
          </Box>
        )}
        {!hasSlots && <Box sx={{ flex: 1 }} />}
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: BLUE, whiteSpace: "nowrap", bgcolor: "rgba(0,102,204,0.08)", borderRadius: "9999px", px: 1.5, py: 0.5, fontVariantNumeric: "tabular-nums" }}>
          {counterText}
        </Typography>
      </Box>

      {/* Large focused frame */}
      <Box
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); takeFiles(e.dataTransfer.files); }}
        sx={{ position: "relative", height: 420, borderRadius: "18px", overflow: "hidden", border: dragging ? `2px dashed ${BLUE}` : `1px solid ${HAIR}`, bgcolor: dragging ? "rgba(0,102,204,0.06)" : "#f0f0f2", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {bigSrc ? (
          <Box component="img" src={bigSrc} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, color: MUTED_LT }}>
            <AddAPhotoIcon sx={{ fontSize: 52 }} />
            <Typography sx={{ fontSize: 14 }}>תמונת ייחוס · צלם את הפריט</Typography>
            <Typography sx={{ fontSize: 12.5 }}>או גרור תמונות לכאן · ניתן לבחור כמה</Typography>
          </Box>
        )}
        {bigSrc && (
          <Box sx={{ position: "absolute", top: 11, insetInlineEnd: 11, fontSize: 11, fontWeight: 600, color: activeShot?.failed ? BAD : activeIsCaptured ? OK : "#8a7c68", bgcolor: "rgba(255,255,255,0.82)", borderRadius: "9999px", px: 1.25, py: 0.5 }}>
            {pillText}
          </Box>
        )}
        {activeIsCaptured && (
          <IconButton size="small" onClick={() => onRemove(activeIdx)}
            sx={{ position: "absolute", top: 8, insetInlineStart: 8, bgcolor: "rgba(0,0,0,0.5)", color: "#fff", p: "3px", "&:hover": { bgcolor: "rgba(0,0,0,0.7)" } }}>
            <CloseIcon sx={{ fontSize: 15 }} />
          </IconButton>
        )}
        {activeShot?.uploading && <CircularProgress size={26} sx={{ position: "absolute", color: BLUE }} />}
      </Box>

      {/* Camera (one shot) + gallery picker (several images at once) */}
      <Box sx={{ display: "flex", gap: 1.25 }}>
        <Button onClick={openCamera} variant="contained" disableElevation startIcon={<AddAPhotoIcon />}
          sx={{ flex: 2, height: 58, borderRadius: "14px", fontSize: 17, fontWeight: 600, textTransform: "none", boxShadow: "none", bgcolor: BLUE, "&:hover": { bgcolor: "#0058b3", boxShadow: "none" }, "&:active": { transform: "scale(0.98)" } }}>
          {hasSlots && captured >= total ? "צלם מחדש" : "צלם"}
        </Button>
        <Button onClick={openGallery} variant="outlined" disableElevation startIcon={<PhotoLibraryIcon />}
          sx={{ flex: 1, height: 58, borderRadius: "14px", fontSize: 15.5, fontWeight: 600, textTransform: "none", color: BLUE, borderColor: HAIR, "&:hover": { borderColor: BLUE, bgcolor: "rgba(0,102,204,0.04)" }, "&:active": { transform: "scale(0.98)" } }}>
          העלה תמונות
        </Button>
      </Box>

      {alertMsg && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, borderRadius: "12px", border: `1px solid ${BAD}`, bgcolor: "rgba(191,53,53,0.06)", px: 1.5, py: 1 }}>
          <WarningIcon sx={{ fontSize: 16, color: BAD, flexShrink: 0 }} />
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: BAD }}>{alertMsg}</Typography>
        </Box>
      )}

      {/* Filmstrip — flex-wrap row with even gaps */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: "14px", pb: 0.5 }}>
        {Array.from({ length: Math.max(total, captured) }).map((_, i) => {
          const shot = photos[i];
          const ref = refImages[i];
          const isCap = !!shot;
          const isActive = i === activeIdx;
          const src = shot?.previewUrl ?? ref?.url;
          return (
            <Box key={i} onClick={() => setActiveIdx(i)}
              sx={{ position: "relative", flex: "1 1 150px", minWidth: 130, maxWidth: 280, aspectRatio: "4 / 3", cursor: "pointer", borderRadius: "13px", overflow: "hidden",
                border: shot?.failed ? `2.5px solid ${BAD}` : isActive ? `2.5px solid ${BLUE}` : isCap ? `1.5px solid ${OK}` : `1.5px solid ${HAIR}`, bgcolor: "#f0f0f2" }}>
              {src && <Box component="img" src={src} sx={{ width: "100%", height: "100%", objectFit: "cover", opacity: shot?.uploading ? 0.5 : 1 }} />}
              {!isCap && <Box sx={{ position: "absolute", bottom: 5, insetInlineStart: 5, fontSize: 10, fontWeight: 600, color: "#fff", bgcolor: "rgba(0,0,0,0.45)", borderRadius: "6px", px: 0.75, py: "1px" }}>ייחוס</Box>}
              {isCap && !shot?.uploading && (
                <Box sx={{ position: "absolute", top: 4, insetInlineStart: 4, width: 20, height: 20, borderRadius: "9999px", bgcolor: shot?.failed ? BAD : OK, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {shot?.failed ? <WarningIcon sx={{ fontSize: 12 }} /> : <CheckIcon sx={{ fontSize: 13 }} />}
                </Box>
              )}
              {shot?.uploading && <CircularProgress size={18} sx={{ position: "absolute", top: "50%", left: "50%", mt: "-9px", ml: "-9px", color: BLUE }} />}
            </Box>
          );
        })}
      </Box>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { takeFiles(e.target.files); e.target.value = ""; }} />
      <input ref={galleryRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { takeFiles(e.target.files); e.target.value = ""; }} />
    </Box>
  );
}

// ================= dialog shell (rail + stepper + header + footer) =================
export type ShellPhase = { key: string; title: string; desc: string };

/**
 * StationShell — the exact Photo.tsx dialog chrome, extracted so every station
 * shares one implementation: left rail with item card + vertical stepper (desktop),
 * step chips (tablet/phone), header (phase title + description), and a footer whose
 * primary button is "המשך" mid-flow and the green finish button on the last phase.
 * The per-station flow supplies the phases, nav callbacks and the current body.
 */
export function StationShell({
  open, onClose, item, workerId, workerName, contextLabel,
  phases, currentIndex, onStep, onBack,
  error, onClearError,
  busy, submitting, canNext, onNext, canFinish, onFinish, finishLabel,
  children,
}: {
  open: boolean; onClose: () => void;
  item: ItemRow; workerId: number | null; workerName: string;
  contextLabel: string;
  phases: ShellPhase[]; currentIndex: number;
  onStep: (i: number) => void; onBack: () => void;
  error: string | null; onClearError: () => void;
  busy: boolean; submitting: boolean;
  canNext: boolean; onNext: () => void;
  canFinish: boolean; onFinish: () => void; finishLabel: string;
  children: React.ReactNode;
}) {
  // Real CSS media-query strings — the ui/ breakpoints helpers are stubs. See Photo.tsx.
  const isWide = useMediaQuery("(min-width: 900px)");   // ≥ 900px → left rail
  const isMobile = useMediaQuery("(max-width: 599px)"); // < 600px → full-screen

  const itemName = item.model?.trim() || `פריט #${item.item_id}`;
  const phase = phases[currentIndex];
  const isLast = currentIndex === phases.length - 1;

  return (
    <Dialog open={open} onClose={onClose} dir="rtl" maxWidth={false} fullScreen={isMobile}
      PaperProps={{
        sx: {
          width: isMobile ? "100vw" : isWide ? "max(920px, 72vw)" : "94vw",
          height: isMobile ? "100dvh" : isWide ? "min(900px, 92vh)" : "94vh",
          maxWidth: "none", maxHeight: "none",
          borderRadius: isMobile ? 0 : "20px",
          overflow: "hidden", boxShadow: PRODUCT_SHADOW,
          display: "flex", flexDirection: isWide ? "row" : "column",
        },
      }}>
      {/* Left rail (desktop) — item card + vertical stepper */}
      {isWide && (
        <Box sx={{ width: 264, flexShrink: 0, bgcolor: PARCHMENT, borderInlineEnd: `1px solid ${HAIR}`, display: "flex", flexDirection: "column", p: "24px 20px", minHeight: 0, overflowY: "auto" }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: BLUE, textTransform: "uppercase", mb: 1.5 }}>{contextLabel}</Typography>

          {/* Item identity card */}
          <Box sx={{ bgcolor: "#fff", border: `1px solid ${HAIR}`, borderRadius: "16px", p: 2, mb: 2.75 }}>
            <Typography sx={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.3px", color: INK }}>{itemName}</Typography>
            <Typography sx={{ fontSize: 12.5, color: MUTED, mt: 0.5 }}>#{item.item_id}{item.makat != null ? ` · מק״ט ${item.makat}` : ""}</Typography>
            {(item.customer_code || item.serial_no) && (
              <Typography sx={{ fontSize: 12.5, color: MUTED, mt: "2px" }}>
                {item.customer_code ? `לקוח ${item.customer_code}` : ""}{item.customer_code && item.serial_no ? " · " : ""}{item.serial_no ? `S/N ${item.serial_no}` : ""}
              </Typography>
            )}
            {workerId != null && (
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, mt: 1.5, bgcolor: "rgba(0,102,204,0.08)", borderRadius: "9999px", px: "11px", py: "4px", fontSize: 12, fontWeight: 600, color: BLUE }}>
                <PersonIcon sx={{ fontSize: 13 }} />{workerName || `#${workerId}`}
              </Box>
            )}
          </Box>

          {/* Vertical numbered stepper */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {phases.map((ph, i) => {
              const done = i < currentIndex;
              const on = i === currentIndex;
              return (
                <Box key={ph.key} onClick={() => onStep(i)} sx={{ display: "flex", alignItems: "center", gap: 1.5, p: "9px 10px", borderRadius: "12px", cursor: "pointer", bgcolor: on ? "rgba(0,102,204,0.07)" : "transparent" }}>
                  <Box sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: "9999px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                    ...(done ? { bgcolor: OK, color: "#fff" } : on ? { bgcolor: BLUE, color: "#fff" } : { bgcolor: "#fff", border: `1.5px solid ${HAIR}`, color: MUTED_LT }) }}>
                    {done ? <CheckIcon sx={{ fontSize: 15 }} /> : i + 1}
                  </Box>
                  <Typography sx={{ fontSize: 14, fontWeight: on ? 700 : 600, color: on || done ? INK : MUTED_LT }}>{ph.title}</Typography>
                </Box>
              );
            })}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12, color: MUTED_LT }}>שלב {currentIndex + 1} מתוך {phases.length}</Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        {/* Header */}
        <Box sx={{ p: isMobile ? "16px 18px" : "24px 32px", borderBottom: `1px solid ${HAIR}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5, flexShrink: 0 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            {!isWide && <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: BLUE, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{contextLabel} · {itemName}</Typography>}
            <Typography sx={{ fontSize: isWide ? 24 : 20, fontWeight: 700, letterSpacing: "-0.4px", mt: isWide ? 0 : "2px", color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{phase.title}</Typography>
            {isWide && <Typography sx={{ fontSize: 14, color: MUTED, mt: "4px" }}>{phase.desc}</Typography>}
          </Box>
          <IconButton onClick={onClose} sx={{ flexShrink: 0, alignSelf: "flex-start", width: 36, height: 36, bgcolor: CHIP_BG, color: MUTED, "&:hover": { bgcolor: "#e6e6ea" } }}>
            <CloseIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Box>

        {/* Step chips (tablet/phone) */}
        {!isWide && (
          <Box sx={{ display: "flex", gap: 1, overflowX: "auto", p: "12px 20px", borderBottom: `1px solid ${HAIR}` }}>
            {phases.map((ph, i) => {
              const on = i === currentIndex;
              const done = i < currentIndex;
              return (
                <Box key={ph.key} onClick={() => onStep(i)} sx={{ whiteSpace: "nowrap", fontSize: 13, fontWeight: 600, borderRadius: "9999px", px: "14px", py: "6px", cursor: "pointer", bgcolor: on ? BLUE : done ? "rgba(31,138,91,0.1)" : CHIP_BG, color: on ? "#fff" : done ? OK : MUTED }}>
                  {i + 1}. {ph.title}
                </Box>
              );
            })}
          </Box>
        )}

        {/* Body */}
        <Box sx={{ flex: 1, minHeight: 0, p: isMobile ? "20px 18px" : "28px 32px", overflowY: "auto" }}>
          <Box sx={{ maxWidth: 1000, mx: "auto" }}>
            {error && <Alert severity="error" sx={{ mb: 2, borderRadius: "12px" }} onClose={onClearError}>{error}</Alert>}
            {children}
          </Box>
        </Box>

        {/* Footer */}
        <Box sx={{ p: isMobile ? "14px 18px" : "18px 32px", borderTop: `1px solid ${HAIR}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexShrink: 0 }}>
          <Button onClick={onBack} disabled={submitting || currentIndex === 0}
            variant="text" startIcon={<ArrowBackIcon />}
            sx={{ px: 2, color: MUTED, fontWeight: 600 }}>חזור</Button>

          {isLast ? (
            <Button onClick={onFinish} variant="contained" disableElevation disabled={submitting || !canFinish}
              startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <CheckCircleIcon />}
              sx={{ borderRadius: "9999px", height: 46, minWidth: 120, fontSize: 15, fontWeight: 700, textTransform: "none", boxShadow: "none", bgcolor: OK }}>
              {submitting ? "שומר..." : finishLabel}
            </Button>
          ) : (
            <Button onClick={onNext} variant="contained" disableElevation disabled={!canNext || busy}
              endIcon={busy ? <CircularProgress size={18} color="inherit" /> : <ArrowForwardIcon />}
              sx={{ borderRadius: "9999px", height: 46, minWidth: 120, fontSize: 15, fontWeight: 600, textTransform: "none", boxShadow: "none", bgcolor: BLUE }}>המשך</Button>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
