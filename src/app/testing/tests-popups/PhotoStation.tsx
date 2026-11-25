"use client";
import * as React from "react";
import { Stack, Alert } from "@/components/ui";
import type { TestResultData } from "@/app/lib/testing/contract";
import { getArray } from "@/lib/api/client";
import { TEMPLATE_DEFAULTS } from "@/app/lib/popup-templates/labels";
import { SUGGEST_PREFIX, SUGGEST_TAIL_WORKER_DECIDES } from "@/app/lib/station-fields/labels";
import { NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import { FieldsBlock, FieldsBlockFallback } from "../fields/FieldsBlock";
import { PhotoUploader, type RefImg } from "../fields/PhotoUploader";
import { SuggestionLine } from "../fields/SuggestionLine";
import { VARIANT_SPEC, stationBlockTitle } from "../fields/fieldsBlockModel";
import { SkuScreen, PhotoSection, VerdictCard, StationShell, type ShellPhase } from "./stationKit";
import { lookupItemReference } from "./reference";
import { emptyPhotos, shotKeys, useShotUpload, type Photos } from "./shots";
import { NO_WORKER_TEXT, useStepFields } from "./stepFields";
import type { StationPopupProps } from "./props";
import { stationFinishLabel } from "./stationTexts";

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
 * (`stationTypeName`), so no station name lives in the code.
 *
 * Station fields (route-fields spec §4.11.2, artboard 13): when the item's route
 * publishes fields for this step, the photo step gets one block of them between
 * the photos and "בדיקה תקינה?", the suggestion line under the pass/fail pair,
 * and finishing waits for them. Without a published config the popup is exactly
 * today's.
 */
export default function PhotoStation({
  onClose, item, station, stationTypeName, workerId, workerName, onSubmit, config,
}: StationPopupProps & { config: PhotoStationConfig }) {
  const kind = stationTypeName?.trim() || null;

  // The photo group's code, looked up by id. Kept with the id it was resolved
  // for, so a different config never reuses it.
  const [resolved, setResolved] = React.useState<{ id: number; code: string | null } | null>(null);
  const photoCode = resolved?.id === config.photoTypeId ? resolved.code : null;
  React.useEffect(() => {
    if (resolved?.id === config.photoTypeId) return;
    let cancelled = false;
    getArray<{ photo_type_id: number; code: string }>("/api/settings/photo-types?all=1")
      .then((rows) => {
        if (cancelled) return;
        const hit = rows.find((t) => t.photo_type_id === config.photoTypeId);
        setResolved({ id: config.photoTypeId, code: hit?.code ?? null });
      })
      // Left unresolved: the next opening asks again.
      .catch((e) => console.error("photo types failed to load", e));
    return () => { cancelled = true; };
  }, [resolved, config.photoTypeId]);

  const [phaseIdx, setPhaseIdx] = React.useState(0); // 0 = sku, 1 = photo
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // The SKU carries on from the station before (QueueRow.last_sku).
  const [skuScan, setSkuScan] = React.useState(item.last_sku ?? "");
  const [hasRU, setHasRU] = React.useState<boolean | null>(null);
  const [refImages, setRefImages] = React.useState<RefImg[]>([]);
  const [photo, setPhoto] = React.useState<Photos>(emptyPhotos);

  const step = useStepFields({ itemId: item.item_id, stationId: station.test_station_id, stationTypeId: station.test_station_type_id, workerId });
  const { fx, cfg } = step;

  const phases: ShellPhase[] = [
    { key: "sku", title: TEMPLATE_DEFAULTS.skuStepTitle, desc: TEMPLATE_DEFAULTS.skuStepDesc },
    { key: "photo", title: kind ? `צילום ${kind}` : "צילום", desc: "צלם את הפריט לפי תמונות הייחוס, ואשר את תקינותו." },
  ];

  // Every capture is tagged with the station's photo-type code, so each screen / station lists only
  // its own group (GET /files?photoType=...). No resolved group yet → the shot reads failed (red,
  // retake) rather than storing an untagged photo.
  const shots = useShotUpload(workerId, station.test_station_type_id);
  const pickPhoto = (file: File) =>
    shots.pick(item.item_id, file, photoCode || null, (fn) => setPhoto((pk) => ({ ...pk, photos: fn(pk.photos) })));
  const removePhoto = (idx: number) => {
    shots.remove(item.item_id, photo.photos[idx]);
    setPhoto((pk) => ({ ...pk, photos: pk.photos.filter((_, i) => i !== idx) }));
  };

  const runLookup = React.useCallback(async () => {
    try { const ru = await lookupItemReference(skuScan.trim(), item.item_type_id, station.test_station_type_id); setHasRU(ru.hasRU); setRefImages(ru.images); }
    catch (e) { console.error("reference lookup failed", e); setHasRU(false); }
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

  const pass = photo.ok === "pass";
  // A shot still uploading, or one whose upload failed, blocks finishing: a
  // failed upload leaves nothing in storage, so finishing would silently lose
  // the photo. The worker removes the red shot and takes it again.
  const canFinish = skuScan.trim().length > 0 && photo.ok !== "" && !photo.photos.some((s) => s.uploading || s.failed) && !step.blocking;

  const onFinish = async () => {
    if (workerId == null) { setError(NO_WORKER_TEXT); return; }
    if (!canFinish) { setError("לא ניתן לסיים — יש להשלים את כל שלבי הבדיקה"); return; }
    setSubmitting(true); setError(null);
    try {
      const data: TestResultData = {
        Result: pass ? 1 : 0, Passed: pass, Comments: photo.note || undefined, WorkerID: workerId ?? undefined,
        Details: {
          // The station type by number (the result also stores it as a column).
          station: `type-${station.test_station_type_id}`,
          sku: skuScan, hasRU,
          photo: { ok: photo.ok, note: photo.note, photos: shotKeys(photo) },
          // Station fields: schema, fields and verdict { ok, suggested } beside
          // `photo` — every key above stays (spec §4.0 rule 5).
          ...(cfg ? fx.toBlock(cfg.schema, { ok: photo.ok }) : {}),
        },
      };
      await onSubmit(data);
      onClose();
    } catch (e) {
      setError(step.saveErrorText(e, "שגיאה בשמירת הבדיקה"));
    } finally { setSubmitting(false); }
  };

  return (
    <StationShell
      onClose={onClose} item={item} workerId={workerId} workerName={workerName}
      contextLabel={kind ?? station.test_station_desc} stationName={station.test_station_desc} phases={phases} currentIndex={phaseIdx}
      onStep={onStep} onBack={onBack} error={error} onClearError={() => setError(null)}
      busy={busy} submitting={submitting}
      canNext={skuScan.trim().length > 0} onNext={onNext}
      canFinish={canFinish} onFinish={onFinish} finishLabel={stationFinishLabel(kind)}
    >
      {phaseIdx === 0 ? (
        <SkuScreen value={skuScan} onChange={setSkuScan} prev={item.last_sku} serial={item.serial_no} />
      ) : (
        <Stack spacing={3}>
          {hasRU === false && (
            <Alert severity="warning">{TEMPLATE_DEFAULTS.noReference}</Alert>
          )}
          <PhotoSection>
            <PhotoUploader photos={photo.photos} refImages={refImages} onPick={pickPhoto} onRemove={removePhoto} />
          </PhotoSection>
          {/* The step's station fields — or, until they arrive, their stand-in (nothing without a config). */}
          {cfg ? (
            <FieldsBlock variant="photo" title={stationBlockTitle(kind)} groups={[{ fields: cfg.fields }]} fx={fx}
              uploadPhoto={step.uploadFieldPhoto} />
          ) : (
            <FieldsBlockFallback sf={step.sf} />
          )}
          <VerdictCard ok={photo.ok} note={photo.note}
            onOk={(v) => setPhoto((pk) => ({ ...pk, ok: v }))}
            onNote={(v) => setPhoto((pk) => ({ ...pk, note: v }))}
            suggestion={cfg
              ? <SuggestionLine fails={fx.ev.fails} defs={cfg.fields} prefix={SUGGEST_PREFIX} tail={SUGGEST_TAIL_WORKER_DECIDES} icon="triangle" />
              : undefined}
            noteMax={cfg ? NOTE_MAX_DEFAULT : undefined} noteLook={VARIANT_SPEC.photo.noteLook} />
        </Stack>
      )}
    </StationShell>
  );
}
