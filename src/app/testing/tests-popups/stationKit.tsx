"use client";
import * as React from "react";
import {
  Dialog, DialogTitle, Box, Typography, Button, TextField, Stack, Alert, IconButton,
  CircularProgress, useMediaQuery,
} from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";
import { CheckCircle as CheckCircleIcon } from "@/components/ui/icons";
import { AddAPhoto as AddAPhotoIcon } from "@/components/ui/icons";
import { PhotoLibrary as PhotoLibraryIcon } from "@/components/ui/icons";
import { Warning as WarningIcon } from "@/components/ui/icons";
import { Check as CheckIcon } from "@/components/ui/icons";
import { Info as InfoIcon } from "@/components/ui/icons";
import type { ItemRow } from "../../../types";
import { apiFetch } from "@/lib/api/client";

/**
 * stationKit — the shared visual language for the testing-station wizards
 * (Shifthouse "3A" handoff). One copy of the dialog chrome (rail + stepper +
 * header + footer), the SKU screen, the verdict card and the photo uploader, so
 * every station dialog reads as one system. Photo.tsx predates this kit and keeps
 * its own copies; new stations (PhotoStation / VerdictStation) build on it.
 * Stateful styling (hover / focus / pressed) lives in ../testing.css (`tst-*`).
 */

// ---- Design tokens ----
export const BLUE = "var(--color-primary)";
export const OK = "var(--color-success-ink)";
export const BAD = "var(--color-destructive)";
export const INK = "var(--color-ink)";
export const MUTED = "var(--color-ink-muted-48)";
export const MUTED_LT = "var(--color-ink-muted-48)";
export const HAIR = "var(--color-hairline)";
export const PARCHMENT = "var(--color-canvas-parchment)";
export const CHIP_BG = "var(--color-canvas-parchment)";
export const PRODUCT_SHADOW = "var(--shadow-modal)";

export type RefImg = { id: number; url: string };
export type Shot = { previewUrl: string; objectKey?: string; uploading?: boolean; failed?: boolean };
export type Photos = { photos: Shot[]; ok: "" | "pass" | "fail"; note: string };
export const emptyPhotos = (): Photos => ({ photos: [], ok: "", note: "" });

// Upload cap enforced in the browser, mirroring MAX_FILE_SIZE_MB on
// /api/items/[id]/files/presign (default 100). A plain constant on purpose: a
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
/** The system's instruction for this step — an info band (icon + message),
 *  no kicker label above it. */
export function SystemNote({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: "12px", bgcolor: "var(--color-primary-tint)", border: "1px solid var(--color-primary-border)", borderRadius: "var(--r-md)", p: "14px 16px" }}>
      <InfoIcon sx={{ fontSize: 20, color: BLUE, flexShrink: 0, mt: "1px" }} aria-hidden />
      <Typography sx={{ fontSize: "var(--text-body)", lineHeight: "var(--lh-body)", color: INK }}>{children}</Typography>
    </Box>
  );
}

/** Pass / fail toggle pair (aria-pressed). `labelledBy` names the group — the
 *  question it answers. Also used by the package opening wizard. */
export function PassFail({ value, onChange, labelledBy }: {
  value: Photos["ok"]; onChange: (v: "pass" | "fail") => void; labelledBy?: string;
}) {
  const opt = (v: "pass" | "fail") => (
    <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
      className={`tst-passfail tst-passfail--${v} sh-press`}>
      {v === "pass" ? <CheckIcon sx={{ fontSize: 20 }} aria-hidden /> : <CloseIcon sx={{ fontSize: 20 }} aria-hidden />}
      {v === "pass" ? "תקין" : "לא תקין"}
    </button>
  );
  return <div role="group" aria-labelledby={labelledBy} style={{ display: "flex", gap: 12 }}>{opt("pass")}{opt("fail")}</div>;
}

/** Section header for the photos block: "תיעוד בתמונות" + soft divider line. */
export function PhotoSection({ children }: { children: React.ReactNode }) {
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, pb: "12px", borderBottom: `1px solid ${HAIR}`, mb: 2 }}>
        <Typography component="h3" sx={{ m: 0, fontSize: "var(--text-lead)", fontWeight: 700, color: INK, whiteSpace: "nowrap" }}>תיעוד בתמונות</Typography>
      </Box>
      {children}
    </Box>
  );
}

/** Verdict + notes card — "בדיקה תקינה?" pass/fail + free-text notes. */
export function VerdictCard({ ok, note, onOk, onNote, rows = 3 }: {
  ok: Photos["ok"]; note: string; onOk: (v: "pass" | "fail") => void; onNote: (v: string) => void; rows?: number;
}) {
  const questionId = React.useId();
  const noteId = React.useId();
  return (
    <Box sx={{ border: `1px solid ${HAIR}`, borderRadius: "var(--r-card)", p: "20px 24px", display: "flex", flexDirection: "column", gap: "18px" }}>
      <Box>
        <Typography id={questionId} sx={{ fontSize: "var(--text-body)", fontWeight: 600, color: INK, mb: 1.5 }}>בדיקה תקינה?</Typography>
        <PassFail value={ok} onChange={onOk} labelledBy={questionId} />
      </Box>
      <Box>
        <label htmlFor={noteId} style={{ display: "block", fontSize: "var(--text-body)", fontWeight: 600, color: INK, marginBottom: 10 }}>הערות</label>
        <TextField id={noteId} value={note} onChange={(e) => onNote(e.target.value)} placeholder="הוסף הערה…" multiline rows={rows} fullWidth />
      </Box>
    </Box>
  );
}

/** The manufacturer-SKU scan screen body — shared by every station's first step.
 *  A code, so the field is LTR, kept at the reading edge. */
export function SkuScreen({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Stack spacing={1.5}>
      <SystemNote>יש לסרוק את מק״ט היצרן של המוצר. פרטי הסריקה נשמרים במערכת ובדו״ח.</SystemNote>
      <TextField autoFocus label="מק״ט יצרן" value={value} onChange={(e) => onChange(e.target.value)} placeholder="סרוק או הזן מק״ט…" fullWidth
        dir="ltr" inputProps={{ style: { textAlign: "right" } }} />
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
  // bring in several at once, so they get their own tail on the counter. The
  // "a / b" ratio is isolated LTR, or RTL would show it as "b / a".
  const extra = hasSlots ? Math.max(0, captured - total) : 0;
  const counter = hasSlots
    ? <><bdi dir="ltr">{Math.min(captured, total)} / {total}</bdi> צולמו{extra ? ` (+${extra})` : ""}</>
    : <>{captured} צילומים</>;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {/* Progress: dots + counter (the counter says it in words; the dots are decoration) */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        {hasSlots && (
          <Box aria-hidden sx={{ flex: 1, display: "flex", gap: "6px" }}>
            {refImages.map((_, i) => (
              <Box key={i} sx={{ flex: 1, height: 4, borderRadius: "var(--r-pill)", bgcolor: photos[i]?.failed ? BAD : i < captured ? OK : i === activeIdx ? BLUE : HAIR }} />
            ))}
          </Box>
        )}
        {!hasSlots && <Box sx={{ flex: 1 }} />}
        <Typography role="status" sx={{ fontSize: "var(--text-small)", fontWeight: 700, color: BLUE, whiteSpace: "nowrap", bgcolor: "var(--color-primary-soft)", borderRadius: "var(--r-pill)", px: 1.5, py: 0.5, fontVariantNumeric: "tabular-nums" }}>
          {counter}
        </Typography>
      </Box>

      {/* Large focused frame */}
      <Box
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); takeFiles(e.dataTransfer.files); }}
        sx={{ position: "relative", height: 420, borderRadius: "var(--r-lg)", overflow: "hidden", border: dragging ? `2px dashed ${BLUE}` : `1px solid ${HAIR}`, bgcolor: dragging ? "var(--color-primary-tint)" : PARCHMENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {bigSrc ? (
          <Box component="img" src={bigSrc} alt={activeIsCaptured ? `צילום ${activeIdx + 1}` : `תמונת ייחוס ${activeIdx + 1}`} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, color: MUTED_LT }}>
            <AddAPhotoIcon sx={{ fontSize: 52 }} aria-hidden />
            <Typography sx={{ fontSize: "var(--text-body-sm)" }}>תמונת ייחוס · צלם את הפריט</Typography>
            <Typography sx={{ fontSize: "var(--text-small)" }}>או גרור תמונות לכאן · ניתן לבחור כמה</Typography>
          </Box>
        )}
        {bigSrc && (
          <Box sx={{ position: "absolute", top: 11, insetInlineEnd: 11, fontSize: "var(--text-micro)", fontWeight: 600, color: activeShot?.failed ? BAD : activeIsCaptured ? OK : "var(--color-ink-muted-70)", bgcolor: "color-mix(in srgb, var(--color-canvas) 85%, transparent)", borderRadius: "var(--r-pill)", px: 1.25, py: 0.5 }}>
            {pillText}
          </Box>
        )}
        {activeIsCaptured && (
          <IconButton size="small" round title="הסר תמונה" onClick={() => onRemove(activeIdx)}
            sx={{ position: "absolute", top: 8, insetInlineStart: 8 }}>
            <CloseIcon sx={{ fontSize: 16 }} aria-hidden />
          </IconButton>
        )}
        {activeShot?.uploading && <CircularProgress size={26} aria-label="מעלה תמונה" sx={{ position: "absolute", inset: 0, margin: "auto" }} />}
      </Box>

      {/* Camera (one shot) + gallery picker (several images at once) */}
      <Box sx={{ display: "flex", gap: 1.25 }}>
        <Button onClick={openCamera} size="large" className="tst-photo-btn" startIcon={<AddAPhotoIcon fontSize={20} aria-hidden />} sx={{ flex: 2 }}>
          {hasSlots && captured >= total ? "צלם מחדש" : "צלם"}
        </Button>
        <Button onClick={openGallery} variant="outlined" size="large" className="tst-photo-btn" startIcon={<PhotoLibraryIcon fontSize={20} aria-hidden />} sx={{ flex: 1 }}>
          העלה תמונות
        </Button>
      </Box>

      {alertMsg && <Alert severity="error">{alertMsg}</Alert>}

      {/* Filmstrip — flex-wrap row with even gaps; each tile picks the frame shown large */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: "14px", pb: 0.5 }}>
        {Array.from({ length: Math.max(total, captured) }).map((_, i) => {
          const shot = photos[i];
          const ref = refImages[i];
          const isCap = !!shot;
          const isActive = i === activeIdx;
          const src = shot?.previewUrl ?? ref?.url;
          const label = `${isCap ? "צילום" : "תמונת ייחוס"} ${i + 1}${shot?.failed ? " — ההעלאה נכשלה" : shot?.uploading ? " — מעלה" : ""}`;
          return (
            <button key={i} type="button" className="tst-film" onClick={() => setActiveIdx(i)}
              aria-label={label} aria-current={isActive ? "true" : undefined}
              style={{ border: shot?.failed ? `2.5px solid ${BAD}` : isActive ? `2.5px solid ${BLUE}` : isCap ? `1.5px solid ${OK}` : `1.5px solid ${HAIR}` }}>
              {src && <Box component="img" src={src} alt="" sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover", opacity: shot?.uploading ? 0.5 : 1 }} />}
              {!isCap && <Box component="span" sx={{ position: "absolute", bottom: 5, insetInlineStart: 5, fontSize: "var(--text-micro)", fontWeight: 600, color: "var(--color-on-primary)", bgcolor: "color-mix(in srgb, var(--color-ink) 55%, transparent)", borderRadius: "6px", px: 0.75, py: "1px" }}>ייחוס</Box>}
              {isCap && !shot?.uploading && (
                <Box component="span" sx={{ position: "absolute", top: 4, insetInlineStart: 4, width: 20, height: 20, borderRadius: "var(--r-pill)", bgcolor: shot?.failed ? BAD : OK, color: "var(--color-on-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {shot?.failed ? <WarningIcon sx={{ fontSize: 12 }} aria-hidden /> : <CheckIcon sx={{ fontSize: 13 }} aria-hidden />}
                </Box>
              )}
              {/* Centred by inset + auto margins (a physical left:50% with a logical margin drifted in RTL). */}
              {shot?.uploading && <CircularProgress size={18} aria-hidden sx={{ position: "absolute", inset: 0, margin: "auto" }} />}
            </button>
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
 * StationShell — the station wizards' dialog chrome, laid out like the package
 * wizard shell (PackageWizardShell / design/Package Stations.dc.html) so both
 * kinds of wizard on the station screen read as one: a 268px rail (station,
 * item card, numbered steps, worker) on desktop, step chips on tablet/phone,
 * the step title + counter at the top of the body, and a footer of
 * יציאה / הקודם / המשך — the green finish button on the last phase.
 * The per-station flow supplies the phases, nav callbacks and the current body.
 */
export function StationShell({
  open, onClose, item, workerId, workerName, contextLabel, stationName,
  phases, currentIndex, onStep, onBack,
  error, onClearError,
  busy, submitting, canNext, onNext, canFinish, onFinish, finishLabel,
  children,
}: {
  open: boolean; onClose: () => void;
  item: ItemRow; workerId: number | null; workerName: string;
  /** The station kind ("פירוק", "שיקוף"…): the rail's title. */
  contextLabel: string;
  /** The concrete station, shown under the title. */
  stationName?: string;
  phases: ShellPhase[]; currentIndex: number;
  onStep: (i: number) => void; onBack: () => void;
  error: string | null; onClearError: () => void;
  busy: boolean; submitting: boolean;
  canNext: boolean; onNext: () => void;
  canFinish: boolean; onFinish: () => void; finishLabel: string;
  children: React.ReactNode;
}) {
  // Real CSS media-query strings — the ui/ breakpoints helpers are stubs. See Photo.tsx.
  const isWide = useMediaQuery("(min-width: 900px)");   // ≥ 900px → rail
  const isMobile = useMediaQuery("(max-width: 599px)"); // < 600px → full-screen

  const itemName = item.model?.trim() || `פריט #${item.item_id}`;
  const phase = phases[currentIndex];
  const isLast = currentIndex === phases.length - 1;
  const counter = `שלב ${currentIndex + 1} מתוך ${phases.length}`;
  const workerLine = `עובד: ${workerId != null ? workerName || `#${workerId}` : "—"}`;

  return (
    <Dialog open={open} onClose={onClose} maxWidth={false} fullScreen={isMobile}
      PaperProps={{
        sx: {
          width: isMobile ? "100vw" : isWide ? "min(1040px, 96vw)" : "94vw",
          height: isMobile ? "100dvh" : isWide ? "min(720px, 92vh)" : "94vh",
          maxWidth: "none", maxHeight: "none",
          boxShadow: isMobile ? "none" : "var(--shadow-modal)",
          display: "flex", flexDirection: isWide ? "row" : "column",
        },
      }}>
      {/* Rail (desktop) — station, item card, numbered steps, worker */}
      {isWide && (
        <Box sx={{ width: 268, flexShrink: 0, bgcolor: PARCHMENT, borderInlineEnd: `1px solid ${HAIR}`, display: "flex", flexDirection: "column", p: "20px 18px", minHeight: 0, overflowY: "auto" }}>
          <div data-drag-handle="">
            <Typography sx={{ fontSize: "var(--text-lead)", fontWeight: 700, color: INK, lineHeight: "var(--lh-snug)" }}>{contextLabel}</Typography>
            {stationName && <Typography sx={{ fontSize: "var(--text-fine)", color: MUTED, mt: "3px" }}>{stationName}</Typography>}
          </div>

          {/* Item identity card */}
          <Box sx={{ bgcolor: "var(--color-canvas)", border: `1px solid ${HAIR}`, borderRadius: "var(--r-md)", p: "12px 14px", mt: "14px" }}>
            <Typography sx={{ fontSize: "var(--text-body)", fontWeight: 700, color: INK }}>{itemName}</Typography>
            <Typography sx={{ fontSize: "var(--text-fine)", color: MUTED, mt: "4px" }}>#{item.item_id}{item.makat != null ? ` · מק״ט ${item.makat}` : ""}</Typography>
            {(item.customer_code || item.serial_no) && (
              <Typography sx={{ fontSize: "var(--text-fine)", color: MUTED, mt: "2px" }}>
                {item.customer_code ? `לקוח ${item.customer_code}` : ""}{item.customer_code && item.serial_no ? " · " : ""}{item.serial_no ? `S/N ${item.serial_no}` : ""}
              </Typography>
            )}
          </Box>

          {/* Numbered steps */}
          <ol style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {phases.map((ph, i) => {
              const done = i < currentIndex;
              const on = i === currentIndex;
              return (
                <li key={ph.key}>
                  <button type="button" className="tst-wiz-step" onClick={() => onStep(i)}
                    aria-current={on ? "step" : undefined} aria-label={`${i + 1}. ${ph.title}${done ? " — הושלם" : ""}`}>
                    <span style={{ width: 24, height: 24, flexShrink: 0, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "var(--text-micro)", fontWeight: 700, fontVariantNumeric: "tabular-nums",
                      background: on ? BLUE : done ? "var(--color-success-bg)" : "var(--color-canvas)", color: on ? "var(--color-on-primary)" : done ? OK : MUTED, border: `1px solid ${on ? BLUE : HAIR}` }}>
                      {done ? <CheckIcon sx={{ fontSize: 12 }} aria-hidden /> : i + 1}
                    </span>
                    <span style={{ fontSize: "var(--text-body-sm)", fontWeight: 600, color: on ? BLUE : INK }}>{ph.title}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <Typography sx={{ mt: "auto", pt: "14px", fontSize: "var(--text-fine)", color: MUTED }}>{workerLine}</Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: isMobile ? "18px 18px 20px" : "24px 28px" }}>
          {/* Step title + counter (the title is the dialog's accessible name) */}
          <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
            <Box sx={{ minWidth: 0 }}>
              <DialogTitle style={{ display: "block", padding: 0, fontSize: "var(--text-title)", fontWeight: 700, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {phase.title}
              </DialogTitle>
              <Typography sx={{ fontSize: "var(--text-body-sm)", color: MUTED, mt: "5px", lineHeight: 1.5 }}>
                {isWide ? phase.desc : `${contextLabel} · ${itemName}`}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: "var(--text-small)", color: MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>{counter}</Typography>
          </Box>

          {/* Step chips (tablet/phone) */}
          {!isWide && (
            <Box sx={{ display: "flex", gap: 1, overflowX: "auto", mt: "14px", pb: "2px" }}>
              {phases.map((ph, i) => {
                const on = i === currentIndex;
                const done = i < currentIndex;
                return (
                  <button key={ph.key} type="button" className="tst-wiz-chip" onClick={() => onStep(i)}
                    aria-current={on ? "step" : undefined} data-done={done ? "" : undefined}>
                    {i + 1}. {ph.title}
                  </button>
                );
              })}
            </Box>
          )}

          <Box sx={{ mt: "20px" }}>
            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={onClearError}>{error}</Alert>}
            {children}
          </Box>
        </Box>

        {/* Footer */}
        <Box sx={{ flexShrink: 0, borderTop: `1px solid ${HAIR}`, p: isMobile ? "12px 18px" : "14px 28px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {!isWide && <Typography sx={{ fontSize: "var(--text-small)", color: MUTED }}>{workerLine}</Typography>}
          <Box sx={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
            <Button variant="outlined" color="inherit" className="tst-wiz-btn" onClick={onClose}>יציאה</Button>
            <Button variant="outlined" color="inherit" className="tst-wiz-btn" onClick={onBack} disabled={submitting || currentIndex === 0}>הקודם</Button>
            {isLast ? (
              <Button color="success" className="tst-wiz-btn" onClick={onFinish} disabled={!canFinish} loading={submitting}
                startIcon={<CheckCircleIcon fontSize={18} aria-hidden />}>
                {submitting ? "שומר…" : finishLabel}
              </Button>
            ) : (
              <Button className="tst-wiz-btn" onClick={onNext} disabled={!canNext} loading={busy}>המשך</Button>
            )}
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
}
