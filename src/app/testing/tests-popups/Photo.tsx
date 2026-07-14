"use client";
import * as React from "react";
import {
  Dialog, Box, Typography, Button, TextField, Stack, Chip, Alert, IconButton,
  MenuItem, CircularProgress, LinearProgress, Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import CheckIcon from "@mui/icons-material/Check";
import AddIcon from "@mui/icons-material/Add";
import type { StationTestDialogProps, TestResultData } from "../../../types";

// ---- Design tokens (Shifthouse handoff) ----
const BLUE = "#0066cc";
const OK = "#1f8a5b";
const BAD = "#bf3535";
const INK = "#1d1d1f";
const MUTED = "#7a7a7a";
const HAIR = "#e0e0e0";
const TOLERANCE_PCT = 5;

type RefImg = { id: number; url: string };
type Shot = { previewUrl: string; objectKey?: string; uploading?: boolean };
type Photos = { photos: Shot[]; ok: "" | "pass" | "fail"; note: string };
const emptyPhotos = (): Photos => ({ photos: [], ok: "", note: "" });

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
  pkg: Photos;
  product: Photos;
  done: boolean;
  isExisting: boolean;
};

type ItemTypeOption = { item_type_id: number; item_type_desc: string };

// Steps 2 (parent RU) and 6 (RU-accessories) removed; 5+6+7 merged into "accessories".
type Phase = "sku" | "pkgPhoto" | "count" | "accessories" | "transfer";
const PHASES: Phase[] = ["sku", "pkgPhoto", "count", "accessories", "transfer"];
const PHASE_TITLE: Record<Phase, string> = {
  sku: "סריקת מק״ט יצרן",
  pkgPhoto: "צילום האריזה",
  count: "פתיחת המארז",
  accessories: "בדיקת פריטים נלווים",
  transfer: "העברת המוצר",
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
    <Box sx={{ bgcolor: "rgba(0,102,204,0.05)", border: "1px solid rgba(0,102,204,0.15)", borderRadius: "12px", p: 2 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: BLUE, mb: 0.5 }}>הודעת מערכת</Typography>
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
          flex: 1, height: 48, borderRadius: "11px", fontWeight: 600, fontSize: 15,
          textTransform: "none", boxShadow: "none",
          border: `1.5px solid ${active ? color : HAIR}`,
          bgcolor: active ? tint : "#fff", color: active ? color : INK,
          "&:hover": { bgcolor: active ? tint : "#fafafc", borderColor: active ? color : "#c7c7cf" },
        }}>
        {v === "pass" ? "תקין" : "לא תקין"}
      </Button>
    );
  };
  return <Stack direction="row" spacing={1.5}>{opt("pass")}{opt("fail")}</Stack>;
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
          <Box sx={{ flex: 1, display: "flex", gap: "7px" }}>
            {refImages.map((_, i) => (
              <Box key={i} sx={{ flex: 1, height: 4, borderRadius: "9999px", bgcolor: i < captured ? OK : i === activeIdx ? BLUE : HAIR }} />
            ))}
          </Box>
        )}
        {!hasSlots && <Box sx={{ flex: 1 }} />}
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: BLUE, whiteSpace: "nowrap", bgcolor: "rgba(0,102,204,0.08)", borderRadius: "9999px", px: 1.5, py: 0.5, fontVariantNumeric: "tabular-nums" }}>
          {counterText}
        </Typography>
      </Box>

      {/* Large focused frame */}
      <Box sx={{ position: "relative", height: 230, borderRadius: "14px", overflow: "hidden", border: `1px solid ${HAIR}`, bgcolor: "#f0f0f2", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {bigSrc ? (
          <Box component="img" src={bigSrc} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, color: MUTED }}>
            <AddAPhotoIcon sx={{ fontSize: 44 }} />
            <Typography sx={{ fontSize: 13 }}>אין תצוגה — צלם את הפריט</Typography>
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
        sx={{ width: "100%", height: 52, borderRadius: "12px", fontSize: 16, fontWeight: 600, textTransform: "none", boxShadow: "none", bgcolor: BLUE, "&:hover": { bgcolor: "#0058b3", boxShadow: "none" }, "&:active": { transform: "scale(0.98)" } }}>
        {hasSlots && captured >= total ? "צלם מחדש / הוסף" : "צלם / העלה"}
      </Button>

      {/* Filmstrip */}
      <Box sx={{ display: "flex", gap: 1, overflowX: "auto", pb: 0.5 }}>
        {(hasSlots ? refImages : photos).map((_, i) => {
          const shot = photos[i];
          const ref = refImages[i];
          const isCap = !!shot;
          const isActive = i === activeIdx;
          const src = shot?.previewUrl ?? ref?.url;
          return (
            <Box key={i} onClick={() => setActiveIdx(i)}
              sx={{ position: "relative", flex: "0 0 auto", width: 72, height: 72, cursor: "pointer", borderRadius: "10px", overflow: "hidden",
                border: isActive ? `2.5px solid ${BLUE}` : isCap ? `1.5px solid ${OK}` : `1.5px solid ${HAIR}`, bgcolor: "#f0f0f2" }}>
              {src && <Box component="img" src={src} sx={{ width: "100%", height: "100%", objectFit: "cover", opacity: shot?.uploading ? 0.5 : 1 }} />}
              {!isCap && <Box sx={{ position: "absolute", bottom: 3, insetInlineStart: 3, fontSize: 9, fontWeight: 600, color: "#fff", bgcolor: "rgba(0,0,0,0.45)", borderRadius: "5px", px: 0.5 }}>ייחוס</Box>}
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

export default function Photo({ open, onClose, item, station, workerId, onSubmit }: StationTestDialogProps) {
  const [phase, setPhase] = React.useState<Phase>("sku");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [skuScan, setSkuScan] = React.useState("");
  const [parentHasRU, setParentHasRU] = React.useState<boolean | null>(null);
  const [parentRefImages, setParentRefImages] = React.useState<RefImg[]>([]);
  const [pkg, setPkg] = React.useState<Photos>(emptyPhotos());
  const [itemCount, setItemCount] = React.useState("");
  const [needLabels, setNeedLabels] = React.useState<"" | "yes" | "no">("");
  const [labelQty, setLabelQty] = React.useState("");

  const [accessories, setAccessories] = React.useState<Accessory[]>([]);
  const [itemIdx, setItemIdx] = React.useState<number | null>(null);
  const [itemPhase, setItemPhase] = React.useState<"pkg" | "weigh" | "product">("pkg");
  const [itemTypes, setItemTypes] = React.useState<ItemTypeOption[]>([]);
  const [showAdd, setShowAdd] = React.useState(false);
  const [draft, setDraft] = React.useState({ itemTypeId: "", sku: "", serialNumber: "", makat: "", model: "", manufacturer: "", manufacturerNo: "" });

  React.useEffect(() => {
    if (!open) return;
    setPhase("sku"); setError(null); setSkuScan(""); setParentHasRU(null); setParentRefImages([]);
    setPkg(emptyPhotos()); setItemCount(""); setNeedLabels(""); setLabelQty(""); setItemIdx(null);
    setAccessories((item.connected_items ?? []).map((ci): Accessory => ({
      itemId: ci.item_id, serialNo: ci.serial_no, itemTypeId: null, itemTypeDesc: ci.item_type_desc ?? "",
      sku: "", hasRU: null, refWeight: null, refImages: [], measWeight: "",
      pkg: emptyPhotos(), product: emptyPhotos(), done: false, isExisting: true,
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

  const pickParentPhoto = (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setPkg((pk) => ({ ...pk, photos: [...pk.photos, { previewUrl, uploading: true }] }));
    uploadToItem(item.item_id, file).then((key) =>
      setPkg((pk) => ({ ...pk, photos: pk.photos.map((s) => (s.previewUrl === previewUrl ? { ...s, objectKey: key ?? undefined, uploading: false } : s)) })));
  };
  const removeParentPhoto = (idx: number) => setPkg((pk) => ({ ...pk, photos: pk.photos.filter((_, i) => i !== idx) }));

  const pickAccPhoto = (kind: "pkg" | "product", file: File) => {
    if (itemIdx == null) return;
    const idx = itemIdx;
    const targetId = accessories[idx]?.itemId ?? null;
    const previewUrl = URL.createObjectURL(file);
    setAccessories((prev) => prev.map((a, i) => (i === idx ? { ...a, [kind]: { ...a[kind], photos: [...a[kind].photos, { previewUrl, uploading: true }] } } : a)));
    const finishShot = (key: string | null) =>
      setAccessories((prev) => prev.map((a, i) => (i === idx ? { ...a, [kind]: { ...a[kind], photos: a[kind].photos.map((s) => (s.previewUrl === previewUrl ? { ...s, objectKey: key ?? undefined, uploading: false } : s)) } } : a)));
    if (targetId != null) uploadToItem(targetId, file).then(finishShot); else finishShot(null);
  };
  const removeAccPhoto = (kind: "pkg" | "product", shotIdx: number) => {
    if (itemIdx == null) return;
    const idx = itemIdx;
    setAccessories((prev) => prev.map((a, i) => (i === idx ? { ...a, [kind]: { ...a[kind], photos: a[kind].photos.filter((_, j) => j !== shotIdx) } } : a)));
  };

  // ---- navigation ----
  const canContinue = (): boolean => {
    switch (phase) {
      case "sku": return skuScan.trim().length > 0;
      case "pkgPhoto": return pkg.ok !== "";
      case "count": return itemCount.trim() !== "" && needLabels !== "" && (needLabels === "no" || labelQty.trim() !== "");
      case "accessories": return accessories.every((a) => a.done); // empty (no accessories) is allowed
      case "transfer": return true;
      default: return false;
    }
  };

  const goNext = async () => {
    setError(null);
    if (phase === "sku") {
      setBusy(true);
      try { const ru = await lookupRU(skuScan.trim(), item.item_type_id); setParentHasRU(ru.hasRU); setParentRefImages(ru.images); }
      catch { setParentHasRU(false); } finally { setBusy(false); }
      setPhase("pkgPhoto"); return;
    }
    const i = PHASES.indexOf(phase);
    if (i < PHASES.length - 1) setPhase(PHASES[i + 1]);
  };

  const goBack = () => {
    setError(null);
    if (itemIdx != null) {
      if (itemPhase === "product") { setItemPhase("weigh"); return; }
      if (itemPhase === "weigh") { setItemPhase("pkg"); return; }
      setItemIdx(null); return;
    }
    const i = PHASES.indexOf(phase);
    if (i > 0) setPhase(PHASES[i - 1]);
  };

  // ---- accessory sub-flow ----
  const startAccessory = async (idx: number) => {
    setItemIdx(idx); setItemPhase("pkg");
    const a = accessories[idx];
    if (a.hasRU == null && a.sku.trim()) {
      setBusy(true);
      try { const ru = await lookupRU(a.sku.trim(), a.itemTypeId); patchAcc(idx, { hasRU: ru.hasRU, refWeight: ru.refWeight, refImages: ru.images }); }
      finally { setBusy(false); }
    }
  };
  const accNext = () => {
    if (itemIdx == null) return;
    if (itemPhase === "pkg") { setItemPhase("weigh"); return; }
    if (itemPhase === "weigh") { setItemPhase("product"); return; }
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
        pkg: emptyPhotos(), product: emptyPhotos(), done: false, isExisting: false,
      }]);
      setShowAdd(false);
      setDraft({ itemTypeId: "", sku: "", serialNumber: "", makat: "", model: "", manufacturer: "", manufacturerNo: "" });
    } catch { setError("שגיאה בתקשורת"); } finally { setBusy(false); }
  };

  // ---- finish: one result per item ----
  const accPass = (a: Accessory) => {
    const w = weightResult(a.refWeight, a.measWeight);
    return a.pkg.ok !== "fail" && a.product.ok !== "fail" && (w == null || w.pass);
  };
  const parentPass = pkg.ok === "pass";
  const keysOf = (ph: Photos) => ph.photos.map((s) => s.objectKey).filter(Boolean);

  const finish = async () => {
    if (workerId == null) { setError("יש לבחור עובד בכותרת מסך הבדיקות"); return; }
    setSubmitting(true); setError(null);
    try {
      for (const a of accessories) {
        if (a.itemId == null) continue;
        const w = weightResult(a.refWeight, a.measWeight);
        await fetch("/api/testing/results", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ItemID: a.itemId, StationID: station.test_station_id, WorkerID: workerId,
            Result: accPass(a) ? 1 : 0, Passed: accPass(a), Comments: a.pkg.note || a.product.note || undefined,
            Details: {
              sku: a.sku, hasRU: a.hasRU,
              pkg: { ok: a.pkg.ok, note: a.pkg.note, photos: keysOf(a.pkg) },
              weight: w ? { reference: a.refWeight, measured: Number(a.measWeight), diffPct: Number(w.diffPct.toFixed(1)), pass: w.pass } : null,
              product: { ok: a.product.ok, note: a.product.note, photos: keysOf(a.product) },
            },
          }),
        });
      }
      const parentData: TestResultData = {
        Result: parentPass ? 1 : 0, Passed: parentPass, Comments: pkg.note || undefined, WorkerID: workerId ?? undefined,
        Details: {
          sku: skuScan, hasRU: parentHasRU,
          pkg: { ok: pkg.ok, note: pkg.note, photos: keysOf(pkg) },
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

  return (
    <Dialog open={open} onClose={onClose} fullWidth dir="rtl"
      PaperProps={{ sx: { borderRadius: "18px", overflow: "hidden", boxShadow: "rgba(0,0,0,0.22) 3px 5px 30px", width: 620, maxWidth: "94vw" } }}>
      {/* Header */}
      <Box sx={{ p: 3, pb: 2, borderBottom: `1px solid ${HAIR}` }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
          <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px", color: INK }}>
              קליטה וצילום — {PHASE_TITLE[phase]}
            </Typography>
            <Typography sx={{ fontSize: 13, color: MUTED, mt: 0.5 }}>
              #{item.item_id} · {item.model?.trim()} &nbsp;·&nbsp; מק״ט {item.makat} · {item.customer_code ?? "-"}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </Stack>
        <LinearProgress variant="determinate" value={((stepIndex + 1) / PHASES.length) * 100}
          sx={{ mt: 2, height: 4, borderRadius: 2, bgcolor: "#f0f0f0", "& .MuiLinearProgress-bar": { bgcolor: BLUE } }} />
        <Typography sx={{ fontSize: 11, color: MUTED, mt: 0.5 }}>שלב {stepIndex + 1} מתוך {PHASES.length}</Typography>
      </Box>

      {/* Body */}
      <Box sx={{ px: 3, py: 2.5, maxHeight: "70vh", overflowY: "auto" }}>
        {error && <Alert severity="error" sx={{ mb: 2, borderRadius: "12px" }} onClose={() => setError(null)}>{error}</Alert>}

        {activeAcc ? (
          <AccessorySubFlow acc={activeAcc} itemPhase={itemPhase} busy={busy}
            onPick={pickAccPhoto} onRemove={removeAccPhoto}
            onOk={(kind, v) => patchAcc(itemIdx!, { [kind]: { ...activeAcc[kind], ok: v } } as Partial<Accessory>)}
            onNote={(kind, v) => patchAcc(itemIdx!, { [kind]: { ...activeAcc[kind], note: v } } as Partial<Accessory>)}
            onMeas={(v) => patchAcc(itemIdx!, { measWeight: v })}
          />
        ) : (
          <PhaseBody
            phase={phase} busy={busy}
            skuScan={skuScan} setSkuScan={setSkuScan}
            parentHasRU={parentHasRU} pkg={pkg} setPkg={setPkg} parentRefImages={parentRefImages}
            onPickParent={pickParentPhoto} onRemoveParent={removeParentPhoto}
            itemCount={itemCount} setItemCount={setItemCount}
            needLabels={needLabels} setNeedLabels={setNeedLabels} labelQty={labelQty} setLabelQty={setLabelQty}
            accessories={accessories} patchAcc={patchAcc}
            itemTypes={itemTypes} showAdd={showAdd} setShowAdd={setShowAdd} draft={draft} setDraft={setDraft}
            onAddAccessory={addAccessory} onStartAccessory={startAccessory}
          />
        )}
      </Box>

      {/* Footer */}
      <Box sx={{ p: 3, pt: 2, borderTop: `1px solid ${HAIR}`, display: "flex", justifyContent: "space-between", gap: 2 }}>
        <Button onClick={goBack} disabled={submitting || (phase === "sku" && itemIdx == null)}
          variant="text" startIcon={<ArrowBackIcon />}
          sx={{ px: 2, color: MUTED, fontWeight: 600, "&:hover": { bgcolor: "#f5f5f7" } }}>חזור</Button>

        {activeAcc ? (
          <Button onClick={accNext} variant="contained" disableElevation
            disabled={itemPhase === "pkg" ? activeAcc.pkg.ok === "" : itemPhase === "weigh" ? !activeAcc.measWeight : activeAcc.product.ok === ""}
            endIcon={<ArrowForwardIcon />}
            sx={{ borderRadius: "9999px", py: 1.25, minWidth: 120, fontSize: 15, fontWeight: 600, textTransform: "none", boxShadow: "none", bgcolor: BLUE, "&:hover": { bgcolor: "#0058b3", boxShadow: "none" } }}>
            {itemPhase === "product" ? "סיום פריט" : "המשך"}
          </Button>
        ) : phase === "transfer" ? (
          <Button onClick={finish} variant="contained" disableElevation disabled={submitting}
            startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <CheckCircleIcon />}
            sx={{ borderRadius: "9999px", py: 1.25, minWidth: 120, fontSize: 15, fontWeight: 700, textTransform: "none", boxShadow: "none", bgcolor: OK, "&:hover": { bgcolor: "#186f49", boxShadow: "none" } }}>
            {submitting ? "שומר..." : "סיום קליטה"}
          </Button>
        ) : (
          <Button onClick={goNext} variant="contained" disableElevation disabled={!canContinue() || busy}
            endIcon={busy ? <CircularProgress size={18} color="inherit" /> : <ArrowForwardIcon />}
            sx={{ borderRadius: "9999px", py: 1.25, minWidth: 120, fontSize: 15, fontWeight: 600, textTransform: "none", boxShadow: "none", bgcolor: BLUE, "&:hover": { bgcolor: "#0058b3", boxShadow: "none" } }}>המשך</Button>
        )}
      </Box>
    </Dialog>
  );
}

// ================= phase body =================
type PhaseBodyProps = {
  phase: Phase; busy: boolean;
  skuScan: string; setSkuScan: (v: string) => void;
  parentHasRU: boolean | null; pkg: Photos; setPkg: React.Dispatch<React.SetStateAction<Photos>>; parentRefImages: RefImg[];
  onPickParent: (file: File) => void; onRemoveParent: (idx: number) => void;
  itemCount: string; setItemCount: (v: string) => void;
  needLabels: "" | "yes" | "no"; setNeedLabels: (v: "" | "yes" | "no") => void; labelQty: string; setLabelQty: (v: string) => void;
  accessories: Accessory[]; patchAcc: (idx: number, patch: Partial<Accessory>) => void;
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
      <Stack spacing={1.5}>
        {/* Message shown only when no reference item is found. */}
        {p.parentHasRU === false && (
          <Chip size="small" label="לא נמצא פריט ייחוס — נא להודיע לגורם אחראי"
            sx={{ alignSelf: "flex-start", bgcolor: "rgba(217,118,6,0.10)", color: "#9a5b06", fontWeight: 600 }} />
        )}
        <PhotoUploader photos={p.pkg.photos} refImages={p.parentRefImages} onPick={p.onPickParent} onRemove={p.onRemoveParent} />
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: INK }}>בדיקה תקינה?</Typography>
        <PassFail value={p.pkg.ok} onChange={(v) => p.setPkg((pk) => ({ ...pk, ok: v }))} />
        <TextField label="הערות" value={p.pkg.note} onChange={(e) => p.setPkg((pk) => ({ ...pk, note: e.target.value }))} multiline rows={2} fullWidth />
      </Stack>
    );
  }
  if (p.phase === "count") {
    return (
      <Stack spacing={1.5}>
        <TextField label="כמה פריטים בתוך המארז?" type="number" value={p.itemCount} onChange={(e) => p.setItemCount(e.target.value)} fullWidth />
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
    // merged 5+6+7: enter each accessory's SKU and test it; all get tested.
    return (
      <Stack spacing={1.5}>
        <SystemNote>לכל פריט נלווה: הזן את מק״ט היצרן ולחץ בדיקה. יש לבדוק את כל הפריטים.</SystemNote>
        {p.accessories.length === 0 && <Typography sx={{ fontSize: 14, color: MUTED }}>אין פריטים נלווים. אפשר להוסיף או להמשיך.</Typography>}
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
  // transfer
  return (
    <Stack spacing={2} alignItems="center" sx={{ py: 2 }}>
      <CheckCircleIcon sx={{ fontSize: 56, color: OK }} />
      <Typography sx={{ fontSize: 18, fontWeight: 700, color: INK }}>קליטה וצילום הושלמו</Typography>
      <SystemNote>נא להעביר את המוצר לעמדת פירוק והרכבה.</SystemNote>
    </Stack>
  );
}

// ================= accessory sub-flow =================
function AccessorySubFlow({ acc, itemPhase, busy, onPick, onRemove, onOk, onNote, onMeas }: {
  acc: Accessory; itemPhase: "pkg" | "weigh" | "product"; busy: boolean;
  onPick: (kind: "pkg" | "product", file: File) => void;
  onRemove: (kind: "pkg" | "product", idx: number) => void;
  onOk: (kind: "pkg" | "product", v: "pass" | "fail") => void;
  onNote: (kind: "pkg" | "product", v: string) => void;
  onMeas: (v: string) => void;
}) {
  const w = weightResult(acc.refWeight, acc.measWeight);
  return (
    <Stack spacing={1.5}>
      <Chip label={`${acc.itemTypeDesc || "פריט נלווה"} ${acc.itemId ? `· #${acc.itemId}` : ""}`} sx={{ alignSelf: "flex-start", bgcolor: "rgba(0,102,204,0.08)", color: BLUE, fontWeight: 600 }} />
      {busy && <LinearProgress />}
      {acc.hasRU === false && <Alert severity="warning" sx={{ borderRadius: "12px" }}>לא נמצא פריט ייחוס לאבזר זה.</Alert>}
      {itemPhase === "pkg" && (
        <>
          <PhotoUploader photos={acc.pkg.photos} refImages={acc.refImages} onPick={(f) => onPick("pkg", f)} onRemove={(i) => onRemove("pkg", i)} />
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>בדיקה תקינה?</Typography>
          <PassFail value={acc.pkg.ok} onChange={(v) => onOk("pkg", v)} />
          <TextField label="הערות" value={acc.pkg.note} onChange={(e) => onNote("pkg", e.target.value)} multiline rows={2} fullWidth />
        </>
      )}
      {itemPhase === "weigh" && (
        <>
          <SystemNote>נא לשקול את הפריט ולהזין את המשקל שנמדד. הסטייה מחושבת אוטומטית.</SystemNote>
          <TextField label="משקל פריט ייחוס (גר')" value={acc.refWeight ?? "לא מוגדר"} InputProps={{ readOnly: true }} fullWidth />
          <TextField label="משקל פריט נבדק (גר')" type="number" value={acc.measWeight} onChange={(e) => onMeas(e.target.value)} fullWidth />
          {w && (
            <Alert severity={w.pass ? "success" : "error"} sx={{ borderRadius: "12px" }}>
              {w.pass ? "משקל תקין" : "משקל לא תקין"} — סטייה {w.diff > 0 ? "+" : ""}{w.diff.toFixed(0)} גר' ({w.diffPct.toFixed(1)}% · סטייה תקנית ±{TOLERANCE_PCT}%)
            </Alert>
          )}
          {acc.measWeight && !w && <Alert severity="warning" sx={{ borderRadius: "12px" }}>אין משקל ייחוס לסוג פריט זה — טפל ידנית.</Alert>}
          <Divider />
        </>
      )}
      {itemPhase === "product" && (
        <>
          <PhotoUploader photos={acc.product.photos} refImages={acc.refImages} onPick={(f) => onPick("product", f)} onRemove={(i) => onRemove("product", i)} />
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>בדיקה תקינה?</Typography>
          <PassFail value={acc.product.ok} onChange={(v) => onOk("product", v)} />
          <TextField label="הערות" value={acc.product.note} onChange={(e) => onNote("product", e.target.value)} multiline rows={2} fullWidth />
        </>
      )}
    </Stack>
  );
}
