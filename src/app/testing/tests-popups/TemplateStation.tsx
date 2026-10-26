"use client";
import * as React from "react";
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@/components/ui";
import type { StationTestDialogProps, TestResultData } from "../../../types";
import { apiFetch } from "@/lib/api/client";
import { uploadItemFiles } from "@/lib/api/direct-upload";
import { SUGGEST_PREFIX } from "@/app/lib/station-fields/labels";
import { fillVariables, skuScanOf } from "@/app/lib/popup-templates/schema";
import type { PhotoComponent, PopupTemplateJson, TemplateComponent, WeightComponent } from "@/app/lib/popup-templates/schema";
import { COMPONENT_NAME, TEMPLATE_DEFAULTS } from "@/app/lib/popup-templates/labels";
import {
  BAD, HAIR, INK, MUTED, OK, type RefImg, type ShellPhase,
  PhotoSection, PhotoUploader, SkuScreen, StationShell, SystemNote, VerdictCard, lookupRU, useShotDiscard,
} from "./stationKit";
import { FieldsBlock, FieldsBlockFallback } from "../fields/FieldsBlock";
import type { UploadFieldPhoto } from "../fields/FieldRow";
import { SuggestionLine } from "../fields/SuggestionLine";
import { fieldsErrorText, shouldReloadFields } from "../fields/errors";
import { VARIANT_SPEC, stationBlockTitle } from "../fields/fieldsBlockModel";
import { useFieldsState } from "../fields/useFieldsState";
import { useStationFields } from "../fields/useStationFields";
import {
  type TemplateRunState, buildTemplateDetails, emptyRunState, finishBlocker, routeFieldsSlot, stepBlocker, weightOutcome,
} from "./templateModel";

/**
 * A station's test popup built from its station type's template (docs/popup-templates/PLAN.md
 * §3, step 1.3): the same shell, SKU screen, photo uploader, instruction band and verdict card as
 * the code's popups (stationKit), assembled by the template's steps. The route's station fields
 * appear at the template's route_fields component, else before the verdict, exactly as in the
 * code's popups.
 *
 * TemplateStation fetches the template when it opens. A type whose template is gone meanwhile (404)
 * opens `fallback` — the popup the code gives the type — so the worker is never stuck.
 */
export default function TemplateStation(props: StationTestDialogProps & { fallback: React.ComponentType<StationTestDialogProps> }) {
  const { open, onClose, station, fallback: Fallback, ...rest } = props;
  const typeId = station.test_station_type_id;
  const [load, setLoad] = React.useState<
    { status: "loading" } | { status: "ready"; tpl: PopupTemplateJson } | { status: "none" } | { status: "error" }
  >({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoad({ status: "loading" });
    apiFetch(`/api/settings/popup-templates/${typeId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) { setLoad({ status: "none" }); return; }
        if (!res.ok) throw new Error(String(res.status));
        const tpl = (await res.json()) as PopupTemplateJson;
        if (!cancelled) setLoad({ status: "ready", tpl });
      })
      .catch(() => { if (!cancelled) setLoad({ status: "error" }); });
    return () => { cancelled = true; };
  }, [open, typeId, attempt]);

  if (load.status === "none") return <Fallback open={open} onClose={onClose} station={station} {...rest} />;
  if (load.status === "ready") return <TemplatePopup open={open} onClose={onClose} station={station} {...rest} template={load.tpl} />;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle onClose={onClose}>{station.test_station_desc}</DialogTitle>
      <DialogContent>
        {load.status === "loading" ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: "12px", py: 2 }} aria-busy="true">
            <CircularProgress size={20} aria-hidden />
            <Typography sx={{ fontSize: "var(--text-body)" }}>טוען את חלון הבדיקה…</Typography>
          </Box>
        ) : (
          <Alert severity="error">טעינת חלון הבדיקה נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
        )}
      </DialogContent>
      {load.status === "error" && (
        <DialogActions>
          <Button variant="text" onClick={onClose}>סגור</Button>
          <Button onClick={() => setAttempt((n) => n + 1)}>נסה שוב</Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

/** The popup itself, once the template is in. Exported for the settings screen's preview. */
export function TemplatePopup({
  open, onClose, item, station, stationTypeName, workerId, workerName, onSubmit, template,
}: StationTestDialogProps & { template: PopupTemplateJson }) {
  const cfg = template.config;
  const kind = stationTypeName?.trim() || "";
  const sku = skuScanOf(cfg);
  const [phaseIdx, setPhaseIdx] = React.useState(0);
  const [state, setState] = React.useState<TemplateRunState>(() => emptyRunState());
  const [refImages, setRefImages] = React.useState<Record<string, RefImg[]>>({});
  const [lookedUpFor, setLookedUpFor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  // ---- the route's station fields of this step (route-fields spec §4.2–§4.3) ----
  const sf = useStationFields(item.item_id, open, station.test_station_id);
  const ready = sf.status === "ready" && sf.mode === "item" ? sf : null;
  const fx = useFieldsState(ready ? ready.fields : []);
  const hasFields = ready != null && fx.defsCount > 0;
  const fieldsBlocking = sf.status === "loading" || sf.status === "error" || (hasFields && fx.blocking(ready.gate));
  const { reset: resetFields } = fx;
  const slot = routeFieldsSlot(cfg);

  React.useEffect(() => {
    if (!open) return;
    // The SKU carries on from the station before (ItemRow.last_sku) when the template says so.
    setPhaseIdx(0); setError(null); setRefImages({}); setLookedUpFor(null);
    setState(emptyRunState(sku?.carry_last ? item.last_sku ?? "" : ""));
    resetFields();
  }, [open, item, sku, resetFields]);

  const vars = { station: kind, sku: state.sku, model: item.model, serial: item.serial_no };
  const fill = (text: string) => fillVariables(text, vars);

  // ---- the reference lookup, after the SKU (when the template looks it up) ----
  const runLookup = React.useCallback(async () => {
    const scanned = state.sku.trim();
    if (!sku?.lookup_reference || !scanned || lookedUpFor === scanned) return;
    setBusy(true);
    try {
      const ru = await lookupRU(scanned, item.item_type_id);
      setState((s) => ({ ...s, hasRU: ru.hasRU, refWeight: ru.refWeight }));
      setRefImages(ru.imagesByType);
    } catch {
      setState((s) => ({ ...s, hasRU: false, refWeight: null }));
      setRefImages({});
    } finally {
      setLookedUpFor(scanned);
      setBusy(false);
    }
  }, [sku, state.sku, lookedUpFor, item.item_type_id]);

  // ---- photos: each component's shots go to storage tagged with its own group ----
  const { discard, landed } = useShotDiscard(workerId);
  const pickPhoto = (c: PhotoComponent, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    const patch = (fn: (shots: TemplateRunState["photos"][string]) => TemplateRunState["photos"][string]) =>
      setState((s) => ({ ...s, photos: { ...s.photos, [c.id]: fn(s.photos[c.id] ?? []) } }));
    patch((shots) => [...shots, { previewUrl, uploading: true }]);
    uploadItemFiles(item.item_id, [file], { workerId, stationTypeId: station.test_station_type_id, photoType: c.photo_code })
      .then(([result]) => result?.objectKey ?? null, () => null)
      .then((key) => {
        if (landed(item.item_id, previewUrl, key)) return;
        patch((shots) => shots.map((x) => (x.previewUrl === previewUrl ? { ...x, objectKey: key ?? undefined, uploading: false, failed: key == null } : x)));
      });
  };
  const removePhoto = (c: PhotoComponent, idx: number) => {
    discard(item.item_id, (state.photos[c.id] ?? [])[idx]);
    setState((s) => ({ ...s, photos: { ...s.photos, [c.id]: (s.photos[c.id] ?? []).filter((_, i) => i !== idx) } }));
  };
  const uploadFieldPhoto = React.useCallback<UploadFieldPhoto>(
    (file, photoType) => uploadItemFiles(item.item_id, [file], { workerId, stationTypeId: station.test_station_type_id, photoType })
      .then(([result]) => result?.objectKey ?? null, () => null),
    [item.item_id, workerId, station.test_station_type_id],
  );

  // ---- navigation ----
  const phases: ShellPhase[] = cfg.steps.map((st) => ({ key: st.id, title: fill(st.title), desc: fill(st.desc) }));
  const blockerOf = (i: number) => stepBlocker(cfg.steps[i], state, kind, fieldsBlocking && slot?.stepIndex === i);
  const go = async (to: number) => {
    setError(null);
    // Leaving the SKU step forward: the reference it names (images, weight) for the steps after.
    if (to > 0 && sku?.lookup_reference) await runLookup();
    setPhaseIdx(to);
  };
  const onNext = () => { void go(Math.min(phaseIdx + 1, cfg.steps.length - 1)); };
  const onBack = () => { setError(null); if (phaseIdx > 0) setPhaseIdx(phaseIdx - 1); };
  const onStep = (i: number) => {
    // Back always; forward only over steps that are done.
    if (i <= phaseIdx || Array.from({ length: i }, (_, k) => blockerOf(k)).every((b) => b == null)) void go(i);
  };

  const pass = state.verdict.ok === "pass";
  const finishBlocked = finishBlocker(cfg, state, kind, fieldsBlocking);

  const onFinish = async () => {
    if (workerId == null) { setError("יש לבחור עובד בכותרת מסך הבדיקות"); return; }
    if (finishBlocked) { setError(finishBlocked); return; }
    setSubmitting(true); setError(null);
    try {
      const data: TestResultData = {
        Result: pass ? 1 : 0, Passed: pass, Comments: state.verdict.note || undefined, WorkerID: workerId ?? undefined,
        Details: {
          ...buildTemplateDetails(cfg, { stationTypeId: station.test_station_type_id, version: template.version, station: kind }, state),
          // Station fields: schema + fields, and the verdict extended with suggested / overridden.
          ...(hasFields ? fx.toBlock(ready.schema, { ok: state.verdict.ok, note: state.verdict.note }) : {}),
        },
      };
      await onSubmit(data);
      onClose();
    } catch (e) {
      setError(fieldsErrorText(e, "שגיאה בשמירת הבדיקה"));
      if (shouldReloadFields(e)) sf.reload();
    } finally {
      setSubmitting(false);
    }
  };

  // ---- the body of the current step ----
  const step = cfg.steps[phaseIdx];
  const fieldsHere = slot?.stepIndex === phaseIdx;
  const fieldsBlock = hasFields ? (
    <FieldsBlock key="route-fields" variant="station" title={stationBlockTitle(kind)} groups={[{ fields: ready.fields }]} fx={fx} uploadPhoto={uploadFieldPhoto} />
  ) : (
    <FieldsBlockFallback key="route-fields" sf={sf} />
  );
  // The "no reference" warning heads a step whose components lean on the reference.
  const leansOnReference = step.components.some((c) => (c.kind === "photo" && c.show_reference) || c.kind === "weight");

  const renderComponent = (c: TemplateComponent): React.ReactNode => {
    switch (c.kind) {
      case "message":
        return <SystemNote key={c.id}>{fill(c.text)}</SystemNote>;
      case "photo":
        return (
          <PhotoSection key={c.id} title={fill(c.title)}>
            <PhotoUploader photos={state.photos[c.id] ?? []} refImages={c.show_reference ? refImages[c.photo_code] ?? [] : []}
              onPick={(f) => pickPhoto(c, f)} onRemove={(i) => removePhoto(c, i)} />
          </PhotoSection>
        );
      case "weight":
        return <WeightBlock key={c.id} c={c} refWeight={state.refWeight} value={state.weights[c.id] ?? ""}
          onChange={(v) => setState((s) => ({ ...s, weights: { ...s.weights, [c.id]: v } }))} />;
      case "route_fields":
        return fieldsHere ? fieldsBlock : null;
      case "verdict":
        return (
          <React.Fragment key={c.id}>
            {fieldsHere && slot?.atComponent === false && slot.componentId === c.id && fieldsBlock}
            <VerdictCard ok={state.verdict.ok} note={state.verdict.note} question={fill(c.question)}
              onOk={(v) => setState((s) => ({ ...s, verdict: { ...s.verdict, ok: v } }))}
              onNote={(v) => setState((s) => ({ ...s, verdict: { ...s.verdict, note: v } }))}
              suggestion={hasFields ? <SuggestionLine fails={fx.ev.fails} defs={ready.fields} prefix={SUGGEST_PREFIX} decided={state.verdict.ok} /> : undefined}
              noteMax={hasFields ? c.note_max : undefined} noteLook={VARIANT_SPEC.station.noteLook} />
          </React.Fragment>
        );
      default:
        return null;
    }
  };

  const isSkuStep = step.components.length === 1 && step.components[0].kind === "sku_scan";

  return (
    <StationShell
      open={open} onClose={onClose} item={item} workerId={workerId} workerName={workerName}
      contextLabel={kind || station.test_station_desc} stationName={station.test_station_desc} phases={phases} currentIndex={phaseIdx}
      onStep={onStep} onBack={onBack} error={error} onClearError={() => setError(null)}
      busy={busy} submitting={submitting}
      canNext={blockerOf(phaseIdx) == null} onNext={onNext}
      canFinish={finishBlocked == null} onFinish={onFinish} finishLabel={fill(cfg.finish_label)}
    >
      {isSkuStep ? (
        <SkuScreen value={state.sku} onChange={(v) => setState((s) => ({ ...s, sku: v }))}
          prev={sku?.carry_last ? item.last_sku : null} serial={item.serial_no} />
      ) : (
        <Stack spacing={3}>
          {leansOnReference && state.hasRU === false && <Alert severity="warning">{TEMPLATE_DEFAULTS.noReference}</Alert>}
          {step.components.map(renderComponent)}
        </Stack>
      )}
    </StationShell>
  );
}

/** "שקילה מול ייחוס": the measured weight, the reference weight, and the deviation against the
 *  allowed tolerance. */
function WeightBlock({ c, refWeight, value, onChange }: {
  c: WeightComponent; refWeight: number | null; value: string; onChange: (v: string) => void;
}) {
  const id = React.useId();
  const w = weightOutcome(c, refWeight, value);
  return (
    <Box sx={{ border: `1px solid ${HAIR}`, borderRadius: "var(--r-card)", p: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <Typography component="h3" sx={{ m: 0, fontSize: "var(--text-lead)", fontWeight: 700, color: INK }}>{COMPONENT_NAME.weight}</Typography>
      <TextField id={id} label="משקל נמדד (גר׳)" value={value} onChange={(e) => onChange(e.target.value)} placeholder="גר׳"
        inputProps={{ inputMode: "decimal", dir: "ltr", style: { textAlign: "right" } }} sx={{ maxWidth: 240 }} />
      <Typography sx={{ fontSize: "var(--text-body-sm)", color: MUTED, fontVariantNumeric: "tabular-nums" }}>
        {refWeight != null ? `משקל ייחוס: ${refWeight} גר׳ · סטייה מותרת ±${c.tolerance_pct}%` : "אין משקל ייחוס לפריט הזה"}
      </Typography>
      {w.diffPct != null && (
        <Typography role="status" sx={{ fontSize: "var(--text-body-sm)", fontWeight: 600, color: w.pass ? OK : BAD, fontVariantNumeric: "tabular-nums" }}>
          סטייה {w.diffPct.toFixed(1)}% · {w.pass ? "בטווח" : "מחוץ לטווח"}
        </Typography>
      )}
    </Box>
  );
}
