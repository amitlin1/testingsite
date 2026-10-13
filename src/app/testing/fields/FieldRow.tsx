"use client";
import * as React from "react";
import { Check } from "lucide-react";
import type { ChecklistField, InputField, PhotoField } from "@/app/lib/station-fields/schema";
import { PassFail, PhotoUploader, type RefImg } from "../tests-popups/stationKit";
import ChoiceAutocomplete, { CHOICE_TEXT, MultiChoiceAutocomplete } from "./ChoiceAutocomplete";
import { NotesField } from "./NotesField";
import { NumberField, NumberRangeLine, numberRangeLineId } from "./NumberField";
import {
  TEXT_VALUE_MAX, VARIANT_SPEC, addShot, hasLabelledControl, isItemChecked, noteEditorTitle, noteLabelText,
  notePlaceholder, removeShot, settleShot, toggleChecklistItem, type FieldRowVariant, type RowState,
} from "./fieldsBlockModel";
import type { DraftPatch, FieldDraft } from "./useFieldsState";
import "@/app/packages/packages.css";
import "./fields.css";

/**
 * One station field in a worker popup: [name | control | note] (route-fields spec §4.5; artboards
 * 12–18, the row as in artboards 5/6). FieldsBlock lays the rows out and works out each one's
 * state (fieldsBlockModel rowState); the row draws it with the variant's metrics (fields.css).
 *
 * - Name: <label htmlFor> the control, "*" (aria-hidden) when required — the control carries
 *   aria-required. pass_fail, checklist and photo have no single control: the name is a <span id>
 *   their group points at (aria-labelledby). The help text sits under the name, and a number's
 *   range line under that (artboard 14).
 * - Control by type: choice_row → ChoiceAutocomplete; multi_choice → its multiple form; number →
 *   NumberField; pass_fail → PassFail size "row"; text / scan → a 44px input (scan typed LTR, as
 *   SkuScreen); textarea → NotesField "area"; checklist → the packing checks' cards; photo →
 *   PhotoUploader, uploading through the host's `uploadPhoto` (a shot uploading or failed blocks
 *   finishing: evaluate.ts pendingPhotos).
 * - Note: NotesField as the variant draws it; notes "off" leaves the column empty, so the columns
 *   never move (spec §4.5).
 * - After a keyboard pick in the list (1–4 / Enter): to the note when it just became required,
 *   else to the next row's control (spec §4.6 "אחרי בחירה").
 */

/** Uploads one shot of a photo field, tagged with its photo type; resolves to the object key, or
 *  null when it did not reach storage (the shot then reads failed). */
export type UploadFieldPhoto = (file: File, photoType: string) => Promise<string | null>;

export interface FieldRowProps extends RowState {
  def: InputField;
  draft: FieldDraft | undefined;
  /** Merged into this field's draft — a function patch reads the draft as it is when it lands. */
  onChange: (patch: DraftPatch) => void;
  variant: FieldRowVariant;
  ids: { control: string; note: string };
  /** A 1px line above the row (fieldsBlockModel blockItems). */
  rule?: boolean;
  /** Under a group label (artboard 16): 8px above and below. */
  inMini?: boolean;
  /** Focus the next row's control (after a keyboard pick that left the note optional). */
  onFocusNext?: () => void;
  uploadPhoto?: UploadFieldPhoto;
}

/** A photo field has no reference images of its own. */
const NO_REF_IMAGES: RefImg[] = [];

export function FieldRow({
  def, draft, onChange, isFail, noteRequired, noteError, showRequiredError, variant, ids,
  rule = false, inMini = false, onFocusNext, uploadPhoto,
}: FieldRowProps) {
  const spec = VARIANT_SPEC[variant];
  const noteRef = React.useRef<HTMLTextAreaElement>(null);
  const hasNote = def.notes !== "off";
  const labelId = `${ids.control}-label`;
  const helpId = def.help ? `${ids.control}-help` : undefined;

  // ChoiceAutocomplete runs this once the picked value has rendered, so noteRequired is current.
  const afterPick = () => {
    if (hasNote && noteRequired) noteRef.current?.focus();
    else onFocusNext?.();
  };

  let control: React.ReactNode;
  switch (def.type) {
    case "choice_row":
      control = (
        <ChoiceAutocomplete
          id={ids.control} label={def.label} options={def.options} value={draft?.opt ?? null}
          onChange={(opt) => onChange({ opt })} required={def.required} invalid={showRequiredError}
          typeToFilter={spec.typeToFilter} placeholderOpen={spec.placeholderOpen} footerHint={spec.footerHint}
          highlightFirst={spec.highlightFirst} onPicked={afterPick} aria-describedby={helpId} />
      );
      break;
    case "multi_choice":
      control = (
        <MultiChoiceAutocomplete
          id={ids.control} label={def.label} options={def.options} value={draft?.opts ?? []}
          onChange={(opts) => onChange({ opts })} required={def.required} invalid={showRequiredError}
          typeToFilter={spec.typeToFilter} placeholderOpen={spec.placeholderOpen} footerHint={spec.footerHint}
          aria-describedby={helpId} />
      );
      break;
    case "number":
      control = (
        <NumberField
          id={ids.control} def={def} value={draft?.num ?? ""} onChange={(num) => onChange({ num })}
          showRequiredError={showRequiredError} rangeLine="external" describedBy={helpId} />
      );
      break;
    case "pass_fail": {
      // Artboard 14 marks a missing pair by its edges alone; assistive tech gets the words.
      const errId = `${ids.control}-err`;
      control = (
        <>
          <PassFail
            value={draft?.ok ?? ""} onChange={(ok) => onChange({ ok })} onClear={() => onChange({ ok: null })}
            labelledBy={labelId} describedBy={[helpId, showRequiredError ? errId : ""].filter(Boolean).join(" ") || undefined}
            size="row" invalid={showRequiredError} />
          <span id={errId} className="sh-visually-hidden" aria-live="polite">{showRequiredError ? CHOICE_TEXT.pickError : ""}</span>
        </>
      );
      break;
    }
    case "text":
    case "scan":
      control = (
        <input
          id={ids.control} className={def.type === "scan" ? "tst-fx-input tst-fx-input--code" : "tst-fx-input"}
          dir={def.type === "scan" ? "ltr" : undefined} spellCheck={def.type === "scan" ? false : undefined}
          value={draft?.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} maxLength={TEXT_VALUE_MAX}
          autoComplete="off" aria-required={def.required || undefined} aria-invalid={showRequiredError || undefined}
          aria-describedby={helpId} />
      );
      break;
    case "textarea":
      // Required and missing, as the other inputs say it: aria-required (the row shows the "*"),
      // and a red edge with aria-invalid after a save attempt — not a note's "הערה · חובה" or
      // "יש לפרט את החריגה".
      control = (
        <NotesField
          size="area" id={ids.control} value={draft?.text ?? ""} onChange={(text) => onChange({ text })}
          max={TEXT_VALUE_MAX} placeholder="" editorTitle={def.label} describedBy={helpId} look={spec.noteLook}
          required={def.required} requiredLabel="none" error={showRequiredError} errorStyle="edge" />
      );
      break;
    case "checklist":
      control = <ChecklistControl def={def} draft={draft} onChange={onChange} labelId={labelId} helpId={helpId} invalid={showRequiredError} />;
      break;
    case "photo":
      control = <PhotoControl def={def} draft={draft} onChange={onChange} labelId={labelId} helpId={helpId} uploadPhoto={uploadPhoto} />;
      break;
  }

  return (
    <div
      className="tst-fx-row"
      data-fx-row={def.id}
      data-rule={rule || undefined}
      data-fail={isFail || undefined}
      data-mini={inMini || undefined}
      // "הערה · חובה" above the note: the name and the control step down to its box (ctlPad).
      data-pad={(hasNote && noteRequired && spec.noteLabel === "above") || undefined}
      // Artboards 17/18: the 38px note level with the 44px controls (notePad).
      data-note-pad={(hasNote && !noteRequired && spec.note === "row-compact") || undefined}
      data-wide={def.type === "photo" || undefined}
    >
      <div className="tst-fx-name">
        <span className="tst-fx-label">
          {hasLabelledControl(def.type)
            ? <label htmlFor={ids.control}>{def.label}</label>
            : <span id={labelId}>{def.label}</span>}
          {def.required && <span aria-hidden="true" className="tst-fx-req">*</span>}
        </span>
        {def.help && <span id={helpId} className="tst-fx-help">{def.help}</span>}
        {def.type === "number" && (
          <NumberRangeLine id={numberRangeLineId(ids.control)} def={def} value={draft?.num ?? ""} showRequiredError={showRequiredError} />
        )}
      </div>

      <div className="tst-fx-control" data-fx-control="">{control}</div>

      <div className="tst-fx-note">
        {hasNote && (
          <NotesField
            ref={noteRef} size={spec.note} id={ids.note} value={draft?.note ?? ""} onChange={(note) => onChange({ note })}
            max={def.note_max} required={noteRequired} error={noteError} rowTone={isFail ? "fail" : "normal"}
            placeholder={notePlaceholder(variant, noteRequired, isFail)} editorTitle={noteEditorTitle(def.label)}
            labelText={noteLabelText(def.label)} requiredLabel={spec.noteLabel} look={spec.noteLook}
            errorStyle={spec.noteLabel === "legend" ? "placeholder" : "line"} />
        )}
      </div>
    </div>
  );
}

/** checklist (no worker artboard): one card per item, as the packing checks ("תקינות האריזה"). */
function ChecklistControl({ def, draft, onChange, labelId, helpId, invalid }: {
  def: ChecklistField; draft: FieldDraft | undefined; onChange: (patch: DraftPatch) => void;
  labelId: string; helpId: string | undefined; invalid: boolean;
}) {
  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={helpId} className="tst-fx-checklist">
      {def.items.map((it) => {
        const on = isItemChecked(draft, it.id);
        return (
          <button
            key={it.id} type="button" role="checkbox" aria-checked={on} onClick={() => onChange(toggleChecklistItem(it.id))}
            className="pkg-choice pkg-press tst-fx-check" data-invalid={(invalid && !on) || undefined}>
            <span aria-hidden className={on ? "pkg-tick pkg-tick--on" : "pkg-tick"}>{on && <Check size={12} strokeWidth={1.75} />}</span>
            <span className="tst-fx-check-label">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** photo (no worker artboard): the stations' uploader. Each shot uploads on its own and settles
 *  its own entry, so a pick of several images and uploads that end together never clobber each
 *  other (function patches). Without `uploadPhoto` a shot cannot be stored, so it reads failed. */
function PhotoControl({ def, draft, onChange, labelId, helpId, uploadPhoto }: {
  def: PhotoField; draft: FieldDraft | undefined; onChange: (patch: DraftPatch) => void;
  labelId: string; helpId: string | undefined; uploadPhoto: UploadFieldPhoto | undefined;
}) {
  const pick = (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    onChange(addShot(previewUrl));
    const upload = uploadPhoto ? uploadPhoto(file, def.photo_type) : Promise.resolve(null);
    upload.then(
      (key) => onChange(settleShot(previewUrl, key)),
      () => onChange(settleShot(previewUrl, null)),
    );
  };
  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={helpId}>
      <PhotoUploader photos={draft?.photos ?? []} refImages={NO_REF_IMAGES} onPick={pick} onRemove={(i) => onChange(removeShot(i))} />
    </div>
  );
}

export default FieldRow;
