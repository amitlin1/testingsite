"use client";
import * as React from "react";
import { Stack, Chip } from "@/components/ui";
import type { StationTestDialogProps, TestResultData } from "../../../types";
import { apiFetch } from "@/lib/api/client";
import {
  type Photos, type RefImg, emptyPhotos, lookupRU,
  SkuScreen, PhotoSection, PhotoUploader, VerdictCard,
  StationShell, type ShellPhase, SKU_TITLE, SKU_DESC,
} from "./stationKit";

/**
 * Config that turns this generic two-screen station into a concrete one
 * (disassembly / assembly / …). `photoType` is the photo_types.code the screen
 * addresses: reference images are pulled from imagesByType[photoType] and every
 * capture is tagged with the same code so each station lists only its own group.
 */
export type PhotoStationConfig = {
  /** Stable station key echoed into the result Details payload. */
  stationKey: string;
  /** photo_types.code — reference-image group + capture tag. */
  photoType: string;
  /** Eyebrow label on the rail/header (e.g. "פירוק" / "הרכבה"). */
  contextLabel: string;
  /** Title of the photo phase (e.g. "צילום פירוק"). */
  photoTitle: string;
  /** One-line description under the photo-phase title. */
  photoDesc: string;
  /** Green finish button label. */
  finishLabel: string;
};

/**
 * Generic two-screen test station: manufacturer-SKU scan → one reference-guided
 * photo group + verdict. Configured (via `config`) into the disassembly / assembly
 * stations. Shares the intake wizard's chrome via StationShell.
 */
export default function PhotoStation({
  open, onClose, item, station, workerId, workerName, onSubmit, config,
}: StationTestDialogProps & { config: PhotoStationConfig }) {
  const [phaseIdx, setPhaseIdx] = React.useState(0); // 0 = sku, 1 = photo
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [skuScan, setSkuScan] = React.useState("");
  const [hasRU, setHasRU] = React.useState<boolean | null>(null);
  const [refImages, setRefImages] = React.useState<RefImg[]>([]);
  const [photo, setPhoto] = React.useState<Photos>(emptyPhotos());

  React.useEffect(() => {
    if (!open) return;
    setPhaseIdx(0); setError(null); setSkuScan(""); setHasRU(null); setRefImages([]); setPhoto(emptyPhotos());
  }, [open, item]);

  const phases: ShellPhase[] = [
    { key: "sku", title: SKU_TITLE, desc: SKU_DESC },
    { key: "photo", title: config.photoTitle, desc: config.photoDesc },
  ];

  // ---- real photo upload (reuses the item-files pipeline) ----
  // Every capture is tagged with the station's photo-type code so each screen /
  // station lists only its own group (GET /files?photoType=...).
  const uploadToItem = React.useCallback(async (itemId: number, file: File): Promise<string | null> => {
    try {
      const fd = new FormData();
      fd.append("files", file);
      if (workerId != null) fd.append("worker_id", String(workerId));
      fd.append("station_type_id", String(station.test_station_type_id));
      fd.append("photo_type", config.photoType);
      const res = await apiFetch(`/api/items/${itemId}/files`, { method: "POST", body: fd });
      if (!res.ok) return null;
      const d = await res.json();
      return d.uploaded?.[0]?.objectKey ?? null;
    } catch { return null; }
  }, [workerId, station.test_station_type_id, config.photoType]);

  const pickPhoto = (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setPhoto((pk) => ({ ...pk, photos: [...pk.photos, { previewUrl, uploading: true }] }));
    uploadToItem(item.item_id, file).then((key) =>
      setPhoto((pk) => ({ ...pk, photos: pk.photos.map((s) => (s.previewUrl === previewUrl ? { ...s, objectKey: key ?? undefined, uploading: false } : s)) })));
  };
  const removePhoto = (idx: number) =>
    setPhoto((pk) => ({ ...pk, photos: pk.photos.filter((_, i) => i !== idx) }));

  // ---- navigation ----
  const runLookup = React.useCallback(async () => {
    try { const ru = await lookupRU(skuScan.trim(), item.item_type_id); setHasRU(ru.hasRU); setRefImages(ru.imagesByType[config.photoType] ?? []); }
    catch { setHasRU(false); }
  }, [skuScan, item.item_type_id, config.photoType]);

  const onNext = async () => {
    setError(null);
    setBusy(true);
    await runLookup();
    setBusy(false);
    setPhaseIdx(1);
  };

  const onBack = () => { setError(null); if (phaseIdx > 0) setPhaseIdx(phaseIdx - 1); };

  const onStep = (i: number) => {
    setError(null);
    if (i > 0 && hasRU == null && skuScan.trim() && !busy) {
      setBusy(true);
      runLookup().finally(() => setBusy(false));
    }
    setPhaseIdx(i);
  };

  // ---- finish: one result for the item ----
  const keysOf = (ph: Photos) => ph.photos.map((s) => s.objectKey).filter(Boolean);
  const pass = photo.ok === "pass";
  const canFinish = skuScan.trim().length > 0 && photo.ok !== "";

  const onFinish = async () => {
    if (workerId == null) { setError("יש לבחור עובד בכותרת מסך הבדיקות"); return; }
    if (!canFinish) { setError("לא ניתן לסיים — יש להשלים את כל שלבי הבדיקה"); return; }
    setSubmitting(true); setError(null);
    try {
      const data: TestResultData = {
        Result: pass ? 1 : 0, Passed: pass, Comments: photo.note || undefined, WorkerID: workerId ?? undefined,
        Details: {
          station: config.stationKey,
          sku: skuScan, hasRU,
          photo: { ok: photo.ok, note: photo.note, photos: keysOf(photo) },
        },
      };
      await onSubmit(data);
      onClose();
    } catch { setError("שגיאה בשמירת הבדיקה"); } finally { setSubmitting(false); }
  };

  return (
    <StationShell
      open={open} onClose={onClose} item={item} workerId={workerId} workerName={workerName}
      contextLabel={config.contextLabel} phases={phases} currentIndex={phaseIdx}
      onStep={onStep} onBack={onBack} error={error} onClearError={() => setError(null)}
      busy={busy} submitting={submitting}
      canNext={skuScan.trim().length > 0} onNext={onNext}
      canFinish={canFinish} onFinish={onFinish} finishLabel={config.finishLabel}
    >
      {phaseIdx === 0 ? (
        <SkuScreen value={skuScan} onChange={setSkuScan} />
      ) : (
        <Stack spacing={3}>
          {hasRU === false && (
            <Chip size="small" label="לא נמצא פריט ייחוס — נא להודיע לגורם אחראי"
              sx={{ alignSelf: "flex-start", bgcolor: "rgba(217,118,6,0.10)", color: "#9a5b06", fontWeight: 600 }} />
          )}
          <PhotoSection>
            <PhotoUploader photos={photo.photos} refImages={refImages} onPick={pickPhoto} onRemove={removePhoto} />
          </PhotoSection>
          <VerdictCard ok={photo.ok} note={photo.note}
            onOk={(v) => setPhoto((pk) => ({ ...pk, ok: v }))}
            onNote={(v) => setPhoto((pk) => ({ ...pk, note: v }))} />
        </Stack>
      )}
    </StationShell>
  );
}
