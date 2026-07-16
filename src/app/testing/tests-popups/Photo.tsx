"use client";
import * as React from "react";
import {
  Dialog, Box, Typography, Button, TextField, Stack, Chip, Alert, IconButton,
  MenuItem, CircularProgress, LinearProgress, Divider, useMediaQuery,
} from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";
import { ArrowForward as ArrowForwardIcon } from "@/components/ui/icons";
import { ArrowBack as ArrowBackIcon } from "@/components/ui/icons";
import { CheckCircle as CheckCircleIcon } from "@/components/ui/icons";
import { AddAPhoto as AddAPhotoIcon } from "@/components/ui/icons";
import { Check as CheckIcon } from "@/components/ui/icons";
import { Add as AddIcon } from "@/components/ui/icons";
import { Person as PersonIcon } from "@/components/ui/icons";
import type { StationTestDialogProps, TestResultData } from "../../../types";

// ---- Design tokens (Shifthouse handoff — "3A" design language) ----
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
type Photos = { photos: Shot[]; ok: "" | "pass" | "fail"; note: string };
const emptyPhotos = (): Photos => ({ photos: [], ok: "", note: "" });

// Accessories arrive inside the parent's package (no packaging of their own),
// so each accessory has just two screens: product photo + weighing.
type Accessory = {
  itemId: number | null;
  serialNo: string | null;
  itemTypeId: number | null;
  itemTypeDesc: string;
  sku: string;
  hasRU: boolean | null;
  refWeight: number | null;
  refImages: RefImg[];
  measWeight: string;
  product: Photos;
  done: boolean;
  isExisting: boolean;
};

type ItemTypeOption = { item_type_id: number; item_type_desc: string };

// Parent flow: sku → package photo → parent product photo → parent weighing →
// open/count → accessories (photo + weigh each) → transfer.
type Phase = "sku" | "pkgPhoto" | "productPhoto" | "parentWeigh" | "count" | "accessories" | "transfer";
const PHASES: Phase[] = ["sku", "pkgPhoto", "productPhoto", "parentWeigh", "count", "accessories", "transfer"];
const PHASE_TITLE: Record<Phase, string> = {
  sku: "סריקת מק״ט יצרן",
  pkgPhoto: "צילום האריזה",
  productPhoto: "צילום פריט האב",
  parentWeigh: "שקילת פריט האב",
  count: "פתיחת המארז",
  accessories: "בדיקת פריטים נלווים",
  transfer: "העברת המוצר",
};
const PHASE_DESC: Record<Phase, string> = {
  sku: "סרוק את מק״ט היצרן של המוצר לזיהוי פריט הייחוס.",
  pkgPhoto: "צלם את האריזה מכל זווית לפי תמונות הייחוס, ואשר את תקינותה.",
  productPhoto: "צלם את פריט האב מכל זווית לפי תמונות הייחוס, ואשר את תקינותו.",
  parentWeigh: "שקול את פריט האב והזן את המשקל שנמדד. הסטייה מחושבת אוטומטית.",
  count: "פתח את המארז, ספור את הפריטים וציין אם נדרשות מדבקות.",
  accessories: "בדוק כל פריט נלווה — צילום ושקילה.",
  transfer: "הקליטה הושלמה — העבר את המוצר לעמדה הבאה.",
};

function weightResult(refWeight: number | null, measured: string) {
  const m = Number(measured);
  if (refWeight == null || !measured || Number.isNaN(m)) return null;
  const diff = m - refWeight;
  const diffPct = Math.abs(diff) / refWeight * 100;
  return { diff, diffPct, pass: diffPct <= TOLERANCE_PCT };
}

async function lookupRU(sku: string, itemTypeId: number | null) {
  const qs = new URLSearchParams({ sku });
  if (itemTypeId != null) qs.set("itemTypeId", String(itemTypeId));
  const res = await fetch(`/api/testing/reference-lookup?${qs.toString()}`);
  const d = await res.json();
  return {
    hasRU: !!d.hasRU,
    refWeight: d.referenceWeight != null ? Number(d.referenceWeight) : null,
    images: (d.images ?? []) as RefImg[],
  };
}

// ---- presentational helpers ----
function SystemNote({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ bgcolor: "rgba(0,102,204,0.05)", border: "1px solid rgba(0,102,204,0.14)", borderRadius: "14px", p: "14px 16px" }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: BLUE, letterSpacing: "0.02em", mb: 0.5 }}>הודעת מערכת</Typography>
      <Typography sx={{ fontSize: 15, lineHeight: 1.5, color: INK }}>{children}</Typography>
    </Box>
  );
}

function PassFail({ value, onChange }: { value: Photos["ok"]; onChange: (v: "pass" | "fail") => void }) {
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
function PhotoSection({ children }: { children: React.ReactNode }) {
  return (
    <Box>
      {/* Continuous bottom hairline under the whole row (not a mid-row flex:1 fragment). */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, pb: "12px", borderBottom: "1px solid #ececec", mb: 2 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.2px", color: INK, whiteSpace: "nowrap" }}>תיעוד בתמונות</Typography>
      </Box>
      {children}
    </Box>
  );
}

/** Verdict + notes card — hairline card below the photos block. */
function VerdictCard({ ok, note, onOk, onNote, rows = 3 }: {
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

/** Weighing fields — shared by the parent-item weigh phase and the accessory sub-flow. */
function WeighFields({ refWeight, measured, onMeas }: {
  refWeight: number | null; measured: string; onMeas: (v: string) => void;
}) {
  const w = weightResult(refWeight, measured);
  return (
    <>
      <SystemNote>נא לשקול את הפריט ולהזין את המשקל שנמדד. הסטייה מחושבת אוטומטית.</SystemNote>
      <TextField label="משקל פריט ייחוס (גר')" value={refWeight ?? "לא מוגדר"} InputProps={{ readOnly: true }} fullWidth />
      <TextField label="משקל פריט נבדק (גר')" type="number" value={measured} onChange={(e) => onMeas(e.target.value)} fullWidth />
      {w && (
        <Alert severity={w.pass ? "success" : "error"} sx={{ borderRadius: "12px" }}>
          {w.pass ? "משקל תקין" : "משקל לא תקין"} — סטייה {w.diff > 0 ? "+" : ""}{w.diff.toFixed(0)} גר' ({w.diffPct.toFixed(1)}% · סטייה תקנית ±{TOLERANCE_PCT}%)
        </Alert>
      )}
      {measured && !w && <Alert severity="warning" sx={{ borderRadius: "12px" }}>אין משקל ייחוס לסוג פריט זה — טפל ידנית.</Alert>}
    </>
  );
}

/**
 * PhotoUploader — designer drop-in (slots model): each reference image is a slot to
 * fill; photos[i] fills slot i. Large focused frame + big capture button + filmstrip
 * + "X/Y צולמו" counter. Same signature so all call sites update together.
 */
function PhotoUploader({ photos, refImages, onPick, onRemove }: {
  photos: Shot[]; refImages: RefImg[]; onPick: (file: File) => void; onRemove: (idx: number) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const total = refImages.length;
  const captured = photos.length;
  const hasSlots = total > 0;

  // Active slot: first not-yet-captured slot (or the last).
  const [activeIdx, setActiveIdx] = React.useState(0);
  React.useEffect(() => {
    const target = hasSlots ? Math.min(captured, total - 1) : Math.max(0, captured - 1);
    setActiveIdx(target < 0 ? 0 : target);
  }, [captured, total, hasSlots]);

  const openPicker = () => inputRef.current?.click();

  const activeShot: Shot | undefined = photos[activeIdx];
  const activeRef: RefImg | undefined = refImages[activeIdx];
  const activeIsCaptured = !!activeShot;
  const bigSrc = activeShot?.previewUrl ?? activeRef?.url;

  const pillText = activeIsCaptured ? "צולם" : "תמונת ייחוס";
  const counterText = hasSlots ? `${Math.min(captured, total)} / ${total} צולמו` : `${captured} צילומים`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {/* Progress: dots + counter */}
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

      {/* Large focused frame */}
      <Box sx={{ position: "relative", height: 420, borderRadius: "18px", overflow: "hidden", border: `1px solid ${HAIR}`, bgcolor: "#f0f0f2", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {bigSrc ? (
          <Box component="img" src={bigSrc} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, color: MUTED_LT }}>
            <AddAPhotoIcon sx={{ fontSize: 52 }} />
            <Typography sx={{ fontSize: 14 }}>תמונת ייחוס · צלם את הפריט</Typography>
          </Box>
        )}
        {bigSrc && (
          <Box sx={{ position: "absolute", top: 11, insetInlineEnd: 11, fontSize: 11, fontWeight: 600, color: activeIsCaptured ? OK : "#8a7c68", bgcolor: "rgba(255,255,255,0.82)", borderRadius: "9999px", px: 1.25, py: 0.5 }}>
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

      {/* Big capture button */}
      <Button onClick={openPicker} variant="contained" disableElevation startIcon={<AddAPhotoIcon />}
        sx={{ width: "100%", height: 58, borderRadius: "14px", fontSize: 17, fontWeight: 600, textTransform: "none", boxShadow: "none", bgcolor: BLUE, "&:hover": { bgcolor: "#0058b3", boxShadow: "none" }, "&:active": { transform: "scale(0.98)" } }}>
        {hasSlots && captured >= total ? "צלם מחדש / הוסף" : "צלם / העלה"}
      </Button>

      {/* Filmstrip — flex-wrap row with even gaps: 3 photos fill one row; more wrap
          to a new row at the same rhythm (no squeezing, no horizontal scroll). */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: "14px", pb: 0.5 }}>
        {(hasSlots ? refImages : photos).map((_, i) => {
          const shot = photos[i];
          const ref = refImages[i];
          const isCap = !!shot;
          const isActive = i === activeIdx;
          const src = shot?.previewUrl ?? ref?.url;
          return (
            <Box key={i} onClick={() => setActiveIdx(i)}
              sx={{ position: "relative", flex: "1 1 150px", minWidth: 130, maxWidth: 280, aspectRatio: "4 / 3", cursor: "pointer", borderRadius: "13px", overflow: "hidden",
                border: isActive ? `2.5px solid ${BLUE}` : isCap ? `1.5px solid ${OK}` : `1.5px solid ${HAIR}`, bgcolor: "#f0f0f2" }}>
              {src && <Box component="img" src={src} sx={{ width: "100%", height: "100%", objectFit: "cover", opacity: shot?.uploading ? 0.5 : 1 }} />}
              {!isCap && <Box sx={{ position: "absolute", bottom: 5, insetInlineStart: 5, fontSize: 10, fontWeight: 600, color: "#fff", bgcolor: "rgba(0,0,0,0.45)", borderRadius: "6px", px: 0.75, py: "1px" }}>ייחוס</Box>}
              {isCap && !shot?.uploading && (
                <Box sx={{ position: "absolute", top: 4, insetInlineStart: 4, width: 20, height: 20, borderRadius: "9999px", bgcolor: OK, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <CheckIcon sx={{ fontSize: 13 }} />
                </Box>
              )}
              {shot?.uploading && <CircularProgress size={18} sx={{ position: "absolute", top: "50%", left: "50%", mt: "-9px", ml: "-9px", color: BLUE }} />}
            </Box>
          );
        })}
      </Box>

      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
    </Box>
  );
}

export default function Photo({ open, onClose, item, station, workerId, workerName, onSubmit }: StationTestDialogProps) {
  // NOTE: the ui/ theme.breakpoints.* helpers return "" (stub), so
  // useMediaQuery(theme.breakpoints.up("md")) is ALWAYS false and the side rail
  // never shows. Pass real CSS media-query strings instead.
  const isWide = useMediaQuery("(min-width: 900px)");   // ≥ 900px → left rail (sidebar)
  const isMobile = useMediaQuery("(max-width: 599px)"); // < 600px → full-screen

  const [phase, setPhase] = React.useState<Phase>("sku");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [skuScan, setSkuScan] = React.useState("");
  const [parentHasRU, setParentHasRU] = React.useState<boolean | null>(null);
  const [parentRefImages, setParentRefImages] = React.useState<RefImg[]>([]);
  const [parentRefWeight, setParentRefWeight] = React.useState<number | null>(null);
  const [pkg, setPkg] = React.useState<Photos>(emptyPhotos());
  const [parentProduct, setParentProduct] = React.useState<Photos>(emptyPhotos());
  const [parentMeasWeight, setParentMeasWeight] = React.useState("");
  const [itemCount, setItemCount] = React.useState("");
  const [needLabels, setNeedLabels] = React.useState<"" | "yes" | "no">("");
  const [labelQty, setLabelQty] = React.useState("");

  const [accessories, setAccessories] = React.useState<Accessory[]>([]);
  const [itemIdx, setItemIdx] = React.useState<number | null>(null);
  const [itemPhase, setItemPhase] = React.useState<"photo" | "weigh">("photo");
  const [itemTypes, setItemTypes] = React.useState<ItemTypeOption[]>([]);
  const [showAdd, setShowAdd] = React.useState(false);
  const [draft, setDraft] = React.useState({ itemTypeId: "", sku: "", serialNumber: "", makat: "", model: "", manufacturer: "", manufacturerNo: "" });

  React.useEffect(() => {
    if (!open) return;
    setPhase("sku"); setError(null); setSkuScan(""); setParentHasRU(null); setParentRefImages([]); setParentRefWeight(null);
    setPkg(emptyPhotos()); setParentProduct(emptyPhotos()); setParentMeasWeight("");
    setItemCount(""); setNeedLabels(""); setLabelQty(""); setItemIdx(null);
    setAccessories((item.connected_items ?? []).map((ci): Accessory => ({
      itemId: ci.item_id, serialNo: ci.serial_no, itemTypeId: null, itemTypeDesc: ci.item_type_desc ?? "",
      sku: "", hasRU: null, refWeight: null, refImages: [], measWeight: "",
      product: emptyPhotos(), done: false, isExisting: true,
    })));
  }, [open, item]);

  React.useEffect(() => {
    fetch("/api/itemTypes").then((r) => (r.ok ? r.json() : [])).then((d) => setItemTypes(Array.isArray(d) ? d : [])).catch(() => setItemTypes([]));
  }, []);

  const patchAcc = (idx: number, patch: Partial<Accessory>) =>
    setAccessories((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));

  // ---- real photo upload (reuses the item-files pipeline) ----
  const uploadToItem = React.useCallback(async (itemId: number, file: File): Promise<string | null> => {
    try {
      const fd = new FormData();
      fd.append("files", file);
      if (workerId != null) fd.append("worker_id", String(workerId));
      fd.append("station_type_id", String(station.test_station_type_id));
      const res = await fetch(`/api/items/${itemId}/files`, { method: "POST", body: fd });
      if (!res.ok) return null;
      const d = await res.json();
      return d.uploaded?.[0]?.objectKey ?? null;
    } catch { return null; }
  }, [workerId, station.test_station_type_id]);

  // Parent photos: "pkg" = the package, "product" = the parent item itself.
  const pickParentPhoto = (kind: "pkg" | "product", file: File) => {
    const set = kind === "pkg" ? setPkg : setParentProduct;
    const previewUrl = URL.createObjectURL(file);
    set((pk) => ({ ...pk, photos: [...pk.photos, { previewUrl, uploading: true }] }));
    uploadToItem(item.item_id, file).then((key) =>
      set((pk) => ({ ...pk, photos: pk.photos.map((s) => (s.previewUrl === previewUrl ? { ...s, objectKey: key ?? undefined, uploading: false } : s)) })));
  };
  const removeParentPhoto = (kind: "pkg" | "product", idx: number) => {
    const set = kind === "pkg" ? setPkg : setParentProduct;
    set((pk) => ({ ...pk, photos: pk.photos.filter((_, i) => i !== idx) }));
  };

  const pickAccPhoto = (file: File) => {
    if (itemIdx == null) return;
    const idx = itemIdx;
    const targetId = accessories[idx]?.itemId ?? null;
    const previewUrl = URL.createObjectURL(file);
    setAccessories((prev) => prev.map((a, i) => (i === idx ? { ...a, product: { ...a.product, photos: [...a.product.photos, { previewUrl, uploading: true }] } } : a)));
    const finishShot = (key: string | null) =>
      setAccessories((prev) => prev.map((a, i) => (i === idx ? { ...a, product: { ...a.product, photos: a.product.photos.map((s) => (s.previewUrl === previewUrl ? { ...s, objectKey: key ?? undefined, uploading: false } : s)) } } : a)));
    if (targetId != null) uploadToItem(targetId, file).then(finishShot); else finishShot(null);
  };
  const removeAccPhoto = (shotIdx: number) => {
    if (itemIdx == null) return;
    const idx = itemIdx;
    setAccessories((prev) => prev.map((a, i) => (i === idx ? { ...a, product: { ...a.product, photos: a.product.photos.filter((_, j) => j !== shotIdx) } } : a)));
  };

  // ---- count vs. system items (the entered count includes the parent item) ----
  const expectedCount = accessories.length + 1;
  const countMatches = itemCount.trim() !== "" && Number(itemCount) === expectedCount;

  // ---- navigation ----
  const canContinue = (): boolean => {
    switch (phase) {
      case "sku": return skuScan.trim().length > 0;
      case "pkgPhoto": return pkg.ok !== "";
      case "productPhoto": return parentProduct.ok !== "";
      case "parentWeigh": return parentMeasWeight.trim() !== "";
      // Count mismatch does NOT block here — missing accessories are added on the next screen.
      case "count": return itemCount.trim() !== "" && needLabels !== "" && (needLabels === "no" || labelQty.trim() !== "");
      // Can't move past accessories until every item is tested AND the count matches the system.
      case "accessories": return accessories.every((a) => a.done) && countMatches;
      case "transfer": return true;
      default: return false;
    }
  };

  const goNext = async () => {
    setError(null);
    if (phase === "sku") {
      setBusy(true);
      try { const ru = await lookupRU(skuScan.trim(), item.item_type_id); setParentHasRU(ru.hasRU); setParentRefImages(ru.images); setParentRefWeight(ru.refWeight); }
      catch { setParentHasRU(false); } finally { setBusy(false); }
      setPhase("pkgPhoto"); return;
    }
    const i = PHASES.indexOf(phase);
    if (i < PHASES.length - 1) setPhase(PHASES[i + 1]);
  };

  const goBack = () => {
    setError(null);
    if (itemIdx != null) {
      if (itemPhase === "weigh") { setItemPhase("photo"); return; }
      setItemIdx(null); return;
    }
    const i = PHASES.indexOf(phase);
    if (i > 0) setPhase(PHASES[i - 1]);
  };

  // ---- accessory sub-flow: photo → weigh ----
  const startAccessory = async (idx: number) => {
    setItemIdx(idx); setItemPhase("photo");
    const a = accessories[idx];
    if (a.hasRU == null && a.sku.trim()) {
      setBusy(true);
      try { const ru = await lookupRU(a.sku.trim(), a.itemTypeId); patchAcc(idx, { hasRU: ru.hasRU, refWeight: ru.refWeight, refImages: ru.images }); }
      finally { setBusy(false); }
    }
  };
  const accNext = () => {
    if (itemIdx == null) return;
    if (itemPhase === "photo") { setItemPhase("weigh"); return; }
    patchAcc(itemIdx, { done: true });
    setItemIdx(null);
  };

  const addAccessory = async () => {
    setError(null);
    if (!draft.itemTypeId || !draft.sku || !draft.serialNumber || !draft.makat || !draft.model || !draft.manufacturer) {
      setError("יש למלא סוג, מק״ט, מספר סריאלי, מק״ט פנימי, דגם ויצרן"); return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/testing/accessory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentItemId: item.item_id, itemType: Number(draft.itemTypeId), serialNumber: draft.serialNumber,
          makat: Number(draft.makat), model: draft.model, manufacturer: draft.manufacturer, manufacturerNo: draft.manufacturerNo || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d?.error || "יצירת האבזר נכשלה"); return; }
      const typeDesc = itemTypes.find((t) => t.item_type_id === Number(draft.itemTypeId))?.item_type_desc?.trim() ?? "";
      setAccessories((prev) => [...prev, {
        itemId: d.itemId, serialNo: draft.serialNumber, itemTypeId: Number(draft.itemTypeId), itemTypeDesc: typeDesc,
        sku: draft.sku, hasRU: null, refWeight: null, refImages: [], measWeight: "",
        product: emptyPhotos(), done: false, isExisting: false,
      }]);
      setShowAdd(false);
      setDraft({ itemTypeId: "", sku: "", serialNumber: "", makat: "", model: "", manufacturer: "", manufacturerNo: "" });
    } catch { setError("שגיאה בתקשורת"); } finally { setBusy(false); }
  };

  // ---- finish: one result per item ----
  const accPass = (a: Accessory) => {
    const w = weightResult(a.refWeight, a.measWeight);
    return a.product.ok !== "fail" && (w == null || w.pass);
  };
  const parentWeight = weightResult(parentRefWeight, parentMeasWeight);
  const parentPass = pkg.ok === "pass" && parentProduct.ok === "pass" && (parentWeight == null || parentWeight.pass);
  const keysOf = (ph: Photos) => ph.photos.map((s) => s.objectKey).filter(Boolean);

  // The whole flow must be complete before "סיום קליטה" is allowed (the stepper
  // lets the user jump straight to "transfer", so re-check everything here).
  const missingSteps: string[] = [];
  if (!skuScan.trim()) missingSteps.push("סריקת מק״ט יצרן");
  if (pkg.ok === "") missingSteps.push("צילום האריזה ואישור תקינות");
  if (parentProduct.ok === "") missingSteps.push("צילום פריט האב ואישור תקינות");
  if (!parentMeasWeight.trim()) missingSteps.push("שקילת פריט האב");
  if (!itemCount.trim()) missingSteps.push("הזנת כמות פריטים במארז");
  else if (!countMatches) missingSteps.push(`התאמת כמות הפריטים — הוזן ${Number(itemCount)}, במערכת ${expectedCount} (פריט אב + ${accessories.length} נלווים)`);
  if (needLabels === "" || (needLabels === "yes" && !labelQty.trim())) missingSteps.push("מענה על שאלת המדבקות");
  if (accessories.some((a) => !a.done)) missingSteps.push("השלמת בדיקת כל הפריטים הנלווים");
  const allComplete = missingSteps.length === 0;

  const finish = async () => {
    if (workerId == null) { setError("יש לבחור עובד בכותרת מסך הבדיקות"); return; }
    if (!allComplete) { setError("לא ניתן לסיים — יש להשלים את כל שלבי הבדיקה"); return; }
    setSubmitting(true); setError(null);
    try {
      for (const a of accessories) {
        if (a.itemId == null) continue;
        const w = weightResult(a.refWeight, a.measWeight);
        await fetch("/api/testing/results", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ItemID: a.itemId, StationID: station.test_station_id, WorkerID: workerId,
            Result: accPass(a) ? 1 : 0, Passed: accPass(a), Comments: a.product.note || undefined,
            Details: {
              sku: a.sku, hasRU: a.hasRU,
              weight: w ? { reference: a.refWeight, measured: Number(a.measWeight), diffPct: Number(w.diffPct.toFixed(1)), pass: w.pass } : null,
              product: { ok: a.product.ok, note: a.product.note, photos: keysOf(a.product) },
            },
          }),
        });
      }
      const parentData: TestResultData = {
        Result: parentPass ? 1 : 0, Passed: parentPass, Comments: pkg.note || parentProduct.note || undefined, WorkerID: workerId ?? undefined,
        Details: {
          sku: skuScan, hasRU: parentHasRU,
          pkg: { ok: pkg.ok, note: pkg.note, photos: keysOf(pkg) },
          product: { ok: parentProduct.ok, note: parentProduct.note, photos: keysOf(parentProduct) },
          weight: parentWeight ? { reference: parentRefWeight, measured: Number(parentMeasWeight), diffPct: Number(parentWeight.diffPct.toFixed(1)), pass: parentWeight.pass } : null,
          itemCount: Number(itemCount) || 0, needLabels, labelQty: Number(labelQty) || 0,
          accessoryItemIds: accessories.map((a) => a.itemId),
        },
      };
      await onSubmit(parentData);
      onClose();
    } catch { setError("שגיאה בשמירת הקליטה"); } finally { setSubmitting(false); }
  };

  const stepIndex = PHASES.indexOf(phase);
  const activeAcc = itemIdx != null ? accessories[itemIdx] : null;
  const itemName = item.model?.trim() || `פריט #${item.item_id}`;

  // Stepper navigation: clicking a step in the rail/chips jumps straight to it,
  // in BOTH directions (footer buttons still drive the sequential flow). Jumping
  // past the SKU step runs the reference lookup once so later steps have images.
  const goToStep = (i: number) => {
    setError(null); setItemIdx(null);
    if (i > 0 && parentHasRU == null && skuScan.trim() && !busy) {
      setBusy(true);
      lookupRU(skuScan.trim(), item.item_type_id)
        .then((ru) => { setParentHasRU(ru.hasRU); setParentRefImages(ru.images); setParentRefWeight(ru.refWeight); })
        .catch(() => setParentHasRU(false))
        .finally(() => setBusy(false));
    }
    setPhase(PHASES[i]);
  };

  return (
    <Dialog open={open} onClose={onClose} dir="rtl" maxWidth={false} fullScreen={isMobile}
      PaperProps={{
        // NOTE: the ui/ sx compat layer emits INLINE styles — responsive objects
        // ({xs,sm,md}) and pseudo-selectors are dropped. All values here are concrete,
        // chosen from isMobile/isWide, so the dialog actually gets its size + row layout.
        sx: {
          width: isMobile ? "100vw" : isWide ? "max(920px, 72vw)" : "94vw",
          height: isMobile ? "100dvh" : isWide ? "min(900px, 92vh)" : "94vh",
          maxWidth: "none", maxHeight: "none",
          borderRadius: isMobile ? 0 : "20px",
          overflow: "hidden", boxShadow: PRODUCT_SHADOW,
          display: "flex", flexDirection: isWide ? "row" : "column",
        },
      }}>
      {/* Left rail (desktop) — item card + vertical stepper; navigation stays on the footer */}
      {isWide && (
        <Box sx={{ width: 264, flexShrink: 0, bgcolor: PARCHMENT, borderInlineEnd: `1px solid ${HAIR}`, display: "flex", flexDirection: "column", p: "24px 20px", minHeight: 0, overflowY: "auto" }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: BLUE, textTransform: "uppercase", mb: 1.5 }}>קליטה וצילום</Typography>

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
            {PHASES.map((ph, i) => {
              const done = i < stepIndex;
              const on = i === stepIndex;
              return (
                <Box key={ph} onClick={() => goToStep(i)} sx={{ display: "flex", alignItems: "center", gap: 1.5, p: "9px 10px", borderRadius: "12px", cursor: "pointer", bgcolor: on ? "rgba(0,102,204,0.07)" : "transparent" }}>
                  <Box sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: "9999px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                    ...(done ? { bgcolor: OK, color: "#fff" } : on ? { bgcolor: BLUE, color: "#fff" } : { bgcolor: "#fff", border: `1.5px solid ${HAIR}`, color: MUTED_LT }) }}>
                    {done ? <CheckIcon sx={{ fontSize: 15 }} /> : i + 1}
                  </Box>
                  <Typography sx={{ fontSize: 14, fontWeight: on ? 700 : 600, color: on || done ? INK : MUTED_LT }}>{PHASE_TITLE[ph]}</Typography>
                </Box>
              );
            })}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12, color: MUTED_LT }}>שלב {stepIndex + 1} מתוך {PHASES.length}</Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        {/* Header — phase title + step counter (item identity lives in the rail) */}
        <Box sx={{ p: isMobile ? "16px 18px" : "24px 32px", borderBottom: `1px solid ${HAIR}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5, flexShrink: 0 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            {!isWide && <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: BLUE, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>קליטה וצילום · {itemName}</Typography>}
            <Typography sx={{ fontSize: isWide ? 24 : 20, fontWeight: 700, letterSpacing: "-0.4px", mt: isWide ? 0 : "2px", color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{PHASE_TITLE[phase]}</Typography>
            {isWide && <Typography sx={{ fontSize: 14, color: MUTED, mt: "4px" }}>{PHASE_DESC[phase]}</Typography>}
          </Box>
          <IconButton onClick={onClose} sx={{ flexShrink: 0, alignSelf: "flex-start", width: 36, height: 36, bgcolor: CHIP_BG, color: MUTED, "&:hover": { bgcolor: "#e6e6ea" } }}>
            <CloseIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Box>

        {/* Step chips (tablet/phone) — replaces the rail */}
        {!isWide && (
          <Box sx={{ display: "flex", gap: 1, overflowX: "auto", p: "12px 20px", borderBottom: `1px solid ${HAIR}` }}>
            {PHASES.map((ph, i) => {
              const on = i === stepIndex;
              const done = i < stepIndex;
              return (
                <Box key={ph} onClick={() => goToStep(i)} sx={{ whiteSpace: "nowrap", fontSize: 13, fontWeight: 600, borderRadius: "9999px", px: "14px", py: "6px", cursor: "pointer", bgcolor: on ? BLUE : done ? "rgba(31,138,91,0.1)" : CHIP_BG, color: on ? "#fff" : done ? OK : MUTED }}>
                  {i + 1}. {PHASE_TITLE[ph]}
                </Box>
              );
            })}
          </Box>
        )}

        {/* Body */}
        <Box sx={{ flex: 1, minHeight: 0, p: isMobile ? "20px 18px" : "28px 32px", overflowY: "auto" }}>
          <Box sx={{ maxWidth: 1000, mx: "auto" }}>
            {error && <Alert severity="error" sx={{ mb: 2, borderRadius: "12px" }} onClose={() => setError(null)}>{error}</Alert>}

            {activeAcc ? (
              <AccessorySubFlow acc={activeAcc} itemPhase={itemPhase} busy={busy}
                onPick={pickAccPhoto} onRemove={removeAccPhoto}
                onOk={(v) => patchAcc(itemIdx!, { product: { ...activeAcc.product, ok: v } })}
                onNote={(v) => patchAcc(itemIdx!, { product: { ...activeAcc.product, note: v } })}
                onMeas={(v) => patchAcc(itemIdx!, { measWeight: v })}
              />
            ) : (
              <PhaseBody
                phase={phase} busy={busy}
                skuScan={skuScan} setSkuScan={setSkuScan}
                parentHasRU={parentHasRU} pkg={pkg} setPkg={setPkg} parentRefImages={parentRefImages}
                parentProduct={parentProduct} setParentProduct={setParentProduct}
                parentRefWeight={parentRefWeight} parentMeasWeight={parentMeasWeight} setParentMeasWeight={setParentMeasWeight}
                onPickParent={pickParentPhoto} onRemoveParent={removeParentPhoto}
                itemCount={itemCount} setItemCount={setItemCount}
                needLabels={needLabels} setNeedLabels={setNeedLabels} labelQty={labelQty} setLabelQty={setLabelQty}
                accessories={accessories} patchAcc={patchAcc}
                expectedCount={expectedCount} countMatches={countMatches} missingSteps={missingSteps}
                itemTypes={itemTypes} showAdd={showAdd} setShowAdd={setShowAdd} draft={draft} setDraft={setDraft}
                onAddAccessory={addAccessory} onStartAccessory={startAccessory}
              />
            )}
          </Box>
        </Box>

        {/* Footer */}
        <Box sx={{ p: isMobile ? "14px 18px" : "18px 32px", borderTop: `1px solid ${HAIR}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexShrink: 0 }}>
          <Button onClick={goBack} disabled={submitting || (phase === "sku" && itemIdx == null)}
            variant="text" startIcon={<ArrowBackIcon />}
            sx={{ px: 2, color: MUTED, fontWeight: 600 }}>חזור</Button>

          {activeAcc ? (
            <Button onClick={accNext} variant="contained" disableElevation
              disabled={itemPhase === "photo" ? activeAcc.product.ok === "" : !activeAcc.measWeight}
              endIcon={<ArrowForwardIcon />}
              sx={{ borderRadius: "9999px", height: 46, minWidth: 120, fontSize: 15, fontWeight: 600, textTransform: "none", boxShadow: "none", bgcolor: BLUE }}>
              {itemPhase === "weigh" ? "סיום פריט" : "המשך"}
            </Button>
          ) : phase === "transfer" ? (
            <Button onClick={finish} variant="contained" disableElevation disabled={submitting || !allComplete}
              startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <CheckCircleIcon />}
              sx={{ borderRadius: "9999px", height: 46, minWidth: 120, fontSize: 15, fontWeight: 700, textTransform: "none", boxShadow: "none", bgcolor: OK }}>
              {submitting ? "שומר..." : "סיום קליטה"}
            </Button>
          ) : (
            <Button onClick={goNext} variant="contained" disableElevation disabled={!canContinue() || busy}
              endIcon={busy ? <CircularProgress size={18} color="inherit" /> : <ArrowForwardIcon />}
              sx={{ borderRadius: "9999px", height: 46, minWidth: 120, fontSize: 15, fontWeight: 600, textTransform: "none", boxShadow: "none", bgcolor: BLUE }}>המשך</Button>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}

// ================= phase body =================
type PhaseBodyProps = {
  phase: Phase; busy: boolean;
  skuScan: string; setSkuScan: (v: string) => void;
  parentHasRU: boolean | null; pkg: Photos; setPkg: React.Dispatch<React.SetStateAction<Photos>>; parentRefImages: RefImg[];
  parentProduct: Photos; setParentProduct: React.Dispatch<React.SetStateAction<Photos>>;
  parentRefWeight: number | null; parentMeasWeight: string; setParentMeasWeight: (v: string) => void;
  onPickParent: (kind: "pkg" | "product", file: File) => void; onRemoveParent: (kind: "pkg" | "product", idx: number) => void;
  itemCount: string; setItemCount: (v: string) => void;
  needLabels: "" | "yes" | "no"; setNeedLabels: (v: "" | "yes" | "no") => void; labelQty: string; setLabelQty: (v: string) => void;
  accessories: Accessory[]; patchAcc: (idx: number, patch: Partial<Accessory>) => void;
  expectedCount: number; countMatches: boolean; missingSteps: string[];
  itemTypes: ItemTypeOption[]; showAdd: boolean; setShowAdd: (v: boolean) => void;
  draft: { itemTypeId: string; sku: string; serialNumber: string; makat: string; model: string; manufacturer: string; manufacturerNo: string };
  setDraft: React.Dispatch<React.SetStateAction<PhaseBodyProps["draft"]>>;
  onAddAccessory: () => void; onStartAccessory: (idx: number) => void;
};

function PhaseBody(p: PhaseBodyProps) {
  if (p.phase === "sku") {
    return (
      <Stack spacing={1.5}>
        <SystemNote>יש לסרוק את מק״ט היצרן של המוצר. פרטי הסריקה נשמרים במערכת ובדו״ח.</SystemNote>
        <TextField autoFocus label="מק״ט יצרן" value={p.skuScan} onChange={(e) => p.setSkuScan(e.target.value)} placeholder="סרוק או הזן מק״ט…" fullWidth />
      </Stack>
    );
  }
  if (p.phase === "pkgPhoto") {
    return (
      <Stack spacing={3}>
        {/* Message shown only when no reference item is found. */}
        {p.parentHasRU === false && (
          <Chip size="small" label="לא נמצא פריט ייחוס — נא להודיע לגורם אחראי"
            sx={{ alignSelf: "flex-start", bgcolor: "rgba(217,118,6,0.10)", color: "#9a5b06", fontWeight: 600 }} />
        )}
        {/* Vertical, photos-first: full-width photo block on top, verdict card below. */}
        <PhotoSection>
          <PhotoUploader photos={p.pkg.photos} refImages={p.parentRefImages} onPick={(f) => p.onPickParent("pkg", f)} onRemove={(i) => p.onRemoveParent("pkg", i)} />
        </PhotoSection>
        <VerdictCard ok={p.pkg.ok} note={p.pkg.note}
          onOk={(v) => p.setPkg((pk) => ({ ...pk, ok: v }))}
          onNote={(v) => p.setPkg((pk) => ({ ...pk, note: v }))} />
      </Stack>
    );
  }
  if (p.phase === "productPhoto") {
    return (
      <Stack spacing={3}>
        {p.parentHasRU === false && (
          <Chip size="small" label="לא נמצא פריט ייחוס — נא להודיע לגורם אחראי"
            sx={{ alignSelf: "flex-start", bgcolor: "rgba(217,118,6,0.10)", color: "#9a5b06", fontWeight: 600 }} />
        )}
        <PhotoSection>
          <PhotoUploader photos={p.parentProduct.photos} refImages={p.parentRefImages} onPick={(f) => p.onPickParent("product", f)} onRemove={(i) => p.onRemoveParent("product", i)} />
        </PhotoSection>
        <VerdictCard ok={p.parentProduct.ok} note={p.parentProduct.note}
          onOk={(v) => p.setParentProduct((pk) => ({ ...pk, ok: v }))}
          onNote={(v) => p.setParentProduct((pk) => ({ ...pk, note: v }))} />
      </Stack>
    );
  }
  if (p.phase === "parentWeigh") {
    return (
      <Stack spacing={1.5}>
        <WeighFields refWeight={p.parentRefWeight} measured={p.parentMeasWeight} onMeas={p.setParentMeasWeight} />
      </Stack>
    );
  }
  if (p.phase === "count") {
    return (
      <Stack spacing={1.5}>
        <TextField label="כמה פריטים בתוך המארז? (כולל פריט האב)" type="number" value={p.itemCount} onChange={(e) => p.setItemCount(e.target.value)} fullWidth />
        {p.itemCount.trim() !== "" && !p.countMatches && (
          <Alert severity="info" sx={{ borderRadius: "12px" }}>
            הוזנו {Number(p.itemCount)} פריטים, אך במערכת רשומים {p.expectedCount} (פריט אב + {p.accessories.length} נלווים).
            בשלב הבא ניתן להוסיף פריטים חסרים, או לחזור לכאן ולעדכן את הכמות.
          </Alert>
        )}
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: INK }}>האם יש צורך בהדפסת מדבקות ברקוד נוספות?</Typography>
        <Stack direction="row" spacing={1.5}>
          {(["yes", "no"] as const).map((v) => (
            <Button key={v} onClick={() => p.setNeedLabels(v)} disableElevation variant={p.needLabels === v ? "contained" : "outlined"}
              sx={{ flex: 1, borderRadius: "9999px", textTransform: "none", boxShadow: "none", ...(p.needLabels === v ? { bgcolor: BLUE, "&:hover": { bgcolor: "#0058b3", boxShadow: "none" } } : { color: BLUE, borderColor: BLUE }) }}>
              {v === "yes" ? "כן" : "לא"}
            </Button>
          ))}
        </Stack>
        {p.needLabels === "yes" && <TextField label="כמות מדבקות (ID זהה למארז)" type="number" value={p.labelQty} onChange={(e) => p.setLabelQty(e.target.value)} fullWidth />}
      </Stack>
    );
  }
  if (p.phase === "accessories") {
    // Each accessory: SKU → "בדיקה" opens a 2-screen sub-flow (photo → weigh).
    return (
      <Stack spacing={1.5}>
        <SystemNote>לכל פריט נלווה: הזן את מק״ט היצרן ולחץ בדיקה. יש לבדוק את כל הפריטים.</SystemNote>
        {!p.countMatches && (
          <Alert severity="warning" sx={{ borderRadius: "12px" }}>
            {p.itemCount.trim() === ""
              ? "לא הוזנה כמות פריטים במארז — חזור לשלב פתיחת המארז."
              : `כמות הפריטים שהוזנה (${Number(p.itemCount)}) אינה תואמת את הפריטים במערכת (${p.expectedCount} — פריט אב + ${p.accessories.length} נלווים). הוסף פריטים חסרים או עדכן את הכמות; לא ניתן להמשיך עד להתאמה.`}
          </Alert>
        )}
        {p.accessories.length === 0 && <Typography sx={{ fontSize: 14, color: MUTED }}>אין פריטים נלווים במערכת. אפשר להוסיף פריט חדש.</Typography>}
        {p.accessories.map((a, idx) => (
          <Box key={a.itemId ?? idx} sx={{ border: `1px solid ${HAIR}`, borderRadius: "12px", p: 2 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1 }}>
              {a.done && <CheckCircleIcon sx={{ color: OK, fontSize: 18, verticalAlign: "middle", ml: 0.5 }} />}
              {a.itemTypeDesc || "פריט נלווה"} {a.serialNo ? `· S/N ${a.serialNo}` : ""} {a.itemId ? `· #${a.itemId}` : ""}
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <TextField label="מק״ט יצרן" value={a.sku} onChange={(e) => p.patchAcc(idx, { sku: e.target.value, hasRU: null })} size="small" fullWidth />
              <Button onClick={() => p.onStartAccessory(idx)} disabled={!a.sku.trim()} disableElevation variant={a.done ? "outlined" : "contained"}
                sx={{ borderRadius: "9999px", px: 3, whiteSpace: "nowrap", textTransform: "none", boxShadow: "none", ...(a.done ? { color: BLUE, borderColor: BLUE } : { bgcolor: BLUE, "&:hover": { bgcolor: "#0058b3", boxShadow: "none" } }) }}>
                {a.done ? "בדוק שוב" : "בדיקה"}
              </Button>
            </Stack>
          </Box>
        ))}
        {p.showAdd ? (
          <Box sx={{ border: `1px dashed ${BLUE}`, borderRadius: "12px", p: 2 }}>
            <Stack spacing={1.5}>
              <TextField select size="small" label="סוג פריט" value={p.draft.itemTypeId} onChange={(e) => p.setDraft((d) => ({ ...d, itemTypeId: e.target.value }))} fullWidth>
                {p.itemTypes.map((t) => <MenuItem key={t.item_type_id} value={String(t.item_type_id)}>{t.item_type_desc?.trim()}</MenuItem>)}
              </TextField>
              <Stack direction="row" spacing={1.5}>
                <TextField size="small" label="מק״ט יצרן" value={p.draft.sku} onChange={(e) => p.setDraft((d) => ({ ...d, sku: e.target.value }))} fullWidth />
                <TextField size="small" label="מספר סריאלי" value={p.draft.serialNumber} onChange={(e) => p.setDraft((d) => ({ ...d, serialNumber: e.target.value }))} fullWidth />
              </Stack>
              <Stack direction="row" spacing={1.5}>
                <TextField size="small" label="מק״ט פנימי" type="number" value={p.draft.makat} onChange={(e) => p.setDraft((d) => ({ ...d, makat: e.target.value }))} fullWidth />
                <TextField size="small" label="דגם" value={p.draft.model} onChange={(e) => p.setDraft((d) => ({ ...d, model: e.target.value }))} fullWidth />
              </Stack>
              <Stack direction="row" spacing={1.5}>
                <TextField size="small" label="יצרן" value={p.draft.manufacturer} onChange={(e) => p.setDraft((d) => ({ ...d, manufacturer: e.target.value }))} fullWidth />
                <TextField size="small" label="מס' יצרן" value={p.draft.manufacturerNo} onChange={(e) => p.setDraft((d) => ({ ...d, manufacturerNo: e.target.value }))} fullWidth />
              </Stack>
              <Stack direction="row" spacing={1.5}>
                <Button onClick={p.onAddAccessory} disabled={p.busy} variant="contained" disableElevation sx={{ borderRadius: "9999px", textTransform: "none", boxShadow: "none", bgcolor: BLUE, "&:hover": { bgcolor: "#0058b3", boxShadow: "none" } }}>הוסף</Button>
                <Button onClick={() => p.setShowAdd(false)} sx={{ borderRadius: "9999px", color: MUTED }}>ביטול</Button>
              </Stack>
            </Stack>
          </Box>
        ) : (
          <Button onClick={() => p.setShowAdd(true)} startIcon={<AddIcon />} sx={{ borderRadius: "9999px", color: BLUE, alignSelf: "flex-start" }}>הוסף פריט</Button>
        )}
      </Stack>
    );
  }
  // transfer — finishing is blocked until every step of the flow is complete.
  if (p.missingSteps.length > 0) {
    return (
      <Stack spacing={2} sx={{ py: 2 }}>
        <Alert severity="warning" sx={{ borderRadius: "12px" }}>
          לא ניתן לסיים את הקליטה — נותרו שלבים להשלמה:
          <Box component="ul" sx={{ m: 0, mt: 1, pr: 2.5 }}>
            {p.missingSteps.map((s, i) => <li key={i}>{s}</li>)}
          </Box>
        </Alert>
      </Stack>
    );
  }
  return (
    <Stack spacing={2} alignItems="center" sx={{ py: 2 }}>
      <CheckCircleIcon sx={{ fontSize: 56, color: OK }} />
      <Typography sx={{ fontSize: 18, fontWeight: 700, color: INK }}>קליטה וצילום הושלמו</Typography>
      <SystemNote>נא להעביר את המוצר לעמדת פירוק והרכבה.</SystemNote>
    </Stack>
  );
}

// ================= accessory sub-flow (photo → weigh) =================
function AccessorySubFlow({ acc, itemPhase, busy, onPick, onRemove, onOk, onNote, onMeas }: {
  acc: Accessory; itemPhase: "photo" | "weigh"; busy: boolean;
  onPick: (file: File) => void;
  onRemove: (idx: number) => void;
  onOk: (v: "pass" | "fail") => void;
  onNote: (v: string) => void;
  onMeas: (v: string) => void;
}) {
  return (
    <Stack spacing={1.5}>
      <Chip label={`${acc.itemTypeDesc || "פריט נלווה"} ${acc.itemId ? `· #${acc.itemId}` : ""}`} sx={{ alignSelf: "flex-start", bgcolor: "rgba(0,102,204,0.08)", color: BLUE, fontWeight: 600 }} />
      {busy && <LinearProgress />}
      {acc.hasRU === false && <Alert severity="warning" sx={{ borderRadius: "12px" }}>לא נמצא פריט ייחוס לאבזר זה.</Alert>}
      {itemPhase === "photo" && (
        <Stack spacing={3}>
          <PhotoSection>
            <PhotoUploader photos={acc.product.photos} refImages={acc.refImages} onPick={onPick} onRemove={onRemove} />
          </PhotoSection>
          <VerdictCard ok={acc.product.ok} note={acc.product.note} rows={2} onOk={onOk} onNote={onNote} />
        </Stack>
      )}
      {itemPhase === "weigh" && (
        <>
          <WeighFields refWeight={acc.refWeight} measured={acc.measWeight} onMeas={onMeas} />
          <Divider />
        </>
      )}
    </Stack>
  );
}
