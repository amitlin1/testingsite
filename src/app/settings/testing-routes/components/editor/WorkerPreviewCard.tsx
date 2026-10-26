"use client";
import * as React from "react";
import Link from "next/link";
import { CircleCheck, ClipboardCheck, Info, LayoutTemplate } from "lucide-react";
import { Button, Tag } from "@/components/ui";
import { GATE_FINISH_ON_REQUIRED } from "@/app/lib/station-fields/evaluate";
import { SUGGEST_PREFIX_DIALOG, statusA } from "@/app/lib/station-fields/labels";
import type { Field, FieldId } from "@/app/lib/station-fields/schema";
import { FieldRow } from "@/app/testing/fields/FieldRow";
import { SuggestionLine } from "@/app/testing/fields/SuggestionLine";
import {
  BLOCK_TEXT, BLOCK_TITLE, blockItems, blockStatus, draftsFieldsState, fieldCountText, fieldRowIds, rowState, statusRuns,
  type FieldRowVariant,
} from "@/app/testing/fields/fieldsBlockModel";
import { inputFieldCount, type Drafts, type FieldDraft } from "@/app/testing/fields/useFieldsState";
import {
  EDITOR_UNDRAWN_TEXT, PREVIEW_UNDRAWN_TEXT, PREVIEW_SAMPLE, PREVIEW_TEXT, previewStepText, previewSubText, stationFinishText,
} from "../../lib/labels";
import type { PackageWizard } from "../../lib/editorModel";
// PassFail's looks live in the testing page's stylesheet (stationKit: "Stateful styling … lives in
// ../testing.css"), which only that page imports. Every rule in it is a tst-* class.
import "@/app/testing/testing.css";
import "./preview.css";

/**
 * "תצוגת העובד · חי" — the live worker preview beside the station field editor (route-fields spec
 * §5.5.3, §5.8; artboard 2's right column).
 *
 * It follows the popup the station really opens (spec §10.3; mainPopUp.ts getStartTestDialog),
 * which the editor passes as `popupKind`:
 * - "verdict" / "photo" (VerdictStation / PhotoStation): artboard 2's frame — "בדיקות העמדה",
 *   "{station} · {item} · {N} שדות", "שלב {i} מתוך {n}", the system note "נא לבדוק עפ״י תכנית
 *   {sku}", the rows, and the finish "סיום בדיקת {station type}" as those wizards word it.
 * - "dialog" (PopUpTestDialog): artboard 14's block — its header (title, count, "מהגדרות המסלול",
 *   status ג), the rows, and its suggestion line closing them; the finish is "שמור וסיים". No step,
 *   no system note, no "בדיקה תקינה?".
 * - "package" (the package wizards): artboard 2's frame without the scan step's parts (the step and
 *   the system note); the finish is undrawn. The rows take the opening wizard's variant, or —
 *   `packageWizard` "close", the kit's closing step — the closing wizard's compact pick-only one
 *   (artboards 17/18).
 *
 * The card is as tall as the settings frame shows at most (preview.css) and scrolls inside, so its
 * mini footer stays reachable beside a long editor.
 *
 * The rows are the worker's own components — FieldRow (ChoiceAutocomplete, NumberField, PassFail,
 * NotesField …) with the popup's variant, so their states (a fail value, "הערה · חובה", "יש לפרט את
 * החריגה", the range line, a folded note, the counter) are the popups' own; preview.css only sets
 * them in the preview's denser metrics. Unlike FieldsBlock, the frame is artboard 2's, so the card
 * lays the rows out itself (blockItems / rowState, as FieldsBlock does).
 *
 * Values are local and never saved — no photo is uploaded either (a shot reads failed). They
 * follow `fields` by FieldId: an edit keeps every value, a removed field loses its own.
 * The mini footer counts what is still missing, as artboard 2 does (a field without its value or
 * without its required note, once each), and its finish button is aria-disabled until nothing is;
 * it never submits.
 *
 * Not built: the header's ghost "פתח בחלון מלא" (Maximize2) — it opens the station's real popup in
 * a preview mode, which is later work.
 */

/** The popup the station opens (the editor's popupKindOf). */
export type PreviewPopupKind = "verdict" | "photo" | "dialog" | "package" | "template";

export type WorkerPreviewCardProps = {
  /** The station's name ({station} of "{station} · {item} · {N} שדות"). */
  stationLabel: string;
  /** The row's name — "מחשב", "הקופסה", "כל פריט במארז" … ({item}). */
  rowLabel: string;
  /** "שלב {stepIndex} מתוך {stepCount}": 1-based, the map column's place (MapColumn.n). */
  stepIndex: number;
  stepCount: number;
  /** The cell's fields as the editor holds them now (the working copy). */
  fields: readonly Field[];
  popupKind: PreviewPopupKind;
  /** test_stations_type.test_type_desc — "סיום בדיקת {name}" in VerdictStation / PhotoStation. */
  stationTypeName: string;
  /** popupKind "package": which wizard the step opens (the editor's packageWizardAt — the kit
   *  route's last step closes the kit). Without it, the opening wizard's rows. */
  packageWizard?: PackageWizard;
  /** popupKind "template": the station type, for the link to its template. */
  stationTypeId?: number;
};

/** The variant whose behaviour the rows take (fieldsBlockModel VARIANT_SPEC): artboard 12, 13, 14,
 *  and the opening wizard's for a package-level station (artboard 15/16). */
const ROW_VARIANT: Record<PreviewPopupKind, FieldRowVariant> = {
  verdict: "station",
  photo: "photo",
  dialog: "dialog",
  package: "wizard",
  // A template popup draws its route fields as the station popups do (TemplateStation: variant "station").
  template: "station",
};

/** The closing wizard's rows (artboards 17/18): pick-only lists, the 38px note. "pack" and
 *  "pack-item" draw a row alike — they differ only in the card around it, which the preview draws
 *  itself. */
const CLOSING_ROW_VARIANT: FieldRowVariant = "pack";

function rowVariantOf(kind: PreviewPopupKind, wizard: PackageWizard | undefined): FieldRowVariant {
  return kind === "package" && wizard === "close" ? CLOSING_ROW_VARIANT : ROW_VARIANT[kind];
}

/** drafts[id], own keys only. */
function draftOf(drafts: Readonly<Drafts>, id: FieldId): FieldDraft | undefined {
  return Object.prototype.hasOwnProperty.call(drafts, id) ? drafts[id] : undefined;
}

/** The drafts of the fields still in `fields`. */
function draftsStillIn(fields: readonly Field[], drafts: Readonly<Drafts>): Drafts {
  const ids = new Set(fields.map((f) => f.id));
  return Object.fromEntries(Object.entries(drafts).filter(([id]) => ids.has(id)));
}

/**
 * The preview's own values. A new `fields` (every edit in the editor) keeps them by FieldId and
 * drops the values of the fields that went away, so a field added again starts empty. It is the
 * "information from earlier renders" pattern: the fields the drafts were kept for live in the same
 * state, and a render with other fields brings them in line before anything is drawn.
 */
function usePreviewDrafts(fields: readonly Field[]) {
  const [state, setState] = React.useState<{ fields: readonly Field[]; drafts: Drafts }>(() => ({ fields, drafts: {} }));
  let drafts = state.drafts;
  if (state.fields !== fields) {
    drafts = draftsStillIn(fields, state.drafts);
    setState({ fields, drafts });
  }
  const update = React.useCallback(
    (next: (d: Drafts) => Drafts) => setState((s) => ({ ...s, drafts: next(s.drafts) })),
    [],
  );
  return { drafts, update };
}

const FOCUSABLE_CONTROL = "[data-fx-control] :is(input:not([type='file']), textarea, button):not(:disabled):not([tabindex='-1'])";

/** After a keyboard pick that leaves the note optional: the first control of the rows after `id`
 *  (spec §4.6), as FieldsBlock moves it. */
function focusRowAfter(rows: HTMLElement | null, id: FieldId) {
  if (!rows) return;
  const all = Array.from(rows.querySelectorAll<HTMLElement>("[data-fx-row]"));
  const at = all.findIndex((r) => r.dataset.fxRow === id);
  if (at < 0) return;
  for (const row of all.slice(at + 1)) {
    const control = row.querySelector<HTMLElement>(FOCUSABLE_CONTROL);
    if (control) {
      control.focus();
      return;
    }
  }
}

export function WorkerPreviewCard(p: WorkerPreviewCardProps) {
  const { stationLabel, rowLabel, stepIndex, stepCount, fields, popupKind, stationTypeName, packageWizard, stationTypeId } = p;
  const variant = rowVariantOf(popupKind, packageWizard);
  const prefix = React.useId();
  const frameTitleId = `${prefix}-pv-frame`;
  const rowsRef = React.useRef<HTMLDivElement>(null);

  // A field without a name shows as "(ללא שם)" (artboard 2), in its row and in the suggestion.
  const unnamed = React.useMemo(
    () => new Set(fields.filter((f) => f.type !== "section" && f.label.trim() === "").map((f) => f.id)),
    [fields],
  );
  const defs = React.useMemo(
    () => fields.map((f): Field => (unnamed.has(f.id) ? { ...f, label: PREVIEW_TEXT.unnamed } : f)),
    [fields, unnamed],
  );

  const { drafts, update } = usePreviewDrafts(fields);
  const fx = React.useMemo(() => draftsFieldsState(defs, drafts, update), [defs, drafts, update]);

  // Artboard 2 (`missing`): every field still without its value or its required note, once each —
  // missingRequired and missingNotes never share a field (evaluate.ts).
  const missing = fx.ev.missingRequired.length + fx.ev.missingNotes.length;
  const blocked = missing > 0 || fx.blocking(GATE_FINISH_ON_REQUIRED);
  const finishLabel = popupKind === "dialog"
    ? PREVIEW_TEXT.finishDialog
    : popupKind === "package" ? PREVIEW_UNDRAWN_TEXT.finishPackage : stationFinishText(stationTypeName);
  const named = inputFieldCount(fields) - unnamed.size;
  const scanStep = popupKind === "verdict" || popupKind === "photo";

  const rows = blockItems([{ fields: defs }]).map((it) => {
    if (it.kind === "section") return <div key={it.def.id} className="tst-fx-section">{it.def.label}</div>;
    if (it.kind !== "field") return null; // group labels: a cell is one group
    const id = it.def.id;
    return (
      <div key={id} className="rf-pv-line" data-unnamed={unnamed.has(id) || undefined}>
        <FieldRow
          def={it.def} draft={draftOf(fx.drafts, id)} onChange={(patch) => fx.set(id, patch)}
          {...rowState(it.def, fx.ev, false)} variant={variant} ids={fieldRowIds(prefix, id)}
          onFocusNext={() => focusRowAfter(rowsRef.current, id)} />
      </div>
    );
  });

  let head: React.ReactNode;
  if (popupKind === "dialog") {
    const status = blockStatus("dialog", defs, fx.ev);
    head = (
      <div className="tst-fx tst-fx--dialog">
        <div className="tst-fx-head">
          <ClipboardCheck size={18} strokeWidth={1.75} aria-hidden className="tst-fx-head-icon" />
          <h3 id={frameTitleId} className="tst-fx-title">
            {BLOCK_TITLE.dialog}<span className="tst-fx-count">{fieldCountText(inputFieldCount(defs))}</span>
          </h3>
          <Tag tone="primary" size="sm">{BLOCK_TEXT.tag}</Tag>
          <span className="tst-fx-spacer" />
          {status && (
            <span role="status" className="tst-fx-status" data-tone={status.tone}>
              {statusRuns(status.text).map((run, i) => (run.ltr ? <bdi key={i} dir="ltr">{run.text}</bdi> : <React.Fragment key={i}>{run.text}</React.Fragment>))}
            </span>
          )}
        </div>
      </div>
    );
  } else {
    head = (
      <>
        <div className="rf-pv-frame-head">
          <div className="rf-pv-frame-titles">
            <h3 id={frameTitleId} className="rf-pv-frame-title">{BLOCK_TITLE.dialog}</h3>
            <span className="rf-pv-frame-sub">{previewSubText(stationLabel, rowLabel, named)}</span>
          </div>
          {scanStep && <span className="rf-pv-step">{previewStepText(stepIndex, stepCount)}</span>}
        </div>
        {popupKind === "template" && (
          <div className="rf-pv-plan">
            <LayoutTemplate size={15} strokeWidth={1.75} aria-hidden />
            <span>
              {EDITOR_UNDRAWN_TEXT.templateNote}{" "}
              {stationTypeId != null && <Link href={`/settings/popup-templates?type=${stationTypeId}`} className="sh-link">{EDITOR_UNDRAWN_TEXT.templateLink}</Link>}
            </span>
          </div>
        )}
        {scanStep && (
          <div className="rf-pv-plan">
            <Info size={15} strokeWidth={1.75} aria-hidden />
            <span>{PREVIEW_TEXT.planLead}<span dir="ltr" className="rf-pv-plan-sku">{PREVIEW_SAMPLE.sku}</span></span>
          </div>
        )}
      </>
    );
  }

  return (
    <aside aria-labelledby="pv-title" className="rf-pv">
      <div className="rf-pv-head">
        <h2 id="pv-title" className="rf-pv-title">{PREVIEW_TEXT.title}</h2>
        <Tag tone="success" size="sm" icon={<span aria-hidden="true" className="rf-pv-live-dot" />}>{PREVIEW_TEXT.live}</Tag>
      </div>

      <div className="rf-pv-body">
        <div className="rf-pv-dummy">
          <span className="rf-pv-dummy-line">
            <b>{rowLabel}</b>{" · "}<span dir="ltr">{PREVIEW_SAMPLE.model}</span>{" · "}
            <span dir="ltr" className="rf-pv-dummy-id">{PREVIEW_SAMPLE.idLead}<b>{PREVIEW_SAMPLE.idEnd}</b></span>
          </span>
          <span className="rf-pv-hint">{PREVIEW_TEXT.notSaved}</span>
        </div>

        <section aria-labelledby={frameTitleId} className="rf-pv-frame">
          {head}
          <div ref={rowsRef} className="rf-pv-rows">{rows}</div>
          {popupKind === "dialog" && (
            // Artboard 14 closes the block with it (PopUpTestDialog's footer).
            <SuggestionLine fails={fx.ev.fails} defs={defs} prefix={SUGGEST_PREFIX_DIALOG} icon="bulb" size="12.5" style={{ padding: "8px 12px" }} />
          )}
          <div className="rf-pv-foot">
            {/* Artboard 2's three words (statusA over the one count). */}
            <span className="rf-pv-foot-text">{statusA(missing, 0).text}</span>
            <Button
              color="success" size="small" className="rf-pv-finish" aria-disabled={blocked}
              startIcon={<CircleCheck size={15} strokeWidth={1.75} aria-hidden />}>
              {finishLabel}
            </Button>
          </div>
        </section>
      </div>
    </aside>
  );
}

export default WorkerPreviewCard;
