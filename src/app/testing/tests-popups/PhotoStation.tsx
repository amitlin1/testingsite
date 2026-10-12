"use client";
import * as React from "react";
import { Stack, Alert } from "@/components/ui";
import type { StationTestDialogProps, TestResultData } from "../../../types";
import { uploadItemFiles } from "@/lib/api/direct-upload";
import { apiFetch } from "@/lib/api/client";
import {
  type Photos, type RefImg, emptyPhotos, lookupRU,
  SkuScreen, PhotoSection, PhotoUploader, VerdictCard,
  StationShell, type ShellPhase, SKU_TITLE, SKU_DESC,
} from "./stationKit";

/**
 * Which photo group this station captures. Only the numeric photo_types id is
 * kept in code, so no group name lives here (the ids are pinned by the
 * settings seed); the group's `code` is resolved at runtime from
 * /api/settings/photo-types, inactive types included. Reference images are
 * pulled from imagesByType[code] and every capture is tagged with that code,
 * so each station lists only its own group.
 */
export type PhotoStationConfig = {
  /** photo_types.photo_type_id of the group this station captures. */
  photoTypeId: number;
};

/**
 * Generic two-screen test station: manufacturer-SKU scan → one reference-guided
 * photo group + verdict. Its titles come from the station type's name in the DB
 * (`stationTypeName`), so no station name lives in the code. Shares the intake
 * wizard's chrome via StationShell.
 */
export default function PhotoStation({
  open, onClose, item, station, stationTypeName, workerId, workerName, onSubmit, config,
}: StationTestDialogProps & { config: PhotoStationConfig }) {
  const kind = stationTypeName?.trim() || null;

  // The photo group's code, looked up by id once the wizard opens. Kept with
  // the id it was resolved for, so a different config never reuses it.
  const [resolved, setResolved] = React.useState<{ id: number; code: string | null } | null>(null);
  const photoCode = resolved?.id === config.photoTypeId ? resolved.code : null;
  React.useEffect(() => {
    if (!open || resolved?.id === config.photoTypeId) return;
    let cancelled = false;
    apiFetch("/api/settings/photo-types?all=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((rows: { photo_type_id: number; code: string }[]) => {
        if (cancelled) return;
        const hit = Array.isArray(rows) ? rows.find((t) => t.photo_type_id === config.photoTypeId) : undefined;
        setResolved({ id: config.photoTypeId, code: hit?.code ?? null });
      })
      .catch(() => {}); // left unresolved → retried on the next open
    return () => { cancelled = true; };
  }, [open, resolved, config.photoTypeId]);

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
    { key: "photo", title: kind ? `צילום ${kind}` : "צילום", desc: "צלם את הפריט לפי תמונות הייחוס, ואשר את תקינותו." },
  ];

  // ---- real photo upload (reuses the item-files pipeline) ----
  // The photo goes straight from the browser to MinIO (presign → POST → confirm);
  // the app never sees the bytes. Every capture is tagged with the station's
  // photo-type code so each screen / station lists only its own group
  // (GET /files?photoType=...). A null return means the photo never reached
  // storage; the shot is then flagged failed so it reads red instead of looking
  // saved.
  const uploadToItem = React.useCallback(async (itemId: number, file: File): Promise<string | null> => {
    // No resolved group yet → treat as a failed shot (red, retake) rather than
    // storing an untagged photo.
    if (!photoCode) return null;
    try {
      const [result] = await uploadItemFiles(itemId, [file], {
        workerId,
        stationTypeId: station.test_station_type_id,
        photoType: photoCode,
      });
      return result?.objectKey ?? null;
    } catch { return null; }
  }, [workerId, station.test_station_type_id, photoCode]);

  const pickPhoto = (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setPhoto((pk) => ({ ...pk, photos: [...pk.photos, { previewUrl, uploading: true }] }));
    uploadToItem(item.item_id, file).then((key) =>
      setPhoto((pk) => ({ ...pk, photos: pk.photos.map((s) => (s.previewUrl === previewUrl ? { ...s, objectKey: key ?? undefined, uploading: false, failed: key == null } : s)) })));
  };
  const removePhoto = (idx: number) =>
    setPhoto((pk) => ({ ...pk, photos: pk.photos.filter((_, i) => i !== idx) }));

  // ---- navigation ----
  const runLookup = React.useCallback(async () => {
    try { const ru = await lookupRU(skuScan.trim(), item.item_type_id); setHasRU(ru.hasRU); setRefImages(photoCode ? ru.imagesByType[photoCode] ?? [] : []); }
    catch { setHasRU(false); }
  }, [skuScan, item.item_type_id, photoCode]);

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
  // A shot still uploading, or one whose upload failed, blocks finishing: a
  // failed upload leaves nothing in storage, so finishing would silently lose
  // the photo. The worker removes the red shot and takes it again.
  const canFinish = skuScan.trim().length > 0 && photo.ok !== "" && !photo.photos.some((s) => s.uploading || s.failed);

  const onFinish = async () => {
    if (workerId == null) { setError("יש לבחור עובד בכותרת מסך הבדיקות"); return; }
    if (!canFinish) { setError("לא ניתן לסיים — יש להשלים את כל שלבי הבדיקה"); return; }
    setSubmitting(true); setError(null);
    try {
      const data: TestResultData = {
        Result: pass ? 1 : 0, Passed: pass, Comments: photo.note || undefined, WorkerID: workerId ?? undefined,
        Details: {
          // The station type by number (the result also stores it as a column).
          station: `type-${station.test_station_type_id}`,
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
      contextLabel={kind ?? station.test_station_desc} stationName={station.test_station_desc} phases={phases} currentIndex={phaseIdx}
      onStep={onStep} onBack={onBack} error={error} onClearError={() => setError(null)}
      busy={busy} submitting={submitting}
      canNext={skuScan.trim().length > 0} onNext={onNext}
      canFinish={canFinish} onFinish={onFinish} finishLabel={kind ? `סיום בדיקת ${kind}` : "סיום בדיקה"}
    >
      {phaseIdx === 0 ? (
        <SkuScreen value={skuScan} onChange={setSkuScan} />
      ) : (
        <Stack spacing={3}>
          {hasRU === false && (
            <Alert severity="warning">לא נמצא פריט ייחוס — נא להודיע לגורם אחראי</Alert>
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
