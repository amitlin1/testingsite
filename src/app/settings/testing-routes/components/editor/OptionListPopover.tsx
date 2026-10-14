"use client";
import * as React from "react";
import { createPortal, flushSync } from "react-dom";
import { CircleAlert, CircleCheck, GripVertical, Info, Link2, ListPlus, Plus, Search, X } from "lucide-react";
import { AnchoredPopover, Button, IconButton, Skeleton, cn } from "@/components/ui";
import { TONE_WORD } from "@/app/lib/station-fields/schema";
import type { ChoiceOption, ChoiceRowField, MultiChoiceField } from "@/app/lib/station-fields/schema";
import type { OptionListJson } from "@/app/lib/station-fields/admin-types";
import { newOptionId } from "@/app/lib/station-fields/step-uids";
import { LIMITS, optionListLine } from "@/app/lib/station-fields/validate";
import {
  OPTION_LIST_TEXT, localOptionsNote, optionDragLabel, optionKeyTitle, optionListTitle, optionNameLabel,
  optionRemoveLabel, optionRowLabel, optionsCountText, toneButtonLabel,
} from "../../lib/labels";
import {
  LIBRARY_UNDRAWN_TEXT, LIBRARY_TEXT, SHARED_LIST_TEXT, linkedHelpText, linkedToFieldTitle, localOptionsTitleOf,
  saveAsVersionText, sharedImpactText, sharedListRowLabel, willLinkHelpText,
} from "../../lib/libraryLabels";
import {
  addOption, applyLocalOptions, canAddOption, cycleOptionTone, moveOption, nextTone, optionKey, removeOption,
  renameOption,
} from "../../lib/optionsModel";
import { findDefaultCheckList, linkToList, listDraftChanged, matchesName, sameOptions } from "../../lib/libraryModel";
import type { LibraryWriteError, LinkedPlace, ListDraft } from "../../lib/libraryModel";
import { useDraftStore } from "../../lib/draftStore";
import { createOptionList, reachLinkedFields, saveOptionList, useOptionLists } from "../../lib/useLibrary";
import "./editor-popovers.css";

/**
 * "אפשרויות · {field}" — the options of a choice field (artboard 4, spec §5.7): a 560 × 600 popover
 * against the row's "רשימה: …" link, the editor dimmed behind it (the app's scrim, 40%).
 *
 * Two sources, "רשימה משותפת" | "רק לשדה הזה" (the segmented control):
 *   shared  the lists column (inline-start, 200px, parchment: search "חיפוש רשימה…", "רשימות משותפות" ·
 *           "שדות", 40px rows with the linked list's Link2, "אין רשימות תואמות", "+ רשימה חדשה"), and on
 *           the other side "שם הרשימה" with its help, the chosen list's options, and the impact note.
 *           The popover opens here when the field is linked (list_ref), on that list.
 *   local   the field's own options; switching to it copies the chosen list's options (artboard 4
 *           `goLocal`) and the note names the list they came from.
 * Both edit options the same way — reorder (drag the handle, or Alt+↑/↓), quick keys 1–4, the tone
 * button cycling תקין ← אזהרה ← כשל ← ניטרלי, rename, remove, add (Enter or "הוסף"; a new option is
 * neutral) — under artboard 4's validation line (validate.ts optionListLine). Every edit is a working
 * copy; "ביטול", ×, Escape and a press outside drop it. Focus goes back to the anchor when it closes.
 *
 * "החל על השדה":
 *   local   the field with these options and WITHOUT list_ref (applyLocalOptions).
 *   shared  a list whose name or options changed is saved first — PUT …/option-lists/[id] (a new
 *           version; 409 VERSION_CONFLICT → "טען מחדש"), or POST for a new list — then the field is
 *           linked (list_ref {id, ver} and a copy of the options), then the list's other linked fields
 *           take the new version in their drafts (useLibrary.reachLinkedFields: the screen's own routes
 *           locally, the rest through POST …/propagate), so the map marks them "שינוי שלא פורסם".
 * "שמור כרשימה חדשה…" starts a new list from the options on screen: name it, then "החל על השדה".
 *
 * Opened from the library (`library`, no field): the shared side alone — the list's name, options and
 * impact note — and its own save ("שמירה כגרסה {v+1}", or for a new list an undrawn one).
 *
 * The anchor carries aria-haspopup="dialog", aria-expanded and aria-controls={OPTION_LIST_POPOVER_ID}
 * (the editor's link button; artboard 4).
 */

/** The popover body's id — the anchor's aria-controls (artboard 4: `opt-pop`). */
export const OPTION_LIST_POPOVER_ID = "rf-option-list";

type ChoiceField = ChoiceRowField | MultiChoiceField;

/** Where the options come from (artboard 4's segmented control). */
type OptionsSource = "shared" | "local";

/** The chosen list: a saved one by id, or the new list being named. */
const NEW = "new" as const;
type ListKey = number | typeof NEW;

type BaseProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The row's "רשימה: …" link; the popover opens beside it (artboard 4: at its inline-end side). */
  anchorRef: React.RefObject<HTMLElement | null>;
};

type FieldModeProps = {
  field: ChoiceField;
  /** "{station}" and "{item}" of "אפשרויות מקומיות · {station} · {item}" — the editor's column and row
   *  (in a field set: the set's name, and ""). */
  stationLabel: string;
  rowLabel: string;
  onApply(next: ChoiceField): void;
  library?: undefined;
};

type LibraryModeProps = {
  field?: undefined;
  /** Opened from the library: edit the list `listId`, or a new list (null); `onSaved` gets its id. */
  library: { listId: number | null; onSaved(listId: number): void };
};

export type OptionListPopoverProps = BaseProps & (FieldModeProps | LibraryModeProps);

export function OptionListPopover(props: OptionListPopoverProps) {
  const { open, onOpenChange, anchorRef } = props;
  const titleId = React.useId();
  const firstFocusRef = React.useRef<HTMLInputElement | null>(null);

  return (
    <>
      {open && typeof document !== "undefined" && createPortal(<div className="rf-olp-scrim" aria-hidden="true" />, document.body)}
      <AnchoredPopover
        open={open}
        onOpenChange={onOpenChange}
        anchorRef={anchorRef}
        side="left"
        align="center"
        sideOffset={14}
        className="rf-olp"
        aria-labelledby={titleId}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          firstFocusRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          // Behind a scrim every way out hands focus back to the link that opened it.
          e.preventDefault();
          anchorRef.current?.focus();
        }}
        onInteractOutside={(e) => {
          // A press on the anchor is its own toggle: closing here would reopen it on the click.
          const target = e.target;
          if (target instanceof Node && anchorRef.current?.contains(target)) e.preventDefault();
        }}
      >
        {props.field ? (
          <OptionListBody
            titleId={titleId}
            firstFocusRef={firstFocusRef}
            field={props.field}
            stationLabel={props.stationLabel}
            rowLabel={props.rowLabel}
            library={null}
            onClose={() => onOpenChange(false)}
            onApply={props.onApply}
            onSaved={() => {}}
          />
        ) : (
          <OptionListBody
            titleId={titleId}
            firstFocusRef={firstFocusRef}
            field={null}
            stationLabel=""
            rowLabel=""
            library={props.library ?? null}
            onClose={() => onOpenChange(false)}
            onApply={() => {}}
            onSaved={(id) => props.library?.onSaved(id)}
          />
        )}
      </AnchoredPopover>
    </>
  );
}

type DragState = { from: number; over: number | null; place: "before" | "after" };

/** The drag payload's type: an option id, private to this list. */
const OPTION_DRAG_TYPE = "application/x-rf-option";

/** A write that did not go through, and what its action does. */
type PopoverError = { text: string; action: "retry" | "reload" | "propagate" };

const copyOptions = (options: readonly ChoiceOption[]) => options.map((o) => ({ ...o }));

function errorOf(e: LibraryWriteError, creating: boolean): PopoverError {
  if (e.kind === "conflict") return { text: LIBRARY_UNDRAWN_TEXT.listConflict, action: "reload" };
  return { text: creating ? LIBRARY_UNDRAWN_TEXT.createFailed : LIBRARY_UNDRAWN_TEXT.saveFailed, action: "retry" };
}

/**
 * The popover's content. Mounted on every opening, so the working copies start from the field.
 * `onApply` hands the field back without closing (the list's other linked fields are reached after
 * it, and a failure there keeps the popover open); `onClose` closes once all is done.
 */
function OptionListBody({
  titleId, firstFocusRef, field, stationLabel, rowLabel, library, onClose, onApply, onSaved,
}: {
  titleId: string;
  firstFocusRef: React.RefObject<HTMLInputElement | null>;
  field: ChoiceField | null;
  stationLabel: string;
  rowLabel: string;
  library: LibraryModeProps["library"] | null;
  onClose: () => void;
  onApply: (next: ChoiceField) => void;
  onSaved: (listId: number) => void;
}) {
  const store = useDraftStore();
  const listsData = useOptionLists();
  const lists = listsData.data;
  const linkedId = field?.list_ref?.id ?? null;
  const fieldName = field?.label.trim() ?? "";

  // ---- state --------------------------------------------------------------------------------------
  const [source, setSource] = React.useState<OptionsSource>(() => (field && !field.list_ref ? "local" : "shared"));
  /** The field's own options ("רק לשדה הזה"); null until the field has any in this popover. */
  const [local, setLocal] = React.useState<ChoiceOption[] | null>(() => (field && !field.list_ref ? copyOptions(field.options) : null));
  /** The list the local options were copied from (artboard 4 `localFrom`). */
  const [localFrom, setLocalFrom] = React.useState<string | null>(null);
  /** The list chosen in the column; null = the linked one, else "תקינות כללית", else the first. */
  const [selected, setSelected] = React.useState<ListKey | null>(() => (field ? linkedId : library?.listId ?? NEW));
  /** Working copies of saved lists edited here, by id. */
  const [drafts, setDrafts] = React.useState<Readonly<Record<number, ListDraft>>>({});
  /** The new list being named ("+ רשימה חדשה", "שמור כרשימה חדשה…"). */
  const [newDraft, setNewDraft] = React.useState<ListDraft | null>(() => (!field && library?.listId == null ? { name: "", options: [] } : null));
  const [query, setQuery] = React.useState("");
  const [addText, setAddText] = React.useState("");
  /** The row whose handle is pressed: only that row is draggable, so text in the inputs stays selectable. */
  const [armed, setArmed] = React.useState<number | null>(null);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<PopoverError | null>(null);
  /** The list's name was left empty (blur, or "החל" pressed): only then is it marked. */
  const [nameTouched, setNameTouched] = React.useState(false);
  /** A saved list whose other linked fields are still to be reached (the propagate failed). */
  const [pendingReach, setPendingReach] = React.useState<{ list: { id: number; version: number; options: ChoiceOption[] }; linked: LinkedPlace[] } | null>(null);
  const addRef = React.useRef<HTMLInputElement>(null);
  const nameRef = React.useRef<HTMLInputElement | null>(null);
  const removeRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const nameId = React.useId();
  const helpId = React.useId();

  // ---- the chosen list ------------------------------------------------------------------------------
  const autoPick = (all: readonly OptionListJson[] | null): ListKey | null =>
    linkedId != null && all?.some((l) => l.id === linkedId) ? linkedId : (findDefaultCheckList(all)?.id ?? all?.[0]?.id ?? null);
  const sel: ListKey | null = selected ?? (newDraft ? NEW : autoPick(lists));
  const selList = typeof sel === "number" ? lists?.find((l) => l.id === sel) ?? null : null;
  const selDraft: ListDraft | null = sel === NEW ? newDraft : selList ? drafts[selList.id] ?? { name: selList.name, options: selList.options } : null;
  const isLinked = selList != null && selList.id === linkedId;

  const shown: ChoiceOption[] = source === "local" ? local ?? [] : selDraft?.options ?? [];
  const editDraft = (patch: Partial<ListDraft>) => {
    if (sel === NEW) setNewDraft((d) => ({ name: "", options: [], ...d, ...patch }));
    else if (selList) setDrafts((d) => ({ ...d, [selList.id]: { ...(d[selList.id] ?? { name: selList.name, options: selList.options }), ...patch } }));
  };
  const setShown = (next: ChoiceOption[]) => {
    if (source === "local") setLocal(next);
    else editDraft({ options: next });
  };

  const line = optionListLine(shown);
  const roomForMore = canAddOption(shown);
  const editable = source === "local" || selDraft != null;
  const focusName = source === "shared" && sel === NEW;

  // ---- source -------------------------------------------------------------------------------------
  const goShared = () => {
    setSource("shared");
    setError(null);
  };
  const goLocal = () => {
    if (source === "local") return;
    setError(null);
    if (local) {
      setSource("local");
      return;
    }
    setLocal(copyOptions(selDraft?.options ?? field?.options ?? []));
    setLocalFrom(selDraft ? selDraft.name.trim() || LIBRARY_TEXT.unnamedList : null);
    setSource("local");
  };

  /** A new list from `options`, chosen, its name to type. */
  const startNewList = (options: readonly ChoiceOption[]) => {
    flushSync(() => {
      setNewDraft({ name: "", options: copyOptions(options) });
      setNameTouched(false);
      setSelected(NEW);
      setSource("shared");
      setError(null);
    });
    nameRef.current?.focus();
  };

  // ---- option edits -------------------------------------------------------------------------------
  const add = () => {
    const next = addOption(shown, addText, () => newOptionId());
    if (next.length === shown.length) return;
    setShown(next);
    setAddText("");
  };

  const remove = (index: number) => {
    // Focus moves to the × of the option that takes its place, else the one before, else the add field.
    const neighbour = shown[index + 1] ?? shown[index - 1];
    setShown(removeOption(shown, index));
    const el = neighbour ? removeRefs.current.get(neighbour.id) : null;
    (el ?? addRef.current)?.focus();
  };

  /** Alt+↑ / Alt+↓ anywhere in a row moves its option; focus stays on the control it was on. */
  const onRowKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const to = index + (e.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= shown.length) return;
    e.preventDefault();
    const focused = e.target as HTMLElement;
    flushSync(() => setShown(moveOption(shown, index, to)));
    focused.focus();
  };

  const endDrag = () => {
    setDrag(null);
    setArmed(null);
  };

  const dropAt = (index: number) => {
    if (!drag) return;
    const place = drag.over === index ? drag.place : "before";
    let to = place === "before" ? index : index + 1;
    if (drag.from < to) to -= 1;
    setShown(moveOption(shown, drag.from, to));
    endDrag();
  };

  // ---- apply --------------------------------------------------------------------------------------
  const nameMissing = source === "shared" && selDraft != null && selDraft.name.trim() === "";
  const canApply = !busy && (source === "local" ? field != null : selDraft != null && !nameMissing);

  /** The list's other linked fields take its new version (drafts only). false when the propagate failed. */
  const reach = async (list: { id: number; version: number; options: ChoiceOption[] }, linked: LinkedPlace[]): Promise<boolean> => {
    const r = await reachLinkedFields(store, list, linked);
    if (r.ok) {
      setPendingReach(null);
      return true;
    }
    setPendingReach({ list, linked });
    setError({ text: LIBRARY_UNDRAWN_TEXT.updateFailed, action: "propagate" });
    return false;
  };

  /** The field linked to `list` (field mode) or the list reported saved (library mode), then close. */
  const finish = (list: { id: number; version: number; options: ChoiceOption[] }, linkField: boolean) => {
    if (field && linkField) onApply(linkToList(field, list));
    if (!field) onSaved(list.id);
    onClose();
  };

  const apply = async () => {
    if (nameMissing) setNameTouched(true);
    if (!canApply) return;
    if (source === "local") {
      if (field) onApply(applyLocalOptions(field, local ?? []));
      onClose();
      return;
    }
    if (!selDraft) return;
    setBusy(true);
    setError(null);
    try {
      if (sel === NEW) {
        const r = await createOptionList({ name: selDraft.name.trim(), options: copyOptions(selDraft.options) });
        if (!r.ok) {
          setError(errorOf(r.error, true));
          return;
        }
        void listsData.reload();
        finish({ id: r.data.id, version: r.data.version, options: r.data.options }, true);
        return;
      }
      if (!selList) return;
      if (!listDraftChanged(selList, selDraft)) {
        finish({ id: selList.id, version: selList.version, options: selList.options }, true);
        return;
      }
      const options = copyOptions(selDraft.options);
      const r = await saveOptionList(selList.id, { name: selDraft.name.trim(), options, base_version: selList.version });
      if (!r.ok) {
        setError(errorOf(r.error, false));
        return;
      }
      const saved = { id: selList.id, version: r.data.version, options };
      // The field first, at once (the editor's rows are as this popover found them): the other
      // linked fields of its own route then build on it.
      if (field) onApply(linkToList(field, saved));
      void listsData.reload();
      // A new name alone changes nothing a field holds (list_ref carries no name): no drafts for it.
      if (sameOptions(selList.options, options) || (await reach(saved, r.data.linked))) finish(saved, false);
    } finally {
      setBusy(false);
    }
  };

  const onErrorAction = async () => {
    if (!error) return;
    if (error.action === "reload") {
      // Take the list as the server has it now; this popover's edits of it go.
      if (typeof sel === "number") setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => Number(k) !== sel)));
      setError(null);
      await listsData.reload();
      return;
    }
    if (error.action === "propagate" && pendingReach) {
      setBusy(true);
      setError(null);
      try {
        if (await reach(pendingReach.list, pendingReach.linked)) finish(pendingReach.list, false);
      } finally {
        setBusy(false);
      }
      return;
    }
    await apply();
  };

  // ---- the lists column ---------------------------------------------------------------------------
  const nameOf = (l: OptionListJson) => drafts[l.id]?.name ?? l.name;
  const rows = (lists ?? []).filter((l) => matchesName(nameOf(l), query));
  const showNew = newDraft != null && matchesName(newDraft.name, query);
  const libraryMode = field == null;
  const listColumn = !libraryMode && source === "shared";

  const primaryText = !libraryMode
    ? OPTION_LIST_TEXT.apply
    : sel === NEW
      ? LIBRARY_UNDRAWN_TEXT.saveAsNewList
      : saveAsVersionText((selList?.version ?? 0) + 1);
  const title = libraryMode ? optionListTitle(selDraft?.name ?? "") : optionListTitle(field.label);

  return (
    <div id={OPTION_LIST_POPOVER_ID} className="rf-olp__frame">
      <div className="rf-olp__head">
        <h2 id={titleId} className="rf-olp__title">{title}</h2>
        {!libraryMode && (
          <div role="group" aria-label={OPTION_LIST_TEXT.sourceGroup} className="rf-olp__seg">
            <button type="button" className="rf-olp__seg-btn" aria-pressed={source === "shared"} onClick={goShared}>
              <Link2 size={14} strokeWidth={1.75} aria-hidden />
              {OPTION_LIST_TEXT.shared}
            </button>
            <button type="button" className="rf-olp__seg-btn" aria-pressed={source === "local"} onClick={goLocal}>
              {OPTION_LIST_TEXT.local}
            </button>
          </div>
        )}
        <IconButton size="small" className="rf-olp__close" aria-label={OPTION_LIST_TEXT.close} onClick={onClose}>
          <X size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </div>

      <div className="rf-olp__body">
        {listColumn && (
          <div className="rf-olp__lists">
            <div className="rf-olp__search">
              <Search size={15} strokeWidth={1.75} className="rf-olp__search-icon" aria-hidden />
              <input
                type="search"
                className="sh-input rf-olp__search-input"
                aria-label={SHARED_LIST_TEXT.searchLabel}
                placeholder={SHARED_LIST_TEXT.searchPlaceholder}
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="rf-olp__lists-head" aria-hidden="true">
              <span>{SHARED_LIST_TEXT.colLists}</span>
              <span>{SHARED_LIST_TEXT.colFields}</span>
            </div>
            <div role="group" aria-label={SHARED_LIST_TEXT.groupLabel} className="rf-olp__lists-rows">
              {listsData.state.status === "loading" && [0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={40} width="100%" />)}
              {listsData.state.status === "error" && (
                <div className="rf-olp__lists-error">
                  <span>{LIBRARY_UNDRAWN_TEXT.loadFailed}</span>
                  <Button variant="text" size="small" loading={listsData.state.retrying} onClick={() => void listsData.reload()}>
                    {LIBRARY_UNDRAWN_TEXT.retry}
                  </Button>
                </div>
              )}
              {rows.map((l) => {
                const name = nameOf(l).trim() || LIBRARY_TEXT.unnamedList;
                return (
                  <button
                    key={l.id}
                    type="button"
                    className="rf-olp__list-row"
                    aria-pressed={sel === l.id}
                    aria-label={sharedListRowLabel(name, l.usage.fields)}
                    onClick={() => {
                      setSelected(l.id);
                      setError(null);
                    }}
                  >
                    <span className="rf-olp__list-name">{name}</span>
                    {l.id === linkedId && (
                      <span className="rf-olp__list-link" title={linkedToFieldTitle(fieldName)}>
                        <Link2 size={13} strokeWidth={1.75} aria-hidden />
                      </span>
                    )}
                    <span className="rf-olp__list-count" dir="ltr">{l.usage.fields}</span>
                  </button>
                );
              })}
              {showNew && newDraft && (
                <button
                  type="button"
                  className="rf-olp__list-row"
                  aria-pressed={sel === NEW}
                  aria-label={sharedListRowLabel(newDraft.name.trim() || LIBRARY_TEXT.unnamedList, 0)}
                  onClick={() => setSelected(NEW)}
                >
                  <span className="rf-olp__list-name">{newDraft.name.trim() || LIBRARY_TEXT.unnamedList}</span>
                  <span className="rf-olp__list-count" dir="ltr">0</span>
                </button>
              )}
              {listsData.state.status === "ready" && rows.length === 0 && !showNew && (
                <span className="rf-olp__nomatch">{SHARED_LIST_TEXT.noMatch}</span>
              )}
            </div>
            <Button
              variant="text"
              size="small"
              className="rf-olp__newlist"
              startIcon={<Plus size={16} strokeWidth={1.75} aria-hidden />}
              onClick={() => startNewList([])}
            >
              {SHARED_LIST_TEXT.newList}
            </Button>
          </div>
        )}

        <div className="rf-olp__main">
          {source === "shared" && selDraft && (
            <div className="rf-olp__name">
              <label htmlFor={nameId} className="rf-olp__name-label">{SHARED_LIST_TEXT.nameLabel}</label>
              <input
                id={nameId}
                ref={(el) => {
                  nameRef.current = el;
                  if (focusName) firstFocusRef.current = el;
                }}
                className={cn("sh-input rf-olp__name-input", nameMissing && nameTouched && "sh-input--error")}
                autoComplete="off"
                maxLength={100}
                value={selDraft.name}
                aria-invalid={(nameMissing && nameTouched) || undefined}
                onBlur={() => setNameTouched(true)}
                aria-describedby={libraryMode ? undefined : helpId}
                onChange={(e) => editDraft({ name: e.target.value })}
              />
              {!libraryMode && (
                <span id={helpId} className="rf-olp__help">
                  {isLinked && <Link2 size={12} strokeWidth={1.75} className="rf-olp__help-icon" aria-hidden />}
                  {isLinked && selList ? linkedHelpText(selList.version) : willLinkHelpText(fieldName)}
                </span>
              )}
            </div>
          )}

          {source === "local" && field && (
            <div className="rf-olp__local">
              <span className="rf-olp__local-title">{localOptionsTitleOf([stationLabel, rowLabel])}</span>
              {localFrom != null && <span className="rf-olp__local-note">{localOptionsNote(fieldName, localFrom)}</span>}
            </div>
          )}

          {editable && (
            <div className="rf-olp__opts">
              <div className="rf-olp__opts-head">
                <span className="rf-olp__opts-count">{optionsCountText(shown.length, source === "local")}</span>
                <span className="rf-olp__opts-keys">
                  {OPTION_LIST_TEXT.keysLead}
                  <span dir="ltr" className="rf-ltr">{OPTION_LIST_TEXT.keysRange}</span>
                  {OPTION_LIST_TEXT.keysTail}
                </span>
              </div>

              <div role="list" aria-label={OPTION_LIST_TEXT.list} className="rf-olp__list">
                {shown.map((o, i) => {
                  const key = optionKey(i);
                  const empty = !o.label.trim();
                  return (
                    <div
                      key={o.id}
                      role="listitem"
                      aria-label={optionRowLabel(i, o.label, o.tone)}
                      className="rf-olp__row"
                      draggable={armed === i}
                      data-dragging={drag?.from === i || undefined}
                      data-drop={drag && drag.over === i && drag.from !== i ? drag.place : undefined}
                      onKeyDown={onRowKeyDown(i)}
                      onDragStart={(e) => {
                        if (armed !== i) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.effectAllowed = "move";
                        // Some data is required to start a drag (Firefox); not text, so no input accepts it.
                        e.dataTransfer.setData(OPTION_DRAG_TYPE, o.id);
                        setDrag({ from: i, over: null, place: "before" });
                      }}
                      // The row is the drop target wherever the pointer enters it (HTML drag and drop):
                      // without this a drop on its handle or tone button — the column the handle is
                      // dragged down — falls through to the page and nothing moves.
                      onDragEnter={(e) => {
                        if (drag) e.preventDefault();
                      }}
                      onDragOver={(e) => {
                        if (!drag) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        const box = e.currentTarget.getBoundingClientRect();
                        const place = e.clientY < box.top + box.height / 2 ? "before" : "after";
                        if (drag.over !== i || drag.place !== place) setDrag({ ...drag, over: i, place });
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        dropAt(i);
                      }}
                      onDragEnd={endDrag}
                    >
                      <button
                        type="button"
                        className="rf-olp__drag"
                        aria-label={optionDragLabel(o.label)}
                        onPointerDown={() => setArmed(i)}
                        onPointerUp={() => { if (!drag) setArmed(null); }}
                      >
                        <GripVertical size={16} strokeWidth={1.75} aria-hidden />
                      </button>
                      <span className={cn("rf-olp__key", key == null && "rf-olp__key--none")} title={optionKeyTitle(i)} dir="ltr">
                        {key ?? OPTION_LIST_TEXT.noKey}
                      </span>
                      <button
                        type="button"
                        className="rf-olp__tone"
                        title={OPTION_LIST_TEXT.toneTitle}
                        aria-label={toneButtonLabel(o.tone, nextTone(o.tone))}
                        onClick={() => setShown(cycleOptionTone(shown, i))}
                      >
                        <span className="rf-olp__dot" data-tone={o.tone} />
                      </button>
                      <input
                        ref={i === 0 && !focusName ? firstFocusRef : undefined}
                        className={cn("sh-input rf-olp__label", empty && "sh-input--error")}
                        aria-label={optionNameLabel(i)}
                        aria-invalid={empty || undefined}
                        dir="auto"
                        autoComplete="off"
                        value={o.label}
                        maxLength={LIMITS.optionLabel}
                        onChange={(e) => setShown(renameOption(shown, i, e.target.value))}
                      />
                      <span className="rf-olp__word">{TONE_WORD[o.tone]}</span>
                      <IconButton
                        ref={(el: HTMLButtonElement | null) => {
                          if (el) removeRefs.current.set(o.id, el);
                          else removeRefs.current.delete(o.id);
                        }}
                        size="small"
                        className="rf-olp__remove"
                        aria-label={optionRemoveLabel(o.label)}
                        onClick={() => remove(i)}
                      >
                        <X size={16} strokeWidth={1.75} aria-hidden />
                      </IconButton>
                    </div>
                  );
                })}
              </div>

              <div className="rf-olp__add">
                <div className="rf-olp__add-box">
                  <Plus size={16} strokeWidth={1.75} className="rf-olp__add-icon" aria-hidden />
                  <input
                    ref={(el) => {
                      addRef.current = el;
                      if (shown.length === 0 && !focusName) firstFocusRef.current = el;
                    }}
                    className="sh-input rf-olp__add-input"
                    aria-label={OPTION_LIST_TEXT.addLabel}
                    placeholder={OPTION_LIST_TEXT.addPlaceholder}
                    autoComplete="off"
                    value={addText}
                    maxLength={LIMITS.optionLabel}
                    disabled={!roomForMore}
                    onChange={(e) => setAddText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                      e.preventDefault();
                      add();
                    }}
                  />
                </div>
                {addText.trim() && roomForMore && (
                  <Button size="small" onClick={add}>{OPTION_LIST_TEXT.add}</Button>
                )}
              </div>

              <span role="status" className="rf-olp__status" data-level={line.level}>
                {line.level === "ok"
                  ? <CircleCheck size={14} strokeWidth={1.75} aria-hidden />
                  : <CircleAlert size={14} strokeWidth={1.75} aria-hidden />}
                {line.text}
              </span>
            </div>
          )}

          {source === "shared" && selList && (
            <div role="note" className="rf-olp__impact">
              <Info size={16} strokeWidth={1.75} className="rf-olp__impact-icon" aria-hidden />
              <span>{sharedImpactText(selList.usage.fields, selList.usage.routes)}</span>
            </div>
          )}

          {error && (
            <div role="alert" className="rf-olp__error">
              <CircleAlert size={14} strokeWidth={1.75} aria-hidden />
              <span>{error.text}</span>
              <Button variant="text" size="small" color="inherit" disabled={busy} onClick={() => void onErrorAction()}>
                {error.action === "reload" ? LIBRARY_UNDRAWN_TEXT.conflictReload : LIBRARY_UNDRAWN_TEXT.retry}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="rf-olp__foot">
        {editable && !(libraryMode && sel === NEW) && (
          <Button
            variant="text"
            size="small"
            className="rf-olp__save-new"
            disabled={busy}
            startIcon={<ListPlus size={16} strokeWidth={1.75} aria-hidden />}
            onClick={() => startNewList(shown)}
          >
            {SHARED_LIST_TEXT.saveAsNew}
          </Button>
        )}
        <div className="rf-olp__foot-end">
          <Button variant="outlined" color="inherit" size="small" disabled={busy} onClick={onClose}>{OPTION_LIST_TEXT.cancel}</Button>
          <Button size="small" loading={busy} aria-disabled={!canApply || undefined} onClick={() => void apply()}>
            {primaryText}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default OptionListPopover;
