"use client";
import React from "react";
import { Check, CircleAlert } from "lucide-react";
import type { StationTestDialogProps } from "@/types";
import type { PackageItemView, PackageView } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";
import { uploadItemFiles } from "@/lib/api/direct-upload";
import { newActionId } from "@/app/lib/metrics/action-id";
import type { FieldsEvaluation } from "@/app/lib/station-fields/evaluate";
import { SUGGEST_PREFIX, fieldsGateText, missLabel } from "@/app/lib/station-fields/labels";
import type { Field, FieldsSchemaRef } from "@/app/lib/station-fields/schema";
import { FieldsBlock, FieldsBlockFallback, PackFieldsBand, PackFieldsPending, PackItemFields } from "@/app/testing/fields/FieldsBlock";
import type { UploadFieldPhoto } from "@/app/testing/fields/FieldRow";
import { NotesField } from "@/app/testing/fields/NotesField";
import { SuggestionLine } from "@/app/testing/fields/SuggestionLine";
import { shouldReloadFields } from "@/app/testing/fields/errors";
import { BLOCK_TITLE, VARIANT_SPEC, draftsFieldsState, noteEditorTitle, type DraftsFieldsState } from "@/app/testing/fields/fieldsBlockModel";
import { buildFieldsBlock, inputFieldCount, useFieldsState, type Drafts } from "@/app/testing/fields/useFieldsState";
import { findKitItem, kitItemDefs, useStationFields } from "@/app/testing/fields/useStationFields";
import PackageWizardShell, { type WizardStep } from "./PackageWizardShell";
import PackageDecisionDialog, { type PackDecision } from "./PackageDecisionDialog";
import { NextStationList, nextStopOf, type NextStop, type NextStopRow } from "./nextStation";
import { ScanField, useReferenceLookup } from "./referenceScan";
import {
  AMBER_BG, AMBER_BORDER, AMBER_INK, BLUE, GREEN, HAIR, HAIR_2, INK, INK_2, MUTED, RED, RED_BG, seq2,
} from "@/app/components/packages/packageUi";
import "@/app/packages/packages.css";

/**
 * אשף סגירת מארז — design/Package Stations.dc.html (close). Runs on a
 * package-level closing station for a PACKAGE row. Four steps: scan → items
 * and packing (arrived → "נארז"; not arrived → an explicit decision with a
 * note) → packing checks → done. "סגור מארז" records one result per arrived
 * item and then the box's, whose details carry the decisions
 * (docs/packages/PLAN.md §4, decision 5; DESIGN_REVIEW.md).
 *
 * The scan starts from the label scanned when the box was opened
 * (pkg.opening_sku) and, like the opening, is looked up among the package
 * type's reference items; the worker may rescan it.
 *
 * Station fields (route-fields spec §4.11.4–§4.11.5, D5): when the kit's
 * route has a published config for this step, each kit item's fields nest
 * under its row in the kit card (artboard 17) and the box's sit before the
 * packing checks (artboard 18); they hold those steps' next button, and the
 * results carry them. Without a config the wizard is exactly as before.
 */

const STEPS: WizardStep[] = [
  { key: "scan", label: "סריקת מק״ט המארז", note: "מדבקת המארז" },
  { key: "arrival", label: "פריטים ואריזה", note: "מצב הגעה + נארז" },
  { key: "packOk", label: "תקינות האריזה", note: "אישור סופי" },
  { key: "done", label: "סיום", note: "" },
];

const CHECKS = ["כל הפריטים שסומנו נמצאים בקופסה", "האריזה סגורה ותקינה", "מדבקת המארז קריאה"];
/** The packing note's label; with station fields, also its editor's title (artboard 18 `pk`). */
const PACK_NOTE_LABEL = "הערות אריזה";
/** A field photo not stored yet when the box is closed — the opening wizard's words. */
const PHOTO_FAILED = "יש צילום שההעלאה שלו נכשלה — הסר אותו וצלם שוב לפני הסיום.";
const PHOTO_UPLOADING = "יש צילום שעדיין עולה — המתן לסיום ההעלאה.";

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

export default function PackageCloseWizard({ open, onClose, item, station, workerId, workerName, onSubmit }: StationTestDialogProps) {
  const pkg = item.package as PackageView | null;
  const [step, setStep] = React.useState(0);
  const [scan, setScan] = React.useState("");
  const [packed, setPacked] = React.useState<Record<string, boolean>>({});
  const [decisions, setDecisions] = React.useState<Record<string, Decision>>({});
  const [decideFor, setDecideFor] = React.useState<PackageItemView | null>(null);
  const [checks, setChecks] = React.useState<boolean[]>(CHECKS.map(() => false));
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submitIdRef = React.useRef<string | null>(null);
  const committedRef = React.useRef<Set<string>>(new Set());
  // Each packed item's next station, from its own result's answer (kept across a retry of "סגור
  // מארז"), and the done step's rows once the box's answer is in.
  const nextStopsRef = React.useRef<Map<string, NextStop>>(new Map());
  const [doneRows, setDoneRows] = React.useState<NextStopRow[]>([]);
  const noteId = React.useId();

  // Station fields: the kit's answer (the popup opens on the box row → mode "package"), the box's
  // drafts, and each kit item's by item_id.
  const sf = useStationFields(item.item_id, open, station.test_station_id);
  const kitFields = sf.status === "ready" && sf.mode === "package" ? sf : null;
  const boxFx = useFieldsState(kitFields ? kitFields.box : []);
  const { reset: resetBoxFields } = boxFx;
  const [itemDrafts, setItemDrafts] = React.useState<Record<string, Drafts>>({});

  // The state resets during render, when the dialog opens or the box changes;
  // the refs follow in the effect below.
  const [openedFor, setOpenedFor] = React.useState<{ open: boolean; pkg: PackageView | null } | null>(null);
  if (!openedFor || openedFor.open !== open || openedFor.pkg !== pkg) {
    setOpenedFor({ open, pkg });
    if (open) {
      setStep(0); setScan(pkg?.opening_sku ?? ""); setPacked({}); setDecisions({}); setDecideFor(null); setChecks(CHECKS.map(() => false)); setNote("");
      setSubmitting(false); setError(null); setDoneRows([]);
      setItemDrafts({}); resetBoxFields();
    }
  }
  React.useEffect(() => {
    if (!open) return;
    submitIdRef.current = null; committedRef.current = new Set();
    nextStopsRef.current = new Map();
  }, [open, pkg]);

  const boxLookup = useReferenceLookup(scan, item.item_type_id, open);

  if (!open || !pkg) return null;

  const items = pkg.items;
  const arrived = (it: PackageItemView) => it.arrived_at_closing;
  const resolved = (it: PackageItemView) => (arrived(it) ? packed[it.item_id] === true : decisions[it.item_id] != null);
  const allResolved = items.length > 0 && items.every(resolved);
  const checksAll = checks.every(Boolean);
  const stepKey = STEPS[step].key;
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
  /** The box's fields (artboard 18), when it has any. */
  const boxFields = kitFields && boxFx.defsCount > 0 ? kitFields.box : null;
  // Each step that shows fields holds its next button while they block (evaluate.ts
  // fieldsBlocking); the button then names what is missing.
  const itemsHold = fieldsWaiting || shownItemFields.some((f) => f.fx.blocking(gate));
  const boxHold = fieldsWaiting || (boxFields != null && boxFx.blocking(gate));
  const itemsMissText = gate ? missText(countMissing(shownItemFields.map((f) => f.fx))) : null;
  const boxMissText = gate && boxFields ? missText(countMissing([boxFx])) : null;
  /** A photo field's shot, stored on `targetId` (a kit item, or the box) as the opening wizard does. */
  const uploadTo = (targetId: string | number): UploadFieldPhoto => async (file, photoType) => {
    try {
      const [result] = await uploadItemFiles(targetId, [file], { workerId, stationTypeId: station.test_station_type_id, photoType });
      return result?.objectKey ?? null;
    } catch { return null; }
  };

  let stepSubtitle = "";
  let systemMsg: string | null = null;
  if (stepKey === "scan") { stepSubtitle = "סרוק את מדבקת המארז כדי לפתוח את המארז בעמדה."; systemMsg = "סריקת המארז פותחת את הבדיקה ורושמת את זמן ההתחלה."; }
  else if (stepKey === "arrival") stepSubtitle = "סמן כל פריט שנארז. פריט שלא הגיע דורש החלטה מפורשת.";
  else if (stepKey === "packOk") stepSubtitle = "אישור סופי לפני סגירת המארז.";

  let nextLabel = "המשך";
  let nextEnabled = true;
  if (stepKey === "scan") nextEnabled = scan.trim() !== "" && !boxLookup.checking;
  else if (stepKey === "arrival") {
    nextEnabled = allResolved; nextLabel = allResolved ? "המשך" : "נדרשת החלטה לכל פריט";
    // Then the fields of the items that show them (artboard 17).
    if (allResolved && itemsHold) { nextEnabled = false; nextLabel = itemsMissText ?? nextLabel; }
  }
  else if (stepKey === "packOk") {
    nextEnabled = checksAll; nextLabel = "סגור מארז";
    // Then the box's fields (artboard 18).
    if (checksAll && boxHold) { nextEnabled = false; nextLabel = boxMissText ?? nextLabel; }
  }
  else if (stepKey === "done") nextLabel = "סיום וחזרה לתור";

  const finish = async () => {
    // Belt and braces for the steps' holds, which the rail can skip: nothing is sent while a shown
    // field is missing (the server's own 422 text) or one of their photos is not stored yet.
    if (kitFields) {
      const shown = [...shownItemFields.map((f) => f.fx), ...(boxFields ? [boxFx] : [])];
      const missing = countMissing(shown);
      const shots = shown.flatMap((fx) => fx.photosPending.flatMap((id) => fx.drafts[id]?.photos ?? []));
      const held = (gate ? fieldsGateText(missing.required, missing.notes) : null)
        ?? (shots.length === 0 ? null : shots.some((s) => s.failed) ? PHOTO_FAILED : PHOTO_UPLOADING);
      if (held) { setError(held); return; }
    }
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
            Result: 1, Passed: true, Details: { closing: true, packed: true, package_id: String(item.item_id), ...(kitItemRef ? itemBlock(it, kitItemRef) : {}) },
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          // 409 FIELDS_SCHEMA_MISMATCH: the fields changed while the wizard was open — load them
          // again, whatever the last answer was; the drafts stay (by FieldId).
          if (shouldReloadFields(d)) sf.reload();
          throw new Error(`שמירת הפריט ${it.serial_no ?? seq2(it.package_seq)} נכשלה${d?.error ? ` — ${d.error}` : ` (${res.status})`}`);
        }
        nextStopsRef.current.set(it.item_id, nextStopOf(await res.json().catch(() => null)));
        committedRef.current.add(it.item_id);
      }
      const boxResult = await onSubmit({
        Result: anyMissing ? 0 : 1, Passed: !anyMissing, Comments: note || undefined, WorkerID: workerId ?? undefined, SubmitID: submitId,
        Details: {
          sku: scan.trim(), hasRU: boxLookup.ref?.hasRU ?? null, closing: true, checks: CHECKS.map((label, i) => ({ label, ok: checks[i] })), note,
          packed: items.filter((it) => arrived(it) && packed[it.item_id]).map((it) => it.item_id),
          decisions: items.filter((it) => decisions[it.item_id]).map((it) => ({
            item_id: it.item_id, decision: decisions[it.item_id].decision, note: decisions[it.item_id].note,
            // Every "נארז בכל זאת" carries `fields` when the kit has a config, filled or not (D5);
            // "חסר במארז" carries none.
            ...(kitItemRef && decisions[it.item_id].decision === "packed_anyway" ? decisionFields(it, kitItemRef) : {}),
          })),
          ...(kitFields ? boxFx.toBlock({ ...kitFields.schema, target: "box" }, {}) : {}),
        },
      });
      // The closing is the last step of the box's route and of its items' (PLAN §4), so this
      // is normally one "no next station" line; a route drawn otherwise names its station.
      setDoneRows([
        { key: "box", badge: "00", label: pkg.item_type_desc, stop: nextStopOf(boxResult) },
        ...items.filter((it) => nextStopsRef.current.has(it.item_id)).map((it) => ({
          key: it.item_id, badge: seq2(it.package_seq), label: it.item_type_desc, stop: nextStopsRef.current.get(it.item_id)!,
        })),
      ]);
      setStep(STEPS.length - 1);
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
    if (stepKey === "packOk") { finish(); return; }
    if (stepKey === "done") { onClose(); return; }
    setStep((s) => s + 1);
  };
  const doneStep = stepKey === "done";

  return (
    <>
      <PackageWizardShell
        open={open} onClose={onClose}
        stationName={station.test_station_desc} stationCode={String(station.test_station_id)}
        title="סגירת מארז" pkg={pkg} workerName={workerName}
        steps={STEPS} stepIndex={step} onStep={(i) => { if (!doneStep && !submitting && i < STEPS.length - 1) setStep(i); }}
        stepTitle={STEPS[step].label} stepSubtitle={stepSubtitle} stepCounter={`שלב ${step + 1} מתוך ${STEPS.length}`}
        systemMsg={systemMsg} footNote="הכל נשמר בזמן אמת"
        backDisabled={step === 0 || doneStep} onBack={() => { setError(null); if (step > 0 && !doneStep) setStep((s) => s - 1); }}
        nextLabel={nextLabel} nextEnabled={nextEnabled} onNext={onNext} busy={submitting}
      >
        {error && (
          <div role="alert" style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "flex-start", background: RED_BG, border: "1px solid color-mix(in srgb, var(--color-destructive) 25%, transparent)", borderRadius: 10, padding: "11px 14px" }}>
            <span style={{ color: RED, marginTop: 1, display: "inline-flex" }}><CircleAlert size={16} strokeWidth={2} aria-hidden /></span>
            <div style={{ fontSize: 13, fontWeight: 600, color: RED }}>{error}</div>
          </div>
        )}

        {stepKey === "scan" && (
          <ScanField
            label="מק״ט המארז" placeholder="סרוק את מק״ט היצרן"
            value={scan} onChange={setScan} lookup={boxLookup} onSubmit={onNext}
            found={(ref) => `זוהה ${pkg.item_type_desc}${ref.name ? ` · ${ref.name}` : ""} · ${items.length} פריטים · ${pkg.customer_name ?? pkg.customer_code ?? ""}`}
            missing={`לא נמצא פריט ייחוס של ${pkg.item_type_desc} עם המק״ט הזה — בדוק שזו הקופסה הנכונה`}
            prev={pkg.opening_sku} filledNote="הושלם מסריקת הפתיחה" />
        )}

        {stepKey === "arrival" && (
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
                // Artboard 17: the item's row, then its fields — or, while it waits for a decision,
                // a line that they come after it; "חסר במארז" has none.
                const f = kitItemFields.get(it.item_id);
                return (
                  <div key={it.item_id} role="group" aria-label={name}>
                    {row}
                    {f && (f.shown
                      ? <PackItemFields fields={f.defs} fx={f.fx} uploadPhoto={uploadTo(it.item_id)} />
                      : d == null && <PackFieldsPending />)}
                  </div>
                );
              })}
            </div>
            {!allResolved && (
              <div role="status" style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 11, padding: "11px 14px", marginTop: 14 }}>אי אפשר לאשר תקינות אריזה לפני שכל פריט סומן כנארז או קיבל החלטה מפורשת.</div>
            )}
          </div>
        )}

        {stepKey === "packOk" && (
          <div style={{ maxWidth: 620, marginTop: 20 }}>
            {fieldsWaiting && <div style={{ marginBottom: 26 }}><FieldsBlockFallback sf={sf} /></div>}
            {/* Artboard 18: the box's fields before the packing checks. */}
            {boxFields && (
              <FieldsBlock variant="pack" title={BLOCK_TITLE.packing} groups={[{ fields: boxFields }]} fx={boxFx} uploadPhoto={uploadTo(item.item_id)} />
            )}
            <div role="group" aria-label="תקינות האריזה" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {CHECKS.map((label, i) => {
                const on = checks[i];
                return (
                  <button key={label} type="button" role="checkbox" aria-checked={on} onClick={() => setChecks((c) => c.map((v, j) => (j === i ? !v : v)))}
                    className="pkg-choice pkg-press" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, borderRadius: 12, padding: "13px 15px" }}>
                    <span aria-hidden className={on ? "pkg-tick pkg-tick--on" : "pkg-tick"} style={{ width: 22, height: 22, borderRadius: 7, borderColor: on ? undefined : "var(--color-field-border)" }}>{on && <Check size={13} strokeWidth={2.5} />}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: on ? BLUE : INK }}>{label}</span>
                  </button>
                );
              })}
            </div>
            {boxFields && <SuggestionLine fails={boxFx.ev.fails} defs={boxFields} prefix={SUGGEST_PREFIX} size="12.5" style={{ marginTop: 9 }} />}
            <label htmlFor={noteId} style={{ display: "block", fontSize: 12.5, color: MUTED, margin: "18px 0 7px" }}>{PACK_NOTE_LABEL}</label>
            {boxFields ? (
              // Artboard 18 `pk`: the column's full width, three lines growing to six.
              <NotesField size="pack" id={noteId} value={note} onChange={setNote} placeholder="אופציונלי" editorTitle={noteEditorTitle(PACK_NOTE_LABEL)}
                look={VARIANT_SPEC.pack.noteLook} />
            ) : (
              <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} placeholder="אופציונלי" className="pkg-field pkg-field--area" />
            )}
          </div>
        )}

        {stepKey === "done" && (
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
        )}
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
