"use client";
import * as React from "react";
import { Stack, Alert } from "@/components/ui";
import type { StationTestDialogProps, TestResultData } from "../../../types";
import { uploadItemFiles } from "@/lib/api/direct-upload";
import { apiFetch } from "@/lib/api/client";
import { SUGGEST_PREFIX, SUGGEST_TAIL_WORKER_DECIDES } from "@/app/lib/station-fields/labels";
import { NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import {
  type Photos, type RefImg, emptyPhotos, lookupRU, useShotDiscard,
  SkuScreen, PhotoSection, PhotoUploader, VerdictCard,
  StationShell, type ShellPhase, SKU_TITLE, SKU_DESC,
} from "./stationKit";
import { FieldsBlock, FieldsBlockFallback } from "../fields/FieldsBlock";
import type { UploadFieldPhoto } from "../fields/FieldRow";
import { SuggestionLine } from "../fields/SuggestionLine";
import { fieldsErrorText, shouldReloadFields } from "../fields/errors";
import { VARIANT_SPEC, stationBlockTitle } from "../fields/fieldsBlockModel";
import { useFieldsState } from "../fields/useFieldsState";
import { useStationFields } from "../fields/useStationFields";

/**
 * Which photo group this station captures. Only the numeric photo_types id is
 * kept in code, so no group name lives here (the ids are pinned by the
 * settings seed); the group's `code` is resolved at runtime from
 * /api/settings/photo-types, inactive types included. Every capture is tagged
 * with that code. The reference images are the station type's own
 * (imagesByStation — the station type is the reference set).
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
 *
 * Station fields (route-fields spec §4.11.2, artboard 13): when the item's route
 * publishes fields for this step, the photo step gets one block of them between
 * the photos and "בדיקה תקינה?", the suggestion line under the pass/fail pair,
 * and finishing waits for them. Without a published config the popup is exactly
 * today's.
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

  // ---- station fields of this step (spec §4.2–§4.3) ----
  const sf = useStationFields(item.item_id, open, station.test_station_id);
  const ready = sf.status === "ready" && sf.mode === "item" ? sf : null;
  const fx = useFieldsState(ready ? ready.fields : []);
  const hasFields = ready != null && fx.defsCount > 0;
  // Finishing waits for the answer (loading / error), then for the fields themselves.
  const fieldsGate = sf.status === "loading" || sf.status === "error" || (hasFields && fx.blocking(ready.gate));
  const { reset: resetFields } = fx;

  // Reset during render when the dialog opens or the item changes.
  const [openedFor, setOpenedFor] = React.useState<{ open: boolean; item: typeof item } | null>(null);
  if (!openedFor || openedFor.open !== open || openedFor.item !== item) {
    setOpenedFor({ open, item });
    if (open) {
      // The SKU carries on from the station before (ItemRow.last_sku).
      setPhaseIdx(0); setError(null); setSkuScan(item.last_sku ?? ""); setHasRU(null); setRefImages([]); setPhoto(emptyPhotos()); resetFields();
    }
  }

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

  // A photo field of the station fields uploads the same way, tagged with that
  // field's own photo type; null = it never got there (the shot reads failed).
  const uploadFieldPhoto = React.useCallback<UploadFieldPhoto>(
    (file, photoType) => uploadItemFiles(item.item_id, [file], { workerId, stationTypeId: station.test_station_type_id, photoType })
      .then(([result]) => result?.objectKey ?? null, () => null),
    [item.item_id, workerId, station.test_station_type_id],
  );

  const { discard, landed } = useShotDiscard(workerId);
  const pickPhoto = (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setPhoto((pk) => ({ ...pk, photos: [...pk.photos, { previewUrl, uploading: true }] }));
    uploadToItem(item.item_id, file).then((key) => {
      if (landed(item.item_id, previewUrl, key)) return;
      setPhoto((pk) => ({ ...pk, photos: pk.photos.map((s) => (s.previewUrl === previewUrl ? { ...s, objectKey: key ?? undefined, uploading: false, failed: key == null } : s)) }));
    });
  };
  const removePhoto = (idx: number) => {
    discard(item.item_id, photo.photos[idx]);
    setPhoto((pk) => ({ ...pk, photos: pk.photos.filter((_, i) => i !== idx) }));
  };

  // ---- navigation ----
  const runLookup = React.useCallback(async () => {
    try { const ru = await lookupRU(skuScan.trim(), item.item_type_id, station.test_station_type_id); setHasRU(ru.hasRU); setRefImages(ru.images); }
    catch { setHasRU(false); }
  }, [skuScan, item.item_type_id, station.test_station_type_id]);

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
  // the photo. The worker removes the red shot and takes it again. The station
  // fields gate it too (fieldsGate).
  const canFinish = skuScan.trim().length > 0 && photo.ok !== "" && !photo.photos.some((s) => s.uploading || s.failed) && !fieldsGate;

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
          // Station fields: schema, fields and verdict { ok, suggested } beside
          // `photo` — every key above stays (spec §4.0 rule 5).
          ...(hasFields ? fx.toBlock(ready.schema, { ok: photo.ok }) : {}),
        },
      };
      await onSubmit(data);
      onClose();
    } catch (e) {
      setError(fieldsErrorText(e, "שגיאה בשמירת הבדיקה"));
      // 409: the route's fields changed while the popup was open. Load them
      // again, whatever the last answer was; the drafts stay, by FieldId.
      if (shouldReloadFields(e)) sf.reload();
    } finally { setSubmitting(false); }
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
        <SkuScreen value={skuScan} onChange={setSkuScan} prev={item.last_sku} serial={item.serial_no} />
      ) : (
        <Stack spacing={3}>
          {hasRU === false && (
            <Alert severity="warning">לא נמצא פריט ייחוס — נא להודיע לגורם אחראי</Alert>
          )}
          <PhotoSection>
            <PhotoUploader photos={photo.photos} refImages={refImages} onPick={pickPhoto} onRemove={removePhoto} />
          </PhotoSection>
          {/* The step's station fields — or, until they arrive, their stand-in (nothing without a config). */}
          {hasFields ? (
            <FieldsBlock variant="photo" title={stationBlockTitle(kind)} groups={[{ fields: ready.fields }]} fx={fx}
              uploadPhoto={uploadFieldPhoto} />
          ) : (
            <FieldsBlockFallback sf={sf} />
          )}
          <VerdictCard ok={photo.ok} note={photo.note}
            onOk={(v) => setPhoto((pk) => ({ ...pk, ok: v }))}
            onNote={(v) => setPhoto((pk) => ({ ...pk, note: v }))}
            suggestion={hasFields
              ? <SuggestionLine fails={fx.ev.fails} defs={ready.fields} prefix={SUGGEST_PREFIX} tail={SUGGEST_TAIL_WORKER_DECIDES} icon="triangle" />
              : undefined}
            noteMax={hasFields ? NOTE_MAX_DEFAULT : undefined} noteLook={VARIANT_SPEC.photo.noteLook} />
        </Stack>
      )}
    </StationShell>
  );
}
