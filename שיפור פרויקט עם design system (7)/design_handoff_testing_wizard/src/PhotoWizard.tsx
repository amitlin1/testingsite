"use client";
/**
 * PhotoWizard — קליטה וצילום wizard SHELL in the Shifthouse "workspace" chrome.
 *
 * This is the reference shell that fixes the cramped implementation. It owns ONLY
 * the dialog chrome — sizing (65% of viewport), the 264px left rail with the item
 * card + vertical stepper, the header, and the footer. Keep the existing per-phase
 * content from Photo.tsx (PhaseBody, PhotoUploader, PassFail, SystemNote, weight
 * logic, accessory sub-flow) and render it inside <Body/> where marked.
 *
 * Exact values match reference/Testing Popup Wizard.dc.html — do not eyeball them.
 */
import * as React from "react";
import { Dialog, Box, Typography, Button, IconButton, useTheme, useMediaQuery } from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";
import { ChevronRight as ChevronRightIcon } from "@/components/ui/icons"; // back (RTL: points start-ward)
import { ArrowForward as ArrowForwardIcon } from "@/components/ui/icons"; // continue
import { Check as CheckIcon } from "@/components/ui/icons";
import { CheckCircle as CheckCircleIcon } from "@/components/ui/icons";
import { Person as PersonIcon } from "@/components/ui/icons";
import type { StationTestDialogProps } from "@/types";

const BLUE = "#0066cc";
const OK = "#1f8a5b";
const INK = "#1d1d1f";
const MUTED = "#7a7a7a";
const MUTED_LT = "#9a9aa0";
const HAIR = "#e0e0e0";
const PARCHMENT = "#f5f5f7";
const CHIP_BG = "#f0f0f2";
const PRODUCT_SHADOW = "rgba(0,0,0,0.22) 3px 5px 30px";

type Phase = "sku" | "pkgPhoto" | "count" | "accessories" | "transfer";
const PHASES: { key: Phase; title: string }[] = [
  { key: "sku", title: "סריקת מק״ט יצרן" },
  { key: "pkgPhoto", title: "צילום האריזה" },
  { key: "count", title: "פתיחת המארז" },
  { key: "accessories", title: "בדיקת פריטים נלווים" },
  { key: "transfer", title: "העברת המוצר" },
];

export default function PhotoWizard({ open, onClose, item, station, workerId, workerName, onSubmit }: StationTestDialogProps) {
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up("md"));    // ≥ 900px → left rail
  const isMobile = useMediaQuery(theme.breakpoints.down("sm")); // < 600px → full-screen

  const [idx, setIdx] = React.useState(0);
  const n = PHASES.length;
  const last = idx === n - 1;
  const phase = PHASES[idx].key;
  const go = (i: number) => setIdx(Math.max(0, Math.min(n - 1, i)));

  React.useEffect(() => { if (open) setIdx(0); }, [open]);

  const model = item.model?.trim() || `פריט #${item.item_id}`;

  const StepList = ({ chips }: { chips?: boolean }) => (
    <Box sx={chips ? { display: "flex", gap: 1, overflowX: "auto", p: "12px 20px", borderBottom: `1px solid ${HAIR}` } : { display: "flex", flexDirection: "column", gap: "2px" }}>
      {PHASES.map((p, i) => {
        const done = i < idx, current = i === idx;
        if (chips) {
          return (
            <Box key={p.key} onClick={() => go(i)} sx={{ whiteSpace: "nowrap", fontSize: 13, fontWeight: 600, borderRadius: "9999px", px: "14px", py: "6px", cursor: "pointer",
              bgcolor: current ? BLUE : done ? "rgba(31,138,91,0.1)" : CHIP_BG, color: current ? "#fff" : done ? OK : MUTED }}>
              {i + 1}. {p.title}
            </Box>
          );
        }
        return (
          <Box key={p.key} onClick={() => go(i)} sx={{ display: "flex", alignItems: "center", gap: 1.5, p: "9px 10px", borderRadius: "12px", cursor: "pointer", bgcolor: current ? "rgba(0,102,204,0.07)" : "transparent" }}>
            <Box sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: "9999px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums",
              ...(done ? { bgcolor: OK, color: "#fff" } : current ? { bgcolor: BLUE, color: "#fff" } : { bgcolor: "#fff", border: `1.5px solid ${HAIR}`, color: MUTED_LT }) }}>
              {done ? <CheckIcon sx={{ fontSize: 15 }} /> : i + 1}
            </Box>
            <Typography sx={{ fontSize: 14, fontWeight: current ? 700 : 600, color: current || done ? INK : MUTED_LT }}>{p.title}</Typography>
          </Box>
        );
      })}
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
      {/* Left rail — desktop only */}
      {isWide && (
        <Box sx={{ width: 264, flexShrink: 0, bgcolor: PARCHMENT, borderInlineEnd: `1px solid ${HAIR}`, display: "flex", flexDirection: "column", p: "24px 20px" }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: BLUE, textTransform: "uppercase", mb: 1.5 }}>קליטה וצילום</Typography>
          <Box sx={{ bgcolor: "#fff", border: `1px solid ${HAIR}`, borderRadius: "16px", p: 2, mb: 2.75 }}>
            <Typography sx={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.3px" }}>{model}</Typography>
            <Typography sx={{ fontSize: 12.5, color: MUTED, mt: 0.5 }}>#{item.item_id}{item.makat != null ? ` · מק״ט ${item.makat}` : ""}</Typography>
            {item.customer_code && <Typography sx={{ fontSize: 12.5, color: MUTED, mt: "2px" }}>לקוח {item.customer_code}{item.serial_no ? ` · S/N ${item.serial_no}` : ""}</Typography>}
            {workerId != null && (
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, mt: 1.5, bgcolor: "rgba(0,102,204,0.08)", borderRadius: "9999px", px: "11px", py: "4px", fontSize: 12, fontWeight: 600, color: BLUE }}>
                <PersonIcon sx={{ fontSize: 13 }} />{workerName || `#${workerId}`}
              </Box>
            )}
          </Box>
          <StepList />
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12, color: MUTED_LT }}>שלב {idx + 1} מתוך {n}</Typography>
        </Box>
      )}

      {/* Main column */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Box sx={{ p: { xs: "16px 18px", md: "24px 32px" }, borderBottom: `1px solid ${HAIR}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5, flexShrink: 0 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            {!isWide && <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: BLUE, textTransform: "uppercase" }}>קליטה וצילום · {model}</Typography>}
            <Typography sx={{ fontSize: { xs: 20, md: 24 }, fontWeight: 700, letterSpacing: "-0.4px", mt: isWide ? 0 : "2px" }}>{PHASES[idx].title}</Typography>
            {isWide && <Typography sx={{ fontSize: 13, color: MUTED, mt: "3px" }}>שלב {idx + 1} מתוך {n}</Typography>}
          </Box>
          <IconButton onClick={onClose} sx={{ flexShrink: 0, alignSelf: "flex-start", width: 36, height: 36, bgcolor: CHIP_BG, color: MUTED, "&:hover": { bgcolor: "#e6e6ea" } }}>
            <CloseIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Box>

        {!isWide && <StepList chips />}

        {/* BODY — mount the existing Photo.tsx PhaseBody / accessory sub-flow here */}
        <Box sx={{ flex: 1, p: { xs: "20px 18px", md: "28px 32px" }, overflowY: "auto" }}>
          <Box sx={{ maxWidth: 680, mx: "auto" }}>
            {/* <PhaseBody phase={phase} item={item} station={station} workerId={workerId} ... /> */}
          </Box>
        </Box>

        {/* Footer */}
        <Box sx={{ p: { xs: "14px 18px", md: "18px 32px" }, borderTop: `1px solid ${HAIR}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexShrink: 0 }}>
          <Button onClick={() => go(idx - 1)} disabled={idx === 0} startIcon={<ChevronRightIcon />}
            sx={{ color: MUTED, fontWeight: 600, borderRadius: "8px", textTransform: "none", "&:hover": { bgcolor: CHIP_BG }, "&.Mui-disabled": { opacity: 0.4 } }}>
            חזור
          </Button>
          {last ? (
            <Button onClick={() => onSubmit({ Result: 1, Passed: true, WorkerID: workerId ?? undefined })} variant="contained" disableElevation startIcon={<CheckCircleIcon />}
              sx={{ height: 46, borderRadius: "9999px", px: 3, fontSize: 15, fontWeight: 600, textTransform: "none", boxShadow: "none", bgcolor: OK, "&:hover": { bgcolor: "#186f49", boxShadow: "none" } }}>
              סיום קליטה
            </Button>
          ) : (
            <Button onClick={() => go(idx + 1)} variant="contained" disableElevation endIcon={<ArrowForwardIcon />}
              sx={{ height: 46, borderRadius: "9999px", px: 3, fontSize: 15, fontWeight: 600, textTransform: "none", boxShadow: "none", bgcolor: BLUE, "&:hover": { bgcolor: "#0058b3", boxShadow: "none" } }}>
              המשך
            </Button>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
