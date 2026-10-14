"use client";
import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronUp, Ellipsis, GripVertical, Hash, Heading, Plus, ToggleLeft } from "lucide-react";
import { Menu, MenuItem, cn } from "@/components/ui";
import { NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import type { ChoiceRowField, Field, InputField, MultiChoiceField, NoteMax, NumberField, VersionRef } from "@/app/lib/station-fields/schema";
import { LIMITS } from "@/app/lib/station-fields/validate";
import type { Issue } from "@/app/lib/station-fields/validate";
import { LINT_TEXT, PASS_FAIL_WORD } from "@/app/lib/station-fields/labels";
import {
  EDITOR_UNDRAWN_TEXT, EDITOR_TEXT, FIELD_TYPE_TEXT, NUMBER_SETTINGS_TEXT, listLinkText, optionsGroupLabel, requiredAria,
  rowGripLabel, rowMoreLabel,
} from "../../lib/labels";
import { LIBRARY_TEXT } from "../../lib/libraryLabels";
import { addOption, removeOption, renameOption, setOptionTone, withFieldHelp } from "../../lib/editorModel";
import type { EditorPopover, OptionField } from "../../lib/editorModel";
import { formatDecimal, parseDecimalText, withNumberSetting, withUnit } from "../../lib/numberText";
import { NotesModeSelect } from "./NotesModeSelect";
import { NoteMaxSelect } from "./NoteMaxSelect";
import { OptionChip } from "./OptionChip";
import { NumberFieldSettings, numberSummaryText } from "./NumberFieldSettings";
import { OPTION_LIST_POPOVER_ID, OptionListPopover } from "./OptionListPopover";
import { ChecklistItemsEditor } from "./ChecklistItemsEditor";
import { PhotoFieldSettings } from "./PhotoFieldSettings";

/**
 * One row of the fields table (artboard 2, spec §5.5.2): a section header, or a field —
 *   grip (28×38, GripVertical; HTML5 drag and Alt+↑/↓) | name (.stp-input 38px; a Hash / ToggleLeft
 *   tile for number / pass-fail; the new-row placeholder; "יש להזין שם לשדה" once the row is no longer
 *   new — spec §5.15) | options by type | notes (NotesModeSelect + NoteMaxSelect) | "חובה" | ⋯.
 * Options by type: choice_row / multi_choice — the option chips, "רשימה: …" (artboard 4) and
 *   "+ אפשרות"; number — artboard 2's "יחידה" / "מקס׳" and the summary button that expands
 *   NumberFieldSettings in place (artboard 3); pass_fail — the two framed chips; checklist — its
 *   boxes (ChecklistItemsEditor); photo — its photo type and minimum (PhotoFieldSettings); those two
 *   and every other type — the help text and the type's name in the picker. No artboard draws the
 *   settings of the other types (spec §5.5.2 "לא אומת"): the checklist's and the photo's are the
 *   minimum a publish needs (the lint blocks an empty checklist, an unnamed box, a photo without a
 *   type). A field new in the draft carries "חדש בטיוטה".
 * The popovers of the row share the editor's one-at-a-time state (EditorPopover).
 */

export type RowDnd = {
  dragging: boolean;
  drop: "before" | "after" | null;
  onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragEnter: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
};

export type FieldRowEditorProps = {
  field: Field;
  /** Just added: the name's placeholder and halo, no "missing name" error yet (spec §5.15). */
  fresh: boolean;
  /** Not in the published version of the cell — "חדש בטיוטה". */
  isNew: boolean;
  /** This field's lint issues (errors first). */
  issues: readonly Issue[];
  popover: EditorPopover | null;
  setPopover: React.Dispatch<React.SetStateAction<EditorPopover | null>>;
  /** A number field's settings are open under the row. */
  expanded: boolean;
  onToggleExpanded: () => void;
  onChange: (next: Field) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  /** Alt+↑ / Alt+↓ from the grip ("grip") or the name ("name"). */
  onMove: (delta: -1 | 1, from: "grip" | "name") => void;
  onNameBlur: () => void;
  /** Enter in the name: the table adds a row when this is the last field (spec §5.16). */
  onNameEnter: () => void;
  dnd: RowDnd;
  /** For the option list popover's local-options title (artboard 4). */
  stationLabel: string;
  rowLabel: string;
  /** The name of a shared option list, when the screen knows it. */
  listName: (ref: VersionRef) => string | null;
  /** In a field set (artboard 8): a linked field's "רשימה: {name}" opens the list in the library
   *  instead of the options popover. */
  onOpenList?: (ref: VersionRef) => void;
};

/** DOM ids of a row's controls — the table focuses them after a move, an add, "עבור לשדה". */
export const rowIds = (fieldId: string) => ({
  name: "sfe-nm-" + fieldId,
  grip: "sfe-grip-" + fieldId,
  error: "sfe-err-" + fieldId,
  numberSettings: "sfe-num-" + fieldId,
  numberToggle: "sfe-numsum-" + fieldId,
  unit: "sfe-unit-" + fieldId,
  max: "sfe-max-" + fieldId,
  photoMin: "sfe-photomin-" + fieldId,
});

const isMoveKey = (e: React.KeyboardEvent) => e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown");

export function FieldRowEditor(props: FieldRowEditorProps) {
  const { field, dnd, popover, setPopover } = props;
  const ids = rowIds(field.id);
  const menuOpen = popover?.kind === "rowMenu" && popover.fieldId === field.id;

  const onGripKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!isMoveKey(e)) return;
    e.preventDefault();
    props.onMove(e.key === "ArrowUp" ? -1 : 1, "grip");
  };

  const grip = (
    <button
      id={ids.grip}
      type="button"
      className="sfe-grip"
      draggable
      aria-label={rowGripLabel(field.label)}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onKeyDown={onGripKey}
    >
      <GripVertical size={16} strokeWidth={1.75} aria-hidden />
    </button>
  );

  const more = (
    <>
      <button
        type="button"
        className="sfe-more"
        aria-label={rowMoreLabel(field.label)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          const anchor = e.currentTarget;
          setPopover((p) => (p?.kind === "rowMenu" && p.fieldId === field.id ? null : { kind: "rowMenu", fieldId: field.id, anchor }));
        }}
      >
        <Ellipsis size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <Menu
        open={menuOpen}
        anchorEl={menuOpen ? popover.anchor : null}
        onClose={() => setPopover((p) => (p?.kind === "rowMenu" && p.fieldId === field.id ? null : p))}
        MenuListProps={{ className: "sfe-menu", "aria-label": rowMoreLabel(field.label) }}
      >
        <MenuItem
          onClick={() => {
            setPopover(null);
            props.onDuplicate();
          }}
        >
          {EDITOR_UNDRAWN_TEXT.rowDuplicate}
        </MenuItem>
        <MenuItem
          danger
          onClick={() => {
            setPopover(null);
            props.onRemove();
          }}
        >
          {EDITOR_UNDRAWN_TEXT.rowDelete}
        </MenuItem>
      </Menu>
    </>
  );

  const itemClass = cn(
    "sfe-item",
    field.type === "section" && "sfe-item--section",
    props.expanded && "sfe-item--expanded",
    dnd.dragging && "sfe-item--dragging",
    dnd.drop === "before" && "sfe-item--drop-before",
    dnd.drop === "after" && "sfe-item--drop-after",
  );

  if (field.type === "section") {
    return (
      <div className={itemClass} data-field-id={field.id} onDragEnter={dnd.onDragEnter} onDragOver={dnd.onDragOver} onDragLeave={dnd.onDragLeave} onDrop={dnd.onDrop}>
        <div className="sfe-section">
          {grip}
          <div className="sfe-section__main">
            <Heading size={16} strokeWidth={1.75} className="sfe-section__icon" aria-hidden />
            <label htmlFor={ids.name} className="sfe-sr">{EDITOR_TEXT.sectionLabel}</label>
            <input
              id={ids.name}
              className="sfe-section__input"
              value={field.label}
              maxLength={LIMITS.fieldLabel}
              onChange={(e) => props.onChange({ ...field, label: e.target.value })}
              onKeyDown={(e) => {
                if (isMoveKey(e)) {
                  e.preventDefault();
                  props.onMove(e.key === "ArrowUp" ? -1 : 1, "name");
                }
              }}
            />
            <span className="sfe-section__caption">{EDITOR_TEXT.sectionCaption}</span>
          </div>
          {more}
        </div>
      </div>
    );
  }

  return (
    <div className={itemClass} data-field-id={field.id} onDragEnter={dnd.onDragEnter} onDragOver={dnd.onDragOver} onDragLeave={dnd.onDragLeave} onDrop={dnd.onDrop}>
      <div className="sfe-row">
        {grip}
        <NameCell {...props} field={field} />
        <OptionsCell {...props} field={field} />
        <div className="sfe-notes">
          <NotesModeSelect
            value={field.notes}
            open={popover?.kind === "notes" && popover.fieldId === field.id}
            onOpenChange={(o) => setPopover((p) => (o ? { kind: "notes", fieldId: field.id } : p?.kind === "notes" && p.fieldId === field.id ? null : p))}
            onChange={(notes) => props.onChange({ ...field, notes })}
          />
          {field.notes !== "off" && (
            <NoteMaxSelect
              value={field.note_max ?? NOTE_MAX_DEFAULT}
              open={popover?.kind === "noteMax" && popover.fieldId === field.id}
              onOpenChange={(o) => setPopover((p) => (o ? { kind: "noteMax", fieldId: field.id } : p?.kind === "noteMax" && p.fieldId === field.id ? null : p))}
              onChange={(n: NoteMax) => {
                const next = { ...field };
                if (n === NOTE_MAX_DEFAULT) delete next.note_max;
                else next.note_max = n;
                props.onChange(next);
              }}
            />
          )}
        </div>
        <div className="sfe-req-cell">
          <button
            type="button"
            className="sfe-req"
            aria-pressed={field.required}
            aria-label={requiredAria(field.label)}
            onClick={() => props.onChange({ ...field, required: !field.required })}
          >
            {EDITOR_TEXT.required}
          </button>
        </div>
        {more}
      </div>
      {field.type === "number" && props.expanded && (
        <NumberFieldSettings
          id={ids.numberSettings}
          field={field}
          onChange={(next) => props.onChange(next)}
          onClose={() => {
            props.onToggleExpanded();
            document.getElementById(ids.numberToggle)?.focus();
          }}
        />
      )}
    </div>
  );
}

// ---- name ------------------------------------------------------------------------------------------
function NameCell({ field, fresh, issues, onChange, onMove, onNameBlur, onNameEnter }: FieldRowEditorProps & { field: InputField }) {
  const ids = rowIds(field.id);
  const missing = field.label.trim() === "" && !fresh;
  const duplicate = issues.find((i) => i.code === "DUPLICATE_LABEL_IN_CELL");
  const tile =
    field.type === "number" ? { title: EDITOR_TEXT.numberTile, Icon: Hash }
    : field.type === "pass_fail" ? { title: EDITOR_TEXT.passFailTile, Icon: ToggleLeft }
    : null;
  return (
    <div className="sfe-name">
      <label htmlFor={ids.name} className="sfe-sr">{EDITOR_TEXT.nameLabel}</label>
      <div className="sfe-name__box">
        {tile && (
          <span className="sfe-name__tile" title={tile.title}>
            <tile.Icon size={14} strokeWidth={1.75} aria-hidden />
          </span>
        )}
        <input
          id={ids.name}
          className={cn(
            "stp-input sfe-name__input",
            tile && "sfe-name__input--tiled",
            fresh && field.label === "" && "sfe-name__input--fresh",
            missing && "stp-input--error",
          )}
          value={field.label}
          maxLength={LIMITS.fieldLabel}
          placeholder={fresh ? EDITOR_TEXT.newNamePlaceholder : EDITOR_TEXT.namePlaceholder}
          aria-invalid={missing}
          aria-describedby={missing || duplicate ? ids.error : undefined}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
          onBlur={onNameBlur}
          onKeyDown={(e) => {
            if (isMoveKey(e)) {
              e.preventDefault();
              onMove(e.key === "ArrowUp" ? -1 : 1, "name");
            } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onNameEnter();
            }
          }}
        />
      </div>
      {missing && <span id={ids.error} className="sfe-err">{LINT_TEXT.fieldLabelEmpty}</span>}
      {!missing && duplicate && <span id={ids.error} className="sfe-warn">{duplicate.message}</span>}
    </div>
  );
}

// ---- options -----------------------------------------------------------------------------------------
/** The field's errors the name column does not show (an empty name, a duplicate name). */
function otherErrors(issues: readonly Issue[]): string[] {
  const seen = new Set<string>();
  for (const i of issues) {
    if (i.level === "error" && i.code !== "FIELD_LABEL_EMPTY") seen.add(i.message);
  }
  return [...seen];
}

function DraftNew({ show }: { show: boolean }) {
  return show ? <span className="sfe-draftnew">{EDITOR_TEXT.draftNew}</span> : null;
}

/** The worker's help text of a field the row has no expanded settings for. */
function HelpInput({ field, onChange }: FieldRowEditorProps & { field: InputField }) {
  return (
    <input
      className="stp-input"
      aria-label={NUMBER_SETTINGS_TEXT.help}
      placeholder={NUMBER_SETTINGS_TEXT.helpPlaceholder}
      value={field.help ?? ""}
      maxLength={LIMITS.help}
      onChange={(e) => onChange(withFieldHelp(field, e.target.value))}
    />
  );
}

/** The type's name in the picker (artboard 3), and "חדש בטיוטה". */
function TypeCaption({ field, isNew }: FieldRowEditorProps & { field: InputField }) {
  return (
    <div className="sfe-links">
      <span className="sfe-caption">{FIELD_TYPE_TEXT[field.type].name}</span>
      <DraftNew show={isNew} />
    </div>
  );
}

function OptionsCell(props: FieldRowEditorProps & { field: InputField }) {
  const { field } = props;
  const errors = otherErrors(props.issues);
  let body: React.ReactNode;
  switch (field.type) {
    case "choice_row":
    case "multi_choice":
      body = <ChoiceOptions {...props} field={field} />;
      break;
    case "number":
      body = <NumberOptions {...props} field={field} />;
      break;
    case "pass_fail":
      body = (
        <div className="sfe-pf">
          <span className="sfe-pf__chip sfe-pf__chip--pass">{PASS_FAIL_WORD.pass}</span>
          <span className="sfe-pf__chip sfe-pf__chip--fail">{PASS_FAIL_WORD.fail}</span>
          <span className="sfe-caption">{EDITOR_TEXT.passFailCaption}</span>
          <DraftNew show={props.isNew} />
        </div>
      );
      break;
    case "checklist":
      body = (
        <>
          <ChecklistItemsEditor field={field} popover={props.popover} setPopover={props.setPopover} onChange={props.onChange} />
          <HelpInput {...props} field={field} />
          <TypeCaption {...props} field={field} />
        </>
      );
      break;
    case "photo":
      body = (
        <>
          <PhotoFieldSettings
            field={field}
            minId={rowIds(field.id).photoMin}
            typeMissing={props.issues.some((i) => i.code === "PHOTO_TYPE_EMPTY")}
            onChange={props.onChange}
          />
          <HelpInput {...props} field={field} />
          <TypeCaption {...props} field={field} />
        </>
      );
      break;
    default:
      body = (
        <>
          <HelpInput {...props} field={field} />
          <TypeCaption {...props} field={field} />
        </>
      );
  }
  return (
    <div className="sfe-opts">
      {body}
      {errors.map((m) => (
        <span key={m} className="sfe-err">{m}</span>
      ))}
    </div>
  );
}

function ChoiceOptions(props: FieldRowEditorProps & { field: ChoiceRowField | MultiChoiceField }) {
  const { field, popover, setPopover, onChange } = props;
  const listRef = React.useRef<HTMLButtonElement>(null);
  const addRef = React.useRef<HTMLButtonElement>(null);
  const listOpen = popover?.kind === "list" && popover.fieldId === field.id;
  const editingId = popover?.kind === "option" && popover.fieldId === field.id ? popover.optionId : null;
  const isMine = (p: EditorPopover | null, optionId: string) => p?.kind === "option" && p.fieldId === field.id && p.optionId === optionId;
  const isList = (p: EditorPopover | null) => p?.kind === "list" && p.fieldId === field.id;
  const opensList = field.list_ref != null && props.onOpenList != null;

  const change = (next: OptionField) => onChange(next);
  return (
    <>
      <div role="group" aria-label={optionsGroupLabel(field.label)} className="sfe-chips">
        {field.options.map((o) => (
          <OptionChip
            key={o.id}
            option={o}
            editing={editingId === o.id}
            onToggleEdit={() => setPopover((p) => (isMine(p, o.id) ? null : { kind: "option", fieldId: field.id, optionId: o.id }))}
            onClose={() => setPopover((p) => (isMine(p, o.id) ? null : p))}
            onRename={(label) => change(renameOption(field, o.id, label))}
            onTone={(tone) => change(setOptionTone(field, o.id, tone))}
            onRemove={() => {
              setPopover((p) => (isMine(p, o.id) ? null : p));
              change(removeOption(field, o.id));
              addRef.current?.focus();
            }}
          />
        ))}
      </div>
      <div className="sfe-links">
        {/* One element either way, so it stays the popover's anchor (focus returns to it) when
            "החל על השדה" links the field. In a field set (artboard 8) a linked field's link opens the
            list in the library instead of the popover. */}
        <button
          ref={listRef}
          type="button"
          className="sfe-link"
          title={opensList ? LIBRARY_TEXT.openListTitle : undefined}
          aria-haspopup={opensList ? undefined : "dialog"}
          aria-expanded={opensList ? undefined : listOpen}
          aria-controls={!opensList && listOpen ? OPTION_LIST_POPOVER_ID : undefined}
          onClick={() => {
            if (opensList && field.list_ref) props.onOpenList?.(field.list_ref);
            // The popover leaves presses on its anchor alone: the link is its toggle.
            else setPopover((p) => (isList(p) ? null : { kind: "list", fieldId: field.id }));
          }}
        >
          {listLinkText(field.list_ref != null, field.list_ref ? props.listName(field.list_ref) : null)}
          {opensList
            ? <ChevronLeft size={12} strokeWidth={1.75} aria-hidden />
            : <ChevronDown size={12} strokeWidth={1.75} aria-hidden />}
        </button>
        <button
          ref={addRef}
          type="button"
          className="sfe-addopt"
          onClick={() => {
            const { field: next, optionId } = addOption(field);
            change(next);
            setPopover({ kind: "option", fieldId: field.id, optionId });
          }}
        >
          <Plus size={13} strokeWidth={1.75} aria-hidden />
          {EDITOR_TEXT.addOption}
        </button>
        <DraftNew show={props.isNew} />
      </div>
      <OptionListPopover
        open={listOpen}
        onOpenChange={(o) => setPopover((p) => (o ? { kind: "list", fieldId: field.id } : isList(p) ? null : p))}
        anchorRef={listRef}
        field={field}
        stationLabel={props.stationLabel}
        rowLabel={props.rowLabel}
        // The popover closes itself (onOpenChange) once the list's other linked fields are reached.
        onApply={change}
      />
    </>
  );
}

function NumberOptions(props: FieldRowEditorProps & { field: NumberField }) {
  const { field, expanded, onChange } = props;
  const ids = rowIds(field.id);
  return (
    <>
      {!expanded && (
        <div className="sfe-num">
          <label htmlFor={ids.unit}>{EDITOR_TEXT.unit}</label>
          <input
            id={ids.unit}
            dir="ltr"
            className="sfe-num__input sfe-num__input--unit"
            value={field.unit ?? ""}
            maxLength={LIMITS.unit}
            onChange={(e) => onChange(withUnit(field, e.target.value))}
          />
          <label htmlFor={ids.max}>{EDITOR_TEXT.max}</label>
          <DecimalInput
            id={ids.max}
            className="sfe-num__input sfe-num__input--max"
            value={field.max}
            onValue={(v) => onChange(withNumberSetting(field, "max", v))}
          />
          <span className="sfe-caption">{field.out_of_range_fail ? EDITOR_TEXT.numberCaption : FIELD_TYPE_TEXT.number.name}</span>
        </div>
      )}
      <div className="sfe-links">
        <button
          id={ids.numberToggle}
          type="button"
          className="sfe-link sfe-numsum"
          aria-expanded={expanded}
          aria-controls={ids.numberSettings}
          onClick={props.onToggleExpanded}
        >
          <span>{numberSummaryText(field)}</span>
          {expanded ? <ChevronUp size={14} strokeWidth={1.75} aria-hidden /> : <ChevronDown size={12} strokeWidth={1.75} aria-hidden />}
        </button>
        <DraftNew show={props.isNew} />
      </div>
    </>
  );
}

/** A number typed as text: the stored value changes only while the text reads as a number ("," as
 *  "."); text that does not is marked invalid and goes back to the stored value on blur. */
function DecimalInput({ id, className, value, onValue }: { id: string; className: string; value: number | undefined; onValue: (v: number | undefined) => void }) {
  const [text, setText] = React.useState<string | null>(null);
  const shown = text ?? formatDecimal(value);
  const invalid = text != null && parseDecimalText(text) === null;
  return (
    <input
      id={id}
      dir="ltr"
      inputMode="decimal"
      className={className}
      value={shown}
      aria-invalid={invalid || undefined}
      onFocus={() => setText(formatDecimal(value))}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const v = parseDecimalText(t);
        if (v !== null) onValue(v);
      }}
      onBlur={() => setText(null)}
    />
  );
}

export default FieldRowEditor;
