"use client";
/**
 * TestingSingleScreenDialog — "3A" single-screen test popup template.
 *
 * A station test dialog with NO wizard steps: item identity as a hero band, all
 * test building-blocks in one scrollable screen, a section jump-list on the side
 * (desktop) / chips (mobile), and finish actions in the footer.
 *
 * Sizing: 65% of the viewport on desktop, responsive down to full-screen on phones.
 *
 * Drop-in: same signature as the existing station dialogs (StationTestDialogProps),
 * so it registers in tests-popups/mainPopUp.ts exactly like Photo.tsx:
 *
 *   import TestingSingleScreenDialog from "./TestingSingleScreenDialog";
 *   const REGISTRY = { [SOME_STATION_TYPE_ID]: TestingSingleScreenDialog };
 *
 * The PhotoUploader / PassFail / SystemNote helpers below mirror the ones already
 * in Photo.tsx — share a single copy in your codebase rather than duplicating.
 */
import * as React from "react";
import {
  Dialog, Box, Typography, Button, TextField, Stack, Alert, IconButton,
  CircularProgress, useMediaQuery, useTheme,
} from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";
import { Check as CheckIcon } from "@/components/ui/icons";
import { AddAPhoto as AddAPhotoIcon } from "@/components/ui/icons";
import { CheckCircle as CheckCircleIcon } from "@/components/ui/icons";
import { Science as ScienceIcon } from "@/components/ui/icons";
import { Person as PersonIcon } from "@/components/ui/icons";
import type { StationTestDialogProps, TestResultData } from "@/types";

/* ---- Design tokens (Shifthouse) ---- */
const BLUE = "#0066cc";
const OK = "#1f8a5b";
const BAD = "#bf3535";
const INK = "#1d1d1f";
const MUTED = "#7a7a7a";
const MUTED_LT = "#9a9aa0";
const HAIR = "#e0e0e0";
const PARCHMENT = "#f5f5f7";
const CHIP_BG = "#f0f0f2";
const PRODUCT_SHADOW = "rgba(0,0,0,0.22) 3px 5px 30px";
const TOLERANCE_PCT = 5;

type RefImg = { id: number; url: string };
type Shot = { previewUrl: string; objectKey?: string; uploading?: boolean };

const SECTIONS = ["תיעוד בתמונות", "תקינות", "שקילה", "הערות"] as const;

/* =========================================================================
   Building blocks (shared visual language — mirror Photo.tsx)
   ========================================================================= */

function SystemNote({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ bgcolor: "rgba(0,102,204,0.05)", border: "1px solid rgba(0,102,204,0.14)", borderRadius: "14px", p: "14px 16px" }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: BLUE, letterSpacing: "0.02em", mb: 0.5 }}>הודעת מערכת</Typography>
      <Typography sx={{ fontSize: 15, lineHeight: 1.5, color: INK }}>{children}</Typography>
    </Box>
  );
}

function PassFail({ value, onChange }: { value: "" | "pass" | "fail"; onChange: (v: "pass" | "fail") => void }) {
  const opt = (v: "pass" | "fail") => {
    const active = value === v;
    const color = v === "pass" ? OK : BAD;
    const tint = v === "pass" ? "rgba(31,138,91,0.08)" : "rgba(191,53,53,0.08)";
    return (
      <Button
        key={v}
        onClick={() => onChange(v)}
        disableElevation
        startIcon={v === "pass" ? <CheckIcon /> : <CloseIcon />}
        sx={{
          flex: 1, height: 50, borderRadius: "12px", fontWeight: 600, fontSize: 15,
          textTransform: "none", boxShadow: "none",
          border: `1.5px solid ${active ? color : HAIR}`,
          bgcolor: active ? tint : "#fff", color: active ? color : INK,
          "&:hover": { bgcolor: active ? tint : "#fafafc", borderColor: active ? color : "#c7c7cf" },
          "&:active": { transform: "scale(0.98)" },
        }}
      >
        {v === "pass" ? "תקין" : "לא תקין"}
      </Button>
    );
  };
  return <Stack direction="row" spacing={1.5}>{opt("pass")}{opt("fail")}</Stack>;
}

/** Reference-slot photo uploader: photos[i] fills reference slot i. */
function PhotoUploader({ photos, refImages, onPick, onRemove }: {
  photos: Shot[]; refImages: RefImg[]; onPick: (file: File) => void; onRemove: (idx: number) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const total = refImages.length;
  const captured = photos.length;
  const hasSlots = total > 0;

  const [activeIdx, setActiveIdx] = React.useState(0);
  React.useEffect(() => {
    const target = hasSlots ? Math.min(captured, total - 1) : Math.max(0, captured - 1);
    setActiveIdx(target < 0 ? 0 : target);
  }, [captured, total, hasSlots]);

  const activeShot = photos[activeIdx];
  const activeRef = refImages[activeIdx];
  const activeIsCaptured = !!activeShot;
  const bigSrc = activeShot?.previewUrl ?? activeRef?.url;
  const counterText = hasSlots ? `${Math.min(captured, total)} / ${total} צולמו` : `${captured} צילומים`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        {hasSlots && (
          <Box sx={{ flex: 1, display: "flex", gap: "6px" }}>
            {refImages.map((_, i) => (
              <Box key={i} sx={{ flex: 1, height: 4, borderRadius: "9999px", bgcolor: i < captured ? OK : i === activeIdx ? BLUE : HAIR }} />
            ))}
          </Box>
        )}
        {!hasSlots && <Box sx={{ flex: 1 }} />}
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: BLUE, whiteSpace: "nowrap", bgcolor: "rgba(0,102,204,0.08)", borderRadius: "9999px", px: 1.5, py: 0.5, fontVariantNumeric: "tabular-nums" }}>
          {counterText}
        </Typography>
      </Box>

      <Box sx={{ position: "relative", height: 210, borderRadius: "16px", overflow: "hidden", border: `1px solid ${HAIR}`, bgcolor: "#f0f0f2", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {bigSrc ? (
          <Box component="img" src={bigSrc} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Box sx={{ textAlign: "center", color: MUTED_LT }}>
            <AddAPhotoIcon sx={{ fontSize: 42 }} />
            <Typography sx={{ fontSize: 13, mt: 0.75 }}>תמונת ייחוס · צלם את הפריט</Typography>
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

      <Button onClick={() => inputRef.current?.click()} variant="contained" disableElevation startIcon={<AddAPhotoIcon />}
        sx={{ width: "100%", height: 50, borderRadius: "12px", fontSize: 16, fontWeight: 600, textTransform: "none", boxShadow: "none", bgcolor: BLUE, "&:hover": { bgcolor: "#0058b3", boxShadow: "none" }, "&:active": { transform: "scale(0.98)" } }}>
        {hasSlots && captured >= total ? "צלם מחדש / הוסף" : "צלם / העלה"}
      </Button>

      <Box sx={{ display: "flex", gap: 1, overflowX: "auto", pb: 0.5 }}>
        {(hasSlots ? refImages : photos).map((_, i) => {
          const shot = photos[i];
          const ref = refImages[i];
          const isCap = !!shot;
          const isActive = i === activeIdx;
          const src = shot?.previewUrl ?? ref?.url;
          return (
            <Box key={i} onClick={() => setActiveIdx(i)}
              sx={{ position: "relative", flex: "0 0 auto", width: 64, height: 64, cursor: "pointer", borderRadius: "12px", overflow: "hidden",
                border: isActive ? `2.5px solid ${BLUE}` : isCap ? `1.5px solid ${OK}` : `1.5px solid ${HAIR}`, bgcolor: "#f0f0f2" }}>
              {src && <Box component="img" src={src} sx={{ width: "100%", height: "100%", objectFit: "cover", opacity: shot?.uploading ? 0.5 : 1 }} />}
              {isCap && !shot?.uploading && (
                <Box sx={{ position: "absolute", top: 4, insetInlineStart: 4, width: 20, height: 20, borderRadius: "9999px", bgcolor: OK, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <CheckIcon sx={{ fontSize: 13 }} />
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
    </Box>
  );
}

function weightResult(refWeight: number | null, measured: string) {
  const m = Number(measured);
  if (refWeight == null || !measured || Number.isNaN(m)) return null;
  const diff = m - refWeight;
  const diffPct = (Math.abs(diff) / refWeight) * 100;
  return { diff, diffPct, pass: diffPct <= TOLERANCE_PCT };
}

/* =========================================================================
   Dialog
   ========================================================================= */

export default function TestingSingleScreenDialog({ open, onClose, item, station, workerId, workerName, onSubmit }: StationTestDialogProps) {
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up("md"));   // >= 900px → side rail
  const isMobile = useMediaQuery(theme.breakpoints.down("sm")); // < 600px → full-screen

  const [activeSection, setActiveSection] = React.useState(0);
  const [photos, setPhotos] = React.useState<Shot[]>([]);
  const [refImages, setRefImages] = React.useState<RefImg[]>([]);
  const [ok, setOk] = React.useState<"" | "pass" | "fail">("");
  const [refWeight, setRefWeight] = React.useState<number | null>(1240);
  const [measured, setMeasured] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const bodyRef = React.useRef<HTMLDivElement>(null);
  const sectionRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const goToSection = (i: number) => {
    setActiveSection(i);
    const el = sectionRefs.current[i];
    const container = bodyRef.current;
    if (el && container) container.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
  };

  React.useEffect(() => {
    if (!open) return;
    setActiveSection(0); setPhotos([]); setOk(""); setMeasured(""); setNote(""); setError(null);
    // TODO: fetch reference images + reference weight for this item/station
    // e.g. lookupRU(item.makat, item.item_type_id).then(r => { setRefImages(r.images); setRefWeight(r.refWeight); })
  }, [open, item]);

  const w = weightResult(refWeight, measured);
  const passed = ok === "pass" && (w == null || w.pass);

  const handleSubmit = async (sendToResearch: boolean) => {
    if (workerId == null) { setError("יש לבחור עובד בכותרת מסך הבדיקות"); return; }
    setSubmitting(true); setError(null);
    try {
      const data: TestResultData = {
        Result: passed ? 1 : 0,
        Passed: passed,
        Comments: note || undefined,
        WorkerID: workerId,
        sendToResearch,
        Details: {
          ok,
          photos: photos.map((s) => s.objectKey).filter(Boolean),
          weight: w ? { reference: refWeight, measured: Number(measured), diffPct: Number(w.diffPct.toFixed(1)), pass: w.pass } : null,
        },
      };
      await onSubmit(data);
      onClose();
    } catch {
      setError("שגיאה בשמירת הבדיקה");
    } finally {
      setSubmitting(false);
    }
  };

  const eyebrow = station.test_station_desc || "בדיקה";
  const itemName = item.model?.trim() || `פריט #${item.item_id}`;

  /* ---- header hero band ---- */
  const Hero = (
    <Box sx={{ p: { xs: "16px 18px", md: "20px 32px" }, borderBottom: `1px solid ${HAIR}`, display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
      <Box sx={{ width: { xs: 52, md: 60 }, height: { xs: 52, md: 60 }, flexShrink: 0, borderRadius: "14px", bgcolor: CHIP_BG, border: `1px solid ${HAIR}`, display: "flex", alignItems: "center", justifyContent: "center", color: MUTED_LT }}>
        <AddAPhotoIcon sx={{ fontSize: 26 }} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: BLUE, textTransform: "uppercase" }}>{eyebrow}</Typography>
        <Typography sx={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.3px", mt: "2px" }}>{itemName}</Typography>
        <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1 }}>
          <Chip>#{item.item_id}</Chip>
          {item.makat != null && <Chip>מק״ט {item.makat}</Chip>}
          {item.customer_code && <Chip>{item.customer_code}</Chip>}
          {workerId != null && (
            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.6, fontSize: 11.5, fontWeight: 600, bgcolor: "rgba(0,102,204,0.08)", color: BLUE, borderRadius: "9999px", px: "10px", py: "3px" }}>
              <PersonIcon sx={{ fontSize: 13 }} />{workerName || `#${workerId}`}
            </Box>
          )}
        </Stack>
      </Box>
      <IconButton onClick={onClose} sx={{ flexShrink: 0, alignSelf: "flex-start", bgcolor: CHIP_BG, color: MUTED, "&:hover": { bgcolor: "#e6e6ea" } }}>
        <CloseIcon />
      </IconButton>
    </Box>
  );

  /* ---- side rail / chips ---- */
  const RailRow = ({ i }: { i: number }) => {
    const on = i === activeSection;
    return (
      <Box onClick={() => goToSection(i)} sx={{ display: "flex", alignItems: "center", gap: 1.4, p: "9px 10px", borderRadius: "12px", cursor: "pointer", bgcolor: on ? "rgba(0,102,204,0.07)" : "transparent" }}>
        <Box sx={{ width: 7, height: 7, borderRadius: "9999px", flexShrink: 0, bgcolor: on ? BLUE : "#c7c7cf" }} />
        <Typography sx={{ fontSize: 14, fontWeight: on ? 700 : 600, color: on ? INK : MUTED }}>{SECTIONS[i]}</Typography>
      </Box>
    );
  };

  const Body = (
    <Box ref={bodyRef} sx={{ flex: 1, p: { xs: "20px 18px", md: "24px 32px" }, overflowY: "auto" }}>
      <Box sx={{ maxWidth: 680, mx: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {error && <Alert severity="error" onClose={() => setError(null)} sx={{ borderRadius: "12px" }}>{error}</Alert>}

        <SystemNote>בצע את הבדיקה, תעד בתמונות, שקול ורשום הערות. הכל במסך אחד.</SystemNote>

        {/* Section 0 — photos + Section 1 — pass/fail */}
        <Box ref={(el: HTMLDivElement | null) => { sectionRefs.current[0] = el; }} sx={{ display: "flex", flexWrap: "wrap", gap: 2.25 }}>
          <Box sx={{ flex: 1, minWidth: 280 }}>
            <PhotoUploader photos={photos} refImages={refImages}
              onPick={(file) => setPhotos((p) => [...p, { previewUrl: URL.createObjectURL(file), uploading: false }])}
              onRemove={(idx) => setPhotos((p) => p.filter((_, i) => i !== idx))} />
          </Box>
          <Box ref={(el: HTMLDivElement | null) => { sectionRefs.current[1] = el; }} sx={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>בדיקה תקינה?</Typography>
            <PassFail value={ok} onChange={setOk} />
          </Box>
        </Box>

        {/* Section 2 — weigh */}
        <Box ref={(el: HTMLDivElement | null) => { sectionRefs.current[2] = el; }} sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mt: 0.5 }}>
            <Box sx={{ height: "1px", flex: 1, bgcolor: HAIR }} />
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: MUTED_LT, letterSpacing: "0.04em" }}>שקילה</Typography>
            <Box sx={{ height: "1px", flex: 1, bgcolor: HAIR }} />
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.75}>
            <TextField label="משקל פריט ייחוס (גר׳)" value={refWeight ?? "לא מוגדר"} InputProps={{ readOnly: true }} fullWidth />
            <TextField label="משקל פריט נבדק (גר׳)" type="number" value={measured} onChange={(e) => setMeasured(e.target.value)} fullWidth />
          </Stack>
          {w && (
            <Alert severity={w.pass ? "success" : "error"} sx={{ borderRadius: "12px" }}>
              {w.pass ? "משקל תקין" : "משקל לא תקין"} — סטייה {w.diff > 0 ? "+" : ""}{w.diff.toFixed(0)} גר׳ ({w.diffPct.toFixed(1)}% · סטייה תקנית ±{TOLERANCE_PCT}%)
            </Alert>
          )}
        </Box>

        {/* Section 3 — notes */}
        <Box ref={(el: HTMLDivElement | null) => { sectionRefs.current[3] = el; }}>
          <TextField label="הערות" value={note} onChange={(e) => setNote(e.target.value)} multiline rows={3} fullWidth />
        </Box>
      </Box>
    </Box>
  );

  const Footer = (
    <Box sx={{ p: { xs: "14px 18px", md: "18px 32px" }, borderTop: `1px solid ${HAIR}`, display: "flex", alignItems: { xs: "stretch", sm: "center" }, justifyContent: "space-between", gap: 1.5, flexShrink: 0, flexDirection: { xs: "column-reverse", sm: "row" } }}>
      <Button onClick={onClose} disabled={submitting} sx={{ color: MUTED, fontWeight: 600, borderRadius: "8px", "&:hover": { bgcolor: CHIP_BG } }}>ביטול</Button>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <Button onClick={() => handleSubmit(true)} disabled={submitting || workerId == null} variant="outlined" disableElevation startIcon={<ScienceIcon />}
          sx={{ height: 46, borderRadius: "9999px", px: 2.75, fontWeight: 600, textTransform: "none", boxShadow: "none", borderWidth: 1.5, borderColor: BLUE, color: BLUE, "&:hover": { borderWidth: 1.5, bgcolor: "rgba(0,102,204,0.05)" } }}>
          העבר לחקר
        </Button>
        <Button onClick={() => handleSubmit(false)} disabled={submitting || workerId == null} variant="contained" disableElevation
          startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <CheckCircleIcon />}
          sx={{ height: 46, borderRadius: "9999px", px: 3, fontWeight: 600, textTransform: "none", boxShadow: "none", bgcolor: OK, "&:hover": { bgcolor: "#186f49", boxShadow: "none" } }}>
          {submitting ? "שומר..." : "שמור וסיים"}
        </Button>
      </Stack>
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dir="rtl"
      maxWidth={false}
      fullScreen={isMobile}
      PaperProps={{
        sx: {
          m: { xs: 0, sm: 2 },
          width: { xs: "100vw", sm: "94vw", md: "max(760px, 65vw)" },
          height: { xs: "100dvh", sm: "94vh", md: "min(900px, 86vh)" },
          maxWidth: "none", maxHeight: "none",
          borderRadius: { xs: 0, sm: "20px" },
          overflow: "hidden",
          boxShadow: PRODUCT_SHADOW,
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
        },
      }}
    >
      {isWide && (
        <Box sx={{ width: 200, flexShrink: 0, bgcolor: PARCHMENT, borderInlineEnd: `1px solid ${HAIR}`, display: "flex", flexDirection: "column", p: "24px 16px" }}>
          <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: BLUE, textTransform: "uppercase", mb: 1.75 }}>מקטעים</Typography>
          <Stack spacing={0.25}>{SECTIONS.map((_, i) => <RailRow key={i} i={i} />)}</Stack>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 11.5, color: MUTED_LT }}>עמדה ללא שלבים</Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {Hero}
        {!isWide && (
          <Box sx={{ display: "flex", gap: 1, overflowX: "auto", p: "12px 20px", borderBottom: `1px solid ${HAIR}` }}>
            {SECTIONS.map((label, i) => {
              const on = i === activeSection;
              return (
                <Box key={i} onClick={() => goToSection(i)}
                  sx={{ whiteSpace: "nowrap", fontSize: 13, fontWeight: 600, borderRadius: "9999px", px: "14px", py: "6px", cursor: "pointer", bgcolor: on ? BLUE : CHIP_BG, color: on ? "#fff" : MUTED }}>
                  {label}
                </Box>
              );
            })}
          </Box>
        )}
        {Body}
        {Footer}
      </Box>
    </Dialog>
  );
}

/* Small chip used in the hero meta row */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ fontSize: 11.5, fontWeight: 600, bgcolor: CHIP_BG, borderRadius: "9999px", px: "10px", py: "3px" }}>
      {children}
    </Box>
  );
}
