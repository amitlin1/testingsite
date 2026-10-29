"use client";
import React from "react";
import { Check, CircleAlert } from "lucide-react";
import { uploadItemFiles } from "@/lib/api/direct-upload";
import type { ChecklistComponent, PhotoComponent, TemplateStep, WeightComponent } from "@/app/lib/popup-templates/schema";
import type { DraftShot, Drafts } from "@/app/lib/station-fields/evaluate";
import { SUGGEST_PREFIX } from "@/app/lib/station-fields/labels";
import type { Field } from "@/app/lib/station-fields/schema";
import { NotesField } from "@/app/testing/fields/NotesField";
import { SuggestionLine } from "@/app/testing/fields/SuggestionLine";
import { VARIANT_SPEC, noteEditorTitle, type DraftsFieldsState } from "@/app/testing/fields/fieldsBlockModel";
import { PhotoUploader, PassFail, useShotDiscard, type RefImg, type Shot } from "./stationKit";
import { weightOutcome, type TemplateRunState } from "./templateModel";
import {
  AMBER_BG, AMBER_BORDER, AMBER_INK, BLUE, GREEN, GREEN_BG, INK, INK_2, MUTED, RED, RED_BG,
} from "@/app/components/packages/packageUi";

/**
 * The parts the package base's popups share (TemplatePackageOpening, TemplatePackageClosing —
 * docs/popup-templates/PLAN.md §5): an admin's step drawn in the package wizards' markup, and
 * the shots its photo components take.
 */

export const PACKAGE_POPUP_TEXT = {
  notes: "הערות",
  optional: "אופציונלי",
  doneStep: "סיום",
  boxScanLabel: "מק״ט המארז",
  boxScanPlaceholder: "סרוק את מק״ט היצרן",
  boxScanSubtitle: "סרוק את מדבקת המארז כדי לפתוח את המארז בעמדה.",
  boxScanBand: "סריקת המארז פותחת את הבדיקה ורושמת את זמן ההתחלה.",
  boxNoReference: "לא נמצא פריט ייחוס למק״ט המארז שנסרק — צלם לפי שיקול דעת והמשך.",
  photoFailed: "יש צילום שההעלאה שלו נכשלה — הסר אותו וצלם שוב לפני הסיום.",
  photoUploading: "יש צילום שעדיין עולה — המתן לסיום ההעלאה.",
  removeFailedShot: "הסר את הצילום שנכשל",
} as const;

/** A step blocked only while something answers (a lookup, the fields): the next button waits, and
 *  no error is shown. */
export const CHECKING = "checking";

export type RunPatch = (fn: (s: TemplateRunState) => TemplateRunState) => void;

/** The shots taken in the photo fields among `defs` (station fields). */
export const fieldShots = (defs: readonly Field[], drafts: Readonly<Drafts>): DraftShot[] =>
  defs.flatMap((d) => (d.type === "photo" ? drafts[d.id]?.photos ?? [] : []));

/** The step's own shots (its photo components). */
export const stepShots = (st: TemplateStep, run: TemplateRunState): Shot[] =>
  st.components.flatMap((c) => (c.kind === "photo" ? run.photos[c.id] ?? [] : []));

/** A photo component's shots: added and removed on screen, stored on the box or an item. */
export type PhotoHandlers = { pick: (c: PhotoComponent, file: File) => void; remove: (c: PhotoComponent, idx: number) => void };

/**
 * Uploads (browser → MinIO, tagged by the photo component's group, or a field's photo type) and the
 * photo components' handlers for a run state. A shot removed on screen is taken back from storage
 * too (useShotDiscard).
 */
export function useTemplatePhotos(workerId: string | number | null | undefined, stationTypeId: number) {
  const uploadTo = React.useCallback(async (targetId: string | number, file: File, photoType: string): Promise<string | null> => {
    try {
      const [result] = await uploadItemFiles(targetId, [file], { workerId: workerId ?? undefined, stationTypeId, photoType });
      return result?.objectKey ?? null;
    } catch { return null; }
  }, [workerId, stationTypeId]);
  const { discard, landed } = useShotDiscard(workerId);
  const photosFor = (targetId: string | number, run: TemplateRunState, patch: RunPatch): PhotoHandlers => ({
    pick: (c, file) => {
      const previewUrl = URL.createObjectURL(file);
      const setShots = (fn: (shots: Shot[]) => Shot[]) => patch((s) => ({ ...s, photos: { ...s.photos, [c.id]: fn(s.photos[c.id] ?? []) } }));
      setShots((shots) => [...shots, { previewUrl, uploading: true }]);
      uploadTo(targetId, file, c.photo_code).then((key) => {
        if (landed(targetId, previewUrl, key)) return;
        setShots((shots) => shots.map((x) => (x.previewUrl === previewUrl ? { ...x, objectKey: key ?? undefined, uploading: false, failed: key == null } : x)));
      });
    },
    remove: (c, idx) => {
      discard(targetId, (run.photos[c.id] ?? [])[idx]);
      patch((s) => ({ ...s, photos: { ...s.photos, [c.id]: (s.photos[c.id] ?? []).filter((_, j) => j !== idx) } }));
    },
  });
  return { uploadTo, photosFor };
}

/** The route fields' suggestion, while there are fields. */
export type Suggest = { fails: DraftsFieldsState["ev"]["fails"]; defs: Field[] };

/** Who an admin's step works on: the box, or the item on screen in its flow. */
export type Target = {
  run: TemplateRunState;
  patch: RunPatch;
  photos: PhotoHandlers;
  fill: (text: string) => string;
  refImages: (code: string) => RefImg[];
  /** Heads a step whose photos lean on the reference when the lookup found none; null = it found one. */
  noReference: string | null;
  /** The route's fields block, drawn where the slot puts it in this step (null = not here), and the
   *  heading it shows (null while it draws none). */
  fieldsHere: { block: React.ReactNode; atComponent: boolean; componentId: string; title: string | null } | null;
  /** With fields: their suggestion under the verdict (or, without one, under the checklist that
   *  shares their step), and the notes as NotesFields. */
  suggest: Suggest | null;
  /** The wizard variant the fields and notes take (fieldsBlockModel VARIANT_SPEC). */
  look: "wizard" | "kit-item" | "pack";
  /** The verdict note's editor title. */
  notesTitle: string;
};

/** An admin's step: its components in order, in the package wizards' markup. sku_scan is a step of
 *  its own and message is the wizard's band, so neither draws here; nor do the system parts. */
export function StepComponents({ step, t }: { step: TemplateStep; t: Target }) {
  const uid = React.useId();
  const photoCount = step.components.filter((c) => c.kind === "photo").length;
  // Photos over reference images lean on the lookup; the weighing says its own "no reference".
  const leans = step.components.some((c) => c.kind === "photo" && c.show_reference);
  const hasVerdict = step.components.some((c) => c.kind === "verdict");
  const lastChecklist = step.components.filter((c) => c.kind === "checklist").pop();
  // A checklist titled as the fields block in its step goes without a heading of its own: today's
  // closing draws its checks under the packing block's "בדיקות האריזה" alone (artboard 18).
  const repeatsFieldsTitle = (title: string) => t.fieldsHere?.title != null && t.fieldsHere.title.trim() === title.trim();
  return (
    <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 18 }}>
      {leans && t.noReference && <AmberNote>{t.noReference}</AmberNote>}
      {step.components.map((c) => {
        switch (c.kind) {
          case "photo":
            return (
              <div key={c.id}>
                {/* A lone photo component is the step's own subject; several are told apart by their titles. */}
                {photoCount > 1 && <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>{t.fill(c.title)}</div>}
                <PhotoUploader photos={t.run.photos[c.id] ?? []} refImages={c.show_reference ? t.refImages(c.photo_code) : []}
                  onPick={(f) => t.photos.pick(c, f)} onRemove={(i) => t.photos.remove(c, i)} />
              </div>
            );
          case "route_fields":
            return t.fieldsHere?.atComponent ? <React.Fragment key={c.id}>{t.fieldsHere.block}</React.Fragment> : null;
          case "verdict":
            return (
              <React.Fragment key={c.id}>
                {t.fieldsHere && !t.fieldsHere.atComponent && t.fieldsHere.componentId === c.id && t.fieldsHere.block}
                <VerdictBlock question={t.fill(c.question)} verdict={t.run.verdict} suggest={t.suggest} look={t.look} notesTitle={t.notesTitle}
                  id={`${uid}-${c.id}`} onVerdict={(patch) => t.patch((s) => ({ ...s, verdict: { ...s.verdict, ...patch } }))} />
              </React.Fragment>
            );
          case "weight":
            return <WeighBlock key={c.id} c={c} refWeight={t.run.refWeight} value={t.run.weights[c.id] ?? ""} id={`${uid}-${c.id}`}
              onChange={(v) => t.patch((s) => ({ ...s, weights: { ...s.weights, [c.id]: v } }))} />;
          case "checklist":
            return (
              <div key={c.id}>
                <ChecklistBlock c={c} title={t.fill(c.title)} showTitle={!repeatsFieldsTitle(t.fill(c.title))} ticked={t.run.checks[c.id] ?? []}
                  onToggle={(rowId) => t.patch((s) => {
                    const cur = s.checks[c.id] ?? [];
                    return { ...s, checks: { ...s.checks, [c.id]: cur.includes(rowId) ? cur.filter((x) => x !== rowId) : [...cur, rowId] } };
                  })} />
                {/* Artboard 18: the packing's suggestion under its checks. */}
                {!hasVerdict && t.suggest && t.fieldsHere && c === lastChecklist && (
                  <SuggestionLine fails={t.suggest.fails} defs={t.suggest.defs} prefix={SUGGEST_PREFIX} size="12.5" style={{ marginTop: 9 }} />
                )}
              </div>
            );
          case "notes":
            return <NotesBlock key={c.id} label={t.fill(c.label)} id={`${uid}-${c.id}`} value={t.run.notes[c.id] ?? ""}
              withFields={t.suggest != null} look={t.look}
              onChange={(v) => t.patch((s) => ({ ...s, notes: { ...s.notes, [c.id]: v } }))} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/** A warning line in the wizards' markup. */
export function AmberNote({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "9px 13px" }}>{children}</div>;
}

/** The wizards' error band above the step. */
export function WizardError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "flex-start", background: RED_BG, border: "1px solid color-mix(in srgb, var(--color-destructive) 25%, transparent)", borderRadius: 10, padding: "11px 14px" }}>
      <span style={{ color: RED, marginTop: 1, display: "inline-flex" }}><CircleAlert size={16} strokeWidth={2} aria-hidden /></span>
      <div style={{ fontSize: 13, fontWeight: 600, color: RED }}>{error}</div>
    </div>
  );
}

/** "האריזה תקינה?" / "הפריט תקין?": the verdict, its suggestion, its note — the wizards' markup. */
export function VerdictBlock({ question, verdict, onVerdict, suggest, look, notesTitle, id }: {
  question: string; verdict: TemplateRunState["verdict"]; onVerdict: (patch: Partial<TemplateRunState["verdict"]>) => void;
  suggest: Suggest | null; look: Target["look"]; notesTitle: string; id: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>{question}</div>
      <div style={{ marginTop: 10 }}><PassFail value={verdict.ok} onChange={(v) => onVerdict({ ok: v })} /></div>
      {suggest && <SuggestionLine fails={suggest.fails} defs={suggest.defs} prefix={SUGGEST_PREFIX} decided={verdict.ok} style={{ marginTop: 10 }} />}
      <label htmlFor={id} style={{ display: "block", fontSize: 12.5, color: MUTED, margin: "16px 0 7px" }}>{PACKAGE_POPUP_TEXT.notes}</label>
      {suggest ? (
        <NotesField size="area" id={id} value={verdict.note} onChange={(note) => onVerdict({ note })}
          placeholder={PACKAGE_POPUP_TEXT.optional} editorTitle={notesTitle} look={VARIANT_SPEC[look].noteLook} />
      ) : (
        <textarea id={id} value={verdict.note} onChange={(e) => onVerdict({ note: e.target.value })} placeholder={PACKAGE_POPUP_TEXT.optional} className="pkg-field pkg-field--area" style={{ maxWidth: 560 }} />
      )}
    </div>
  );
}

/** A scan with no reference lookup: the field alone. */
export function PlainScan({ label, placeholder, value, onChange, onSubmit }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void; onSubmit: () => void;
}) {
  const id = React.useId();
  return (
    <div style={{ maxWidth: 420, marginTop: 20 }}>
      <label htmlFor={id} style={{ display: "block", fontSize: "var(--text-small)", color: MUTED, marginBottom: 7 }}>{label}</label>
      <input id={id} className="sh-input tst-ref-scan" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} autoFocus placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }} />
    </div>
  );
}

/** "שקילה מול ייחוס" in the opening wizard's markup: the reference weight, the measured one, the deviation. */
export function WeighBlock({ c, refWeight, value, id, onChange }: {
  c: WeightComponent; refWeight: number | null; value: string; id: string; onChange: (v: string) => void;
}) {
  const w = weightOutcome(c, refWeight, value);
  const diff = w.measured != null && refWeight != null ? w.measured - refWeight : null;
  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", maxWidth: 620 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>משקל פריט ייחוס</div>
          <div className="pkg-field pkg-field--lg pkg-field--static" style={{ fontVariantNumeric: "tabular-nums" }}>{refWeight != null ? `${refWeight} גר׳` : "לא מוגדר"}</div>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor={id} style={{ display: "block", fontSize: 12.5, color: MUTED, marginBottom: 7 }}>משקל פריט נבדק</label>
          {/* The focus ring, not the value, marks the field (A11-2); a weight reads left-to-right. */}
          <input id={id} dir="ltr" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="גר׳" inputMode="decimal"
            className="pkg-field pkg-field--lg pkg-field--code" />
        </div>
      </div>
      {w.diffPct != null && w.pass != null && diff != null && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11, background: w.pass ? GREEN_BG : RED_BG, border: `1px solid ${w.pass ? "color-mix(in srgb, var(--color-status-approved) 22%, transparent)" : "color-mix(in srgb, var(--color-destructive) 25%, transparent)"}`, borderRadius: 11, padding: "13px 15px", marginTop: 16, maxWidth: 620 }}>
          {/* ✓ only when it passes; out of tolerance gets the alert mark. */}
          <span style={{ color: w.pass ? GREEN : RED, marginTop: 1, display: "inline-flex" }}>{w.pass ? <Check size={18} strokeWidth={2} aria-hidden /> : <CircleAlert size={18} strokeWidth={2} aria-hidden />}</span>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: w.pass ? GREEN : RED }}>{w.pass ? "משקל תקין" : "משקל לא תקין"}</div>
            <div style={{ fontSize: 13, color: INK_2, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>סטייה {diff >= 0 ? "+" : "−"}{Math.abs(diff).toFixed(0)} גר׳ ({w.diffPct.toFixed(1)}% · סטייה תקנית ±{c.tolerance_pct}%)</div>
          </div>
        </div>
      )}
      {refWeight == null && value !== "" && <div style={{ marginTop: 16, fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "9px 13px", maxWidth: 620 }}>אין משקל ייחוס לסוג פריט זה — המשקל נרשם ללא השוואה.</div>}
    </div>
  );
}

/** "רשימת סימון" in the closing wizard's markup: every row a tick. `showTitle` false: the title
 *  names the group for screen readers only. */
export function ChecklistBlock({ c, title, showTitle = true, ticked, onToggle }: {
  c: ChecklistComponent; title: string; showTitle?: boolean; ticked: string[]; onToggle: (rowId: string) => void;
}) {
  return (
    <div style={{ maxWidth: 620 }}>
      {showTitle && <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>{title}</div>}
      <div role="group" aria-label={title} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {c.items.map((row) => {
          const on = ticked.includes(row.id);
          return (
            <button key={row.id} type="button" role="checkbox" aria-checked={on} onClick={() => onToggle(row.id)}
              className="pkg-choice pkg-press" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, borderRadius: 12, padding: "13px 15px" }}>
              <span aria-hidden className={on ? "pkg-tick pkg-tick--on" : "pkg-tick"} style={{ width: 22, height: 22, borderRadius: 7, borderColor: on ? undefined : "var(--color-field-border)" }}>{on && <Check size={13} strokeWidth={2.5} />}</span>
              <span style={{ fontSize: 14.5, fontWeight: 600, color: on ? BLUE : INK }}>{row.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "הערות": a free-text note under its label — a NotesField while the step's popup has fields
 *  (artboard 18 `pk`: the packing note), a plain textarea otherwise. */
export function NotesBlock({ label, id, value, onChange, withFields, look }: {
  label: string; id: string; value: string; onChange: (v: string) => void; withFields: boolean; look: Target["look"];
}) {
  return (
    <div style={{ maxWidth: 620 }}>
      <label htmlFor={id} style={{ display: "block", fontSize: 12.5, color: MUTED, marginBottom: 7 }}>{label}</label>
      {withFields ? (
        <NotesField size={look === "pack" ? "pack" : "area"} id={id} value={value} onChange={onChange} placeholder={PACKAGE_POPUP_TEXT.optional}
          editorTitle={noteEditorTitle(label)} look={VARIANT_SPEC[look].noteLook} />
      ) : (
        <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={PACKAGE_POPUP_TEXT.optional} className="pkg-field pkg-field--area" />
      )}
    </div>
  );
}
