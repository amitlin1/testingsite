"use client";
import React from "react";
import { Check } from "lucide-react";
import type { StationTestDialogProps } from "@/types";
import type { PackageItemView, PackageView } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";
import { newActionId } from "@/app/lib/metrics/action-id";
import { fillVariables, skuScanOf } from "@/app/lib/popup-templates/schema";
import type { PopupTemplateJson } from "@/app/lib/popup-templates/schema";
import type { FieldsEvaluation } from "@/app/lib/station-fields/evaluate";
import { fieldsGateText, missLabel } from "@/app/lib/station-fields/labels";
import type { Field, FieldsSchemaRef } from "@/app/lib/station-fields/schema";
import { FieldsBlock, FieldsBlockFallback, PackFieldsBand, PackFieldsPending, PackItemFields } from "@/app/testing/fields/FieldsBlock";
import { shouldReloadFields } from "@/app/testing/fields/errors";
import { BLOCK_TITLE, draftsFieldsState, type DraftsFieldsState } from "@/app/testing/fields/fieldsBlockModel";
import { buildFieldsBlock, inputFieldCount, useFieldsState, type Drafts } from "@/app/testing/fields/useFieldsState";
import { findKitItem, kitItemDefs, useStationFields } from "@/app/testing/fields/useStationFields";
import PackageWizardShell, { type WizardStep } from "./PackageWizardShell";
import PackageDecisionDialog, { type PackDecision } from "./PackageDecisionDialog";
import { NextStationList, nextStopOf, type NextStop, type NextStopRow } from "./nextStation";
import { ScanField, useReferenceLookup } from "./referenceScan";
import { emptyRunState, routeFieldsSlot, stepBlocker, type TemplateRunState } from "./templateModel";
import { bandOf, buildClosingBoxDetails, closingNote, closingPasses, closingStepKind } from "./packageTemplateModel";
import {
  CHECKING, PACKAGE_POPUP_TEXT, PlainScan, StepComponents, WizardError, stepShots, useTemplatePhotos, type RunPatch, type Target,
} from "./packageTemplateParts";
import {
  AMBER_BG, AMBER_BORDER, AMBER_INK, BLUE, GREEN, HAIR, HAIR_2, INK, INK_2, MUTED, RED, RED_BG, seq2,
} from "@/app/components/packages/packageUi";
import "@/app/packages/packages.css";

/**
 * The box's closing run from its station type's template (docs/popup-templates/PLAN.md §5, step
 * 2.3): PackageCloseWizard's shell and parts — the label scan (starting from the one scanned at
 * the opening), the items and packing ("נארז", or a decision for an item that did not arrive), the
 * next stations — with the steps and the box's components taken from the template. A template made
 * "מהחלון של היום" (closingTemplate) runs exactly as the wizard.
 *
 * The arrival step is the wizard's own, kit items' station fields under their rows (artboard 17).
 * The box's fields appear where the template places them (artboard 18), and the step that holds
 * them waits for them. "סגור מארז" records one result per arrived item, then the box's, whose
 * details keep the wizard's keys (packageTemplateModel.ts) — all under one submit id.
 */

const CLOSE_TEXT = {
  title: "סגירת מארז",
  boxScanMissing: (type: string) => `לא נמצא פריט ייחוס של ${type} עם המק״ט הזה — בדוק שזו הקופסה הנכונה`,
  boxScanFilled: "הושלם מסריקת הפתיחה",
  arrivalSubtitle: "סמן כל פריט שנארז. פריט שלא הגיע דורש החלטה מפורשת.",
  needsDecision: "נדרשת החלטה לכל פריט",
  arrivalHold: "אי אפשר לאשר תקינות אריזה לפני שכל פריט סומן כנארז או קיבל החלטה מפורשת.",
  doneNext: "סיום וחזרה לתור",
} as const;

type Decision = { decision: PackDecision; note: string };

/** A kit item's station fields at this step: its definitions, its drafts' state, and whether its
 *  row shows them (artboard 17 `fieldsVisible`: it reached the station, or was packed anyway). */
type KitItemFieldsState = { defs: Field[]; fx: DraftsFieldsState; shown: boolean };

const NO_DRAFTS: Drafts = {};

/** Required fields and notes still missing over several field lists (never the same field twice). */
function countMissing(states: readonly { ev: Pick<FieldsEvaluation, "missingRequired" | "missingNotes"> }[]): { required: number; notes: number } {
  let required = 0;
  let notes = 0;
  for (const { ev } of states) {
    required += ev.missingRequired.length;
    notes += ev.missingNotes.length;
  }
  return { required, notes };
}

/** The next button's words for what is missing (artboards 17/18 `missLabel`), or null. */
function missText(m: { required: number; notes: number }): string | null {
  return m.required + m.notes > 0 ? missLabel(m.required, m.notes) : null;
}

export default function TemplatePackageClosing(props: StationTestDialogProps & { template: PopupTemplateJson }) {
  const pkg = props.item.package as PackageView | null;
  if (!props.open || !pkg) return null;
  return <ClosingPopup {...props} pkg={pkg} />;
}

/** Mounted per closing (the page renders a popup only while it is open), so the first state IS the
 *  fresh one. */
function ClosingPopup({
  open, onClose, item, station, stationTypeName, workerId, workerName, onSubmit, template, pkg,
}: StationTestDialogProps & { template: PopupTemplateJson; pkg: PackageView }) {
  const cfg = template.config;
  const kind = stationTypeName?.trim() || "";
  const boxSkuC = skuScanOf(cfg);

  const [step, setStep] = React.useState(0);
  // The scan starts from the label scanned when the box was opened, when the template says so.
  const [box, setBox] = React.useState<TemplateRunState>(() => emptyRunState(boxSkuC?.carry_last ? pkg.opening_sku ?? "" : ""));
  const [packed, setPacked] = React.useState<Record<string, boolean>>({});
  const [decisions, setDecisions] = React.useState<Record<string, Decision>>({});
  const [decideFor, setDecideFor] = React.useState<PackageItemView | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submitIdRef = React.useRef<string | null>(null);
  const committedRef = React.useRef<Set<string>>(new Set());
  // Each packed item's next station, from its own result's answer (kept across a retry of the
  // finish), and the done step's rows once the box's answer is in.
  const nextStopsRef = React.useRef<Map<string, NextStop>>(new Map());
  const [doneRows, setDoneRows] = React.useState<NextStopRow[]>([]);
  const uid = React.useId();

  // Station fields: the kit's answer (the popup opens on the box row → mode "package"), the box's
  // drafts, and each kit item's by item_id. The box's appear where the template places them.
  const sf = useStationFields(item.item_id, open, station.test_station_id);
  const kitFields = sf.status === "ready" && sf.mode === "package" ? sf : null;
  const boxFx = useFieldsState(kitFields ? kitFields.box : []);
  const [itemDrafts, setItemDrafts] = React.useState<Record<string, Drafts>>({});
  const boxSlot = routeFieldsSlot(cfg);

  const boxLookup = useReferenceLookup(box.sku, item.item_type_id, open && (boxSkuC?.lookup_reference ?? false));
  const boxHasRU = boxLookup.ref ? boxLookup.ref.hasRU : null;
  const { uploadTo, photosFor } = useTemplatePhotos(workerId, station.test_station_type_id);
  const patchBox: RunPatch = (fn) => setBox(fn);

  const items = pkg.items;
  const arrived = (it: PackageItemView) => it.arrived_at_closing;
  const resolved = (it: PackageItemView) => (arrived(it) ? packed[it.item_id] === true : decisions[it.item_id] != null);
  const allResolved = items.length > 0 && items.every(resolved);
  const anyMissing = items.some((it) => decisions[it.item_id]?.decision === "missing");

  // ---- station fields (artboards 17/18) ----------------------------------------
  const gate = kitFields?.gate ?? false;
  /** While the answer is still coming, or failed: the steps that show fields wait (spec §4.2). */
  const fieldsWaiting = sf.status === "loading" || sf.status === "error";
  /** Every field a kit item answers here ("לכל פריט", then its type's) — [] without a config. */
  const defsOf = (it: PackageItemView): Field[] => kitItemDefs(findKitItem(sf, it.item_id));
  const draftsOf = (it: PackageItemView): Drafts => itemDrafts[it.item_id] ?? NO_DRAFTS;
  const kitItemFields = new Map<string, KitItemFieldsState>();
  for (const it of items) {
    const defs = defsOf(it);
    if (inputFieldCount(defs) === 0) continue;
    const id = it.item_id;
    kitItemFields.set(id, {
      defs,
      fx: draftsFieldsState(defs, draftsOf(it), (next) => setItemDrafts((all) => ({ ...all, [id]: next(all[id] ?? NO_DRAFTS) }))),
      shown: arrived(it) || decisions[id]?.decision === "packed_anyway",
    });
  }
  const itemFieldsOn = kitItemFields.size > 0;
  const shownItemFields = Array.from(kitItemFields.values()).filter((f) => f.shown);
  /** The box's fields (artboard 18), when it has any and the template has a place for them. */
  const boxFields = kitFields && boxSlot && boxFx.defsCount > 0 ? kitFields.box : null;
  const itemsHold = fieldsWaiting || shownItemFields.some((f) => f.fx.blocking(gate));
  const boxHold = fieldsWaiting || (boxFields != null && boxFx.blocking(gate));
  const itemsMissText = gate ? missText(countMissing(shownItemFields.map((f) => f.fx))) : null;
  const boxMissText = gate && boxFields ? missText(countMissing([boxFx])) : null;

  /** What keeps a step from going on: its own blocker, then the fields it holds (their missing
   *  count names the button); CHECKING while something answers. */
  const stepHold = (i: number): string | null => {
    const st = cfg.steps[i];
    if (closingStepKind(st) === "arrival") {
      if (!allResolved) return CLOSE_TEXT.needsDecision;
      return itemsHold ? itemsMissText ?? CHECKING : null;
    }
    if (boxSkuC && st.components.includes(boxSkuC) && boxSkuC.lookup_reference && boxLookup.checking) return CHECKING;
    const own = stepBlocker(st, box, kind);
    if (own) return own;
    return boxSlot?.stepIndex === i && boxHold ? boxMissText ?? CHECKING : null;
  };

  // ---- the shell's texts and its next button -----------------------------------
  const lastStep = cfg.steps.length - 1;
  const doneStep = step > lastStep;
  const stepDef = doneStep ? null : cfg.steps[step];
  const fill = (text: string) => fillVariables(text, { station: kind, sku: box.sku, model: item.model, serial: item.serial_no });
  const finishLabel = fill(cfg.finish_label);
  const isScan = stepDef != null && boxSkuC != null && stepDef.components.length === 1 && stepDef.components[0] === boxSkuC;
  let stepSubtitle = "";
  let systemMsg: string | null = null;
  let nextLabel = CLOSE_TEXT.doneNext as string;
  let nextEnabled = true;
  if (stepDef) {
    const hold = stepHold(step);
    nextEnabled = hold == null;
    nextLabel = step === lastStep ? finishLabel : "המשך";
    if (closingStepKind(stepDef) === "arrival") {
      stepSubtitle = CLOSE_TEXT.arrivalSubtitle;
      if (hold && hold !== CHECKING) nextLabel = hold;
    } else {
      if (isScan) { stepSubtitle = PACKAGE_POPUP_TEXT.boxScanSubtitle; systemMsg = PACKAGE_POPUP_TEXT.boxScanBand; }
      else systemMsg = bandOf(stepDef, fill);
      // The box's fields name what is missing once the step's own parts are done (artboard 18).
      if (hold && hold === boxMissText) nextLabel = hold;
      if (stepShots(stepDef, box).some((s) => s.failed)) nextLabel = PACKAGE_POPUP_TEXT.removeFailedShot;
    }
  }

  const finish = async () => {
    for (let i = 0; i <= lastStep; i++) {
      const b = stepHold(i);
      if (b) { if (b !== CHECKING) setError(b); setStep(i); return; }
    }
    // Belt and braces for the steps' holds: nothing is sent while a shown field is missing (the
    // server's own 422 text) or a shot — a field's or a photo component's — is not stored yet.
    const shown = kitFields ? [...shownItemFields.map((f) => f.fx), ...(boxFields ? [boxFx] : [])] : [];
    const missing = countMissing(shown);
    const shots = [
      ...shown.flatMap((fx) => fx.photosPending.flatMap((id) => fx.drafts[id]?.photos ?? [])),
      ...Object.values(box.photos).flat().filter((s) => s.uploading || s.failed),
    ];
    const held = (gate ? fieldsGateText(missing.required, missing.notes) : null)
      ?? (shots.length === 0 ? null : shots.some((s) => s.failed) ? PACKAGE_POPUP_TEXT.photoFailed : PACKAGE_POPUP_TEXT.photoUploading);
    if (held) { setError(held); return; }
    setSubmitting(true); setError(null);
    const submitId = (submitIdRef.current ??= newActionId());
    // With a config every row answers it (D5): each arrived item as "kit_item" and the box as "box",
    // on the kit's route, version and step. Their verdict is { suggested } only — the worker's own
    // decision stays in Result / Passed, as today.
    const kitItemRef: FieldsSchemaRef | null = kitFields ? { ...kitFields.schema, target: "kit_item" } : null;
    const itemBlock = (it: PackageItemView, ref: FieldsSchemaRef) => buildFieldsBlock(defsOf(it), draftsOf(it), ref, {});
    /** An item packed anyway has no result row: its fields travel in its decision. */
    const decisionFields = (it: PackageItemView, ref: FieldsSchemaRef) => {
      const { fields, verdict } = itemBlock(it, ref);
      return { fields, suggested: verdict.suggested };
    };
    try {
      for (const it of items) {
        if (!arrived(it) || committedRef.current.has(it.item_id)) continue;
        const res = await apiFetch("/api/testing/results", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ItemID: Number(it.item_id), StationID: station.test_station_id, WorkerID: workerId ?? undefined, WorkerName: workerName || undefined, SubmitID: submitId,
            Result: 1, Passed: true,
            Details: { closing: true, packed: true, package_id: String(item.item_id), template: { v: template.version }, ...(kitItemRef ? itemBlock(it, kitItemRef) : {}) },
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          // 409 FIELDS_SCHEMA_MISMATCH: the fields changed while the popup was open — load them
          // again, whatever the last answer was; the drafts stay (by FieldId).
          if (shouldReloadFields(d)) sf.reload();
          throw new Error(`שמירת הפריט ${it.serial_no ?? seq2(it.package_seq)} נכשלה${d?.error ? ` — ${d.error}` : ` (${res.status})`}`);
        }
        nextStopsRef.current.set(it.item_id, nextStopOf(await res.json().catch(() => null)));
        committedRef.current.add(it.item_id);
      }
      const passed = closingPasses(cfg, box, anyMissing);
      const note = closingNote(cfg, box);
      const boxResult = await onSubmit({
        Result: passed ? 1 : 0, Passed: passed, Comments: note || undefined, WorkerID: workerId ?? undefined, SubmitID: submitId,
        Details: {
          ...buildClosingBoxDetails(cfg, { version: template.version, station: kind }, { ...box, hasRU: boxHasRU }, {
            packed: items.filter((it) => arrived(it) && packed[it.item_id]).map((it) => it.item_id),
            decisions: items.filter((it) => decisions[it.item_id]).map((it) => ({
              item_id: it.item_id, decision: decisions[it.item_id].decision, note: decisions[it.item_id].note,
              // Every "נארז בכל זאת" carries `fields` when the kit has a config, filled or not (D5);
              // "חסר במארז" carries none.
              ...(kitItemRef && decisions[it.item_id].decision === "packed_anyway" ? decisionFields(it, kitItemRef) : {}),
            })),
          }),
          ...(kitFields && boxSlot ? boxFx.toBlock({ ...kitFields.schema, target: "box" }, {}) : {}),
        },
      });
      // The closing is the last step of the box's route and of its items' (packages PLAN §4), so
      // this is normally one "no next station" line; a route drawn otherwise names its station.
      setDoneRows([
        { key: "box", badge: "00", label: pkg.item_type_desc, stop: nextStopOf(boxResult) },
        ...items.filter((it) => nextStopsRef.current.has(it.item_id)).map((it) => ({
          key: it.item_id, badge: seq2(it.package_seq), label: it.item_type_desc, stop: nextStopsRef.current.get(it.item_id)!,
        })),
      ]);
      setStep(lastStep + 1);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "שגיאה בשמירת סגירת המארז");
      if (shouldReloadFields(e)) sf.reload();
    } finally {
      setSubmitting(false);
    }
  };

  const onNext = () => {
    if (!nextEnabled || submitting) return;
    setError(null);
    if (doneStep) { onClose(); return; }
    if (step >= lastStep) { void finish(); return; }
    setStep(step + 1);
  };
  // The rail: back always; forward only over steps that are done.
  const onStep = (i: number) => {
    if (doneStep || submitting || i > lastStep) return;
    if (i <= step || Array.from({ length: i }, (_, k) => stepHold(k)).every((b) => b == null)) setStep(i);
  };

  const steps: WizardStep[] = [
    ...cfg.steps.map((st) => ({ key: st.id, label: fill(st.title), note: fill(st.desc) })),
    { key: "done", label: PACKAGE_POPUP_TEXT.doneStep, note: "" },
  ];

  const boxTarget = (i: number): Target => ({
    run: box, patch: patchBox, photos: photosFor(item.item_id, box, patchBox), fill,
    refImages: (code) => boxLookup.ref?.imagesByType[code] ?? [],
    noReference: boxHasRU === false ? PACKAGE_POPUP_TEXT.boxNoReference : null,
    fieldsHere: boxSlot?.stepIndex === i
      ? {
        atComponent: boxSlot.atComponent, componentId: boxSlot.componentId,
        // Artboard 18: the box's fields, before the packing checks in today's closing.
        block: (
          <React.Fragment key="route-fields">
            {fieldsWaiting && <FieldsBlockFallback sf={sf} />}
            {boxFields && <FieldsBlock variant="pack" title={BLOCK_TITLE.packing} groups={[{ fields: boxFields }]} fx={boxFx} idPrefix={`${uid}-fxbox`}
              uploadPhoto={(file, photoType) => uploadTo(item.item_id, file, photoType)} />}
          </React.Fragment>
        ),
      }
      : null,
    suggest: boxFields ? { fails: boxFx.ev.fails, defs: boxFields } : null,
    look: "pack", notesTitle: "הערות · הקופסה",
  });

  // ---- the body -----------------------------------------------------------------
  let body: React.ReactNode = null;
  if (stepDef && isScan && boxSkuC) {
    body = boxSkuC.lookup_reference ? (
      <ScanField
        label={PACKAGE_POPUP_TEXT.boxScanLabel} placeholder={PACKAGE_POPUP_TEXT.boxScanPlaceholder}
        value={box.sku} onChange={(v) => setBox((s) => ({ ...s, sku: v }))} lookup={boxLookup} onSubmit={onNext}
        found={(ref) => `זוהה ${pkg.item_type_desc}${ref.name ? ` · ${ref.name}` : ""} · ${items.length} פריטים · ${pkg.customer_name ?? pkg.customer_code ?? ""}`}
        missing={CLOSE_TEXT.boxScanMissing(pkg.item_type_desc)}
        prev={boxSkuC.carry_last ? pkg.opening_sku : undefined} filledNote={CLOSE_TEXT.boxScanFilled} />
    ) : (
      <PlainScan label={PACKAGE_POPUP_TEXT.boxScanLabel} placeholder={PACKAGE_POPUP_TEXT.boxScanPlaceholder}
        value={box.sku} onChange={(v) => setBox((s) => ({ ...s, sku: v }))} onSubmit={onNext} />
    );
  } else if (stepDef && closingStepKind(stepDef) === "arrival") {
    body = (
      <div style={{ marginTop: 20 }}>
        {fieldsWaiting && <div style={{ marginBottom: 14 }}><FieldsBlockFallback sf={sf} /></div>}
        <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, overflow: "hidden" }}>
          {itemFieldsOn && <PackFieldsBand title={BLOCK_TITLE.closing} count={shownItemFields.reduce((n, f) => n + inputFieldCount(f.defs), 0)} />}
          {items.map((it) => {
            const isArr = arrived(it);
            const d = decisions[it.item_id];
            const isPacked = packed[it.item_id] === true;
            const name = `${seq2(it.package_seq)} · ${it.item_type_desc}`;
            const row = (
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderBottom: `1px solid ${HAIR_2}`, background: isArr ? "var(--color-canvas)" : AMBER_BG, flexWrap: "wrap" }}>
                <span style={{ width: 34, height: 34, borderRadius: 9, background: isArr ? "var(--color-canvas-parchment)" : "color-mix(in srgb, var(--color-warning-ink) 10%, transparent)", color: isArr ? MUTED : AMBER_INK, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{seq2(it.package_seq)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{it.item_type_desc}</div>
                  <div style={{ fontSize: 12.5, color: isArr ? MUTED : AMBER_INK, marginTop: 2 }}>
                    {isArr ? `הגיע לסגירה · ${it.serial_no ?? "ללא סריאלי"}` : `לא הגיע · סיים את המסלול ${it.station_name ? `בעמדת ${it.station_name}` : "במקום אחר"}`}
                  </div>
                </div>
                {isArr ? (
                  // A real checkbox for the keyboard: Tab, then Space / Enter.
                  <button type="button" role="checkbox" aria-checked={isPacked} aria-label={`${name} · נארז`}
                    onClick={() => setPacked((p) => ({ ...p, [it.item_id]: !isPacked }))}
                    className="pkg-choice pkg-choice--soft pkg-press"
                    style={{ width: "auto", display: "flex", alignItems: "center", gap: 9, minHeight: 44, padding: "8px 14px", borderRadius: 11 }}>
                    <span aria-hidden className={isPacked ? "pkg-tick pkg-tick--on" : "pkg-tick"} style={{ width: 20, height: 20, borderRadius: 6, borderColor: isPacked ? undefined : "var(--color-field-border)" }}>{isPacked && <Check size={12} strokeWidth={2.5} />}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: isPacked ? BLUE : INK }}>נארז</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => setDecideFor(it)} aria-haspopup="dialog" aria-label={`${name} · ${d == null ? "נדרשת החלטה" : d.decision === "packed_anyway" ? "נארז בכל זאת" : "חסר במארז"}`}
                    className="pkg-pill pkg-pill--station"
                    style={{ background: d == null ? "var(--color-canvas)" : d.decision === "packed_anyway" ? "var(--color-primary-soft)" : RED_BG, color: d == null ? AMBER_INK : d.decision === "packed_anyway" ? BLUE : RED, borderColor: d == null ? AMBER_BORDER : d.decision === "packed_anyway" ? BLUE : "color-mix(in srgb, var(--color-destructive) 25%, transparent)", padding: "10px 18px" }}>
                    {d == null ? "נדרשת החלטה" : d.decision === "packed_anyway" ? "נארז בכל זאת" : "חסר במארז"}
                  </button>
                )}
              </div>
            );
            if (!itemFieldsOn) return <React.Fragment key={it.item_id}>{row}</React.Fragment>;
            // Artboard 17: the item's row, then its fields — or, while it waits for a decision, a
            // line that they come after it; "חסר במארז" has none.
            const f = kitItemFields.get(it.item_id);
            return (
              <div key={it.item_id} role="group" aria-label={name}>
                {row}
                {f && (f.shown
                  ? <PackItemFields fields={f.defs} fx={f.fx} uploadPhoto={(file, photoType) => uploadTo(it.item_id, file, photoType)} />
                  : d == null && <PackFieldsPending />)}
              </div>
            );
          })}
        </div>
        {!allResolved && (
          <div role="status" style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 11, padding: "11px 14px", marginTop: 14 }}>{CLOSE_TEXT.arrivalHold}</div>
        )}
      </div>
    );
  } else if (stepDef) {
    body = <StepComponents step={stepDef} t={boxTarget(step)} />;
  } else {
    body = (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "36px 0 8px" }}>
        <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--color-success-bg)", color: GREEN, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Check size={30} strokeWidth={2} aria-hidden /></span>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px", marginTop: 16 }}>המארז נסגר</div>
        <div style={{ fontSize: 14.5, color: INK_2, marginTop: 7, maxWidth: 440, lineHeight: 1.55 }}>המארז והפריטים שבו סומנו כנארזו. המארז עובר לסטטוס הושלם ומופיע במשלוח כמארז שסיים.</div>
        <div role="img" aria-label={items.map((it) => `${seq2(it.package_seq)} · ${it.item_type_desc} · ${decisions[it.item_id]?.decision === "missing" ? "חסר במארז" : "נארז"}`).join("; ")} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 20 }}>
          {items.map((it) => <span key={it.item_id} title={`${seq2(it.package_seq)} · ${it.item_type_desc}`} style={{ width: 30, height: 10, borderRadius: 3, background: decisions[it.item_id]?.decision === "missing" ? RED : GREEN }} />)}
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 9, fontVariantNumeric: "tabular-nums" }}>{items.filter((it) => decisions[it.item_id]?.decision !== "missing").length} פריטים נארזו · {pkg.item_type_desc}</div>
        <NextStationList rows={doneRows} />
      </div>
    );
  }

  return (
    <>
      <PackageWizardShell
        open={open} onClose={onClose}
        stationName={station.test_station_desc} stationCode={String(station.test_station_id)}
        title={CLOSE_TEXT.title} pkg={pkg} workerName={workerName}
        steps={steps} stepIndex={step} onStep={onStep}
        stepTitle={stepDef ? fill(stepDef.title) : PACKAGE_POPUP_TEXT.doneStep} stepSubtitle={stepSubtitle} stepCounter={`שלב ${step + 1} מתוך ${steps.length}`}
        systemMsg={systemMsg} footNote="הכל נשמר בזמן אמת"
        backDisabled={step === 0 || doneStep} onBack={() => { setError(null); if (step > 0 && !doneStep) setStep(step - 1); }}
        nextLabel={nextLabel} nextEnabled={nextEnabled} onNext={onNext} busy={submitting}
      >
        <WizardError error={error} />
        {body}
      </PackageWizardShell>

      {/* Mounted after the wizard, so it stacks above it and owns Escape while open. */}
      <PackageDecisionDialog
        open={decideFor != null}
        item={decideFor ? { item_id: decideFor.item_id, package_seq: decideFor.package_seq, item_type_desc: decideFor.item_type_desc, station_name: decideFor.station_name } : null}
        onClose={() => setDecideFor(null)}
        onSave={(decision, n) => { if (decideFor) setDecisions((d) => ({ ...d, [decideFor.item_id]: { decision, note: n } })); setDecideFor(null); }}
      />
    </>
  );
}
