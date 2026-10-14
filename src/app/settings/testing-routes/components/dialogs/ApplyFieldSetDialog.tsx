"use client";
import * as React from "react";
import { Check, CircleAlert, Eye, Library, Link2, Package, Search, TriangleAlert, X } from "lucide-react";
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Tag,
} from "@/components/ui";
import type { FieldSetJson, FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { PASS_FAIL_WORD } from "@/app/lib/station-fields/labels";
import type { Field, Tone, VersionRef } from "@/app/lib/station-fields/schema";
import { currentConfigs } from "../../lib/draftModel";
import { useDraftSnapshot, useDraftStore } from "../../lib/draftStore";
import type { FieldsMapModel, MapCell } from "../../lib/mapModel";
import type { PasteCounts } from "../../lib/bulkModel";
import {
  APPLY_SET_MODES, applyFieldSet, applyPreview, cellStations, duplicateLines, initialSetId, showsPackageNote, targetChips,
  visibleSets,
} from "../../lib/applySetModel";
import type { ApplySetMode } from "../../lib/applySetModel";
import { setCounts } from "../../lib/libraryModel";
import { setRowLine, versionText } from "../../lib/libraryLabels";
import { rowNameText } from "../../lib/labels";
import {
  APPLY_SET_UNDRAWN_TEXT, APPLY_SET_TEXT, applyButtonText, applySubText, applyTitleText, fieldMetaText, previewCountText,
  previewTitleText,
} from "../../lib/applySetLabels";
import { useFieldSets, useOptionLists } from "../../lib/useLibrary";
import "@/app/packages/packages.css";
import "./apply-set-dialog.css";

/**
 * "החלת ערכת שדות · {n} תאים" — the apply-set dialog (artboard 9, route-fields spec §5.10; D8).
 * Opened from the map's selection bar ("החל ערכת שדות…"), the cell editor's ⋯ ("החל ערכה…", one
 * cell) and the onboarding card ("החל ערכת שדות…"); the library's "החל על תאים…" preselects its set
 * for the next opening (page.tsx).
 *
 * Dialog maxWidth "sm", aria-modal, aria-describedby the sub-line. Top to bottom:
 *   head      the title (20/600), the sub-line "{route} · עמדת {station}" (13 muted), × "סגירה";
 *   ערכת שדות the 44px pill search (type="search", "חיפוש ערכה…") and the radiogroup "בחירת ערכה" of
 *             56px .pkg-choice cards — name, "{N} שדות · בשימוש ב-{n} תאים", Tag "גרסה {v}" from
 *             version 2 on; "אין ערכות תואמות. …" when the search leaves none;
 *   preview   pearl, radius 11: "מה יתווסף לכל תא · {set}" / "מה יהיה בכל תא · {set}" and "{n} שדות ·
 *             קריאה בלבד"; a white card per field — name, Tag "חובה", Tag "יידלג" (skipped in every
 *             cell), the meta "רשימה: {list} · הערות: {mode}", the options with their tone dots;
 *   יעד       a chip per cell "{station} · {seq} {item}[ ×{qty}]", and the package-level note;
 *   אופן ההחלה the radiogroup (auto-fit minmax 220): "הוסף לשדות הקיימים" (default) / "החלף את השדות
 *             בתא" + the warning bar (role="alert");
 *   the checkbox "השאר מקושר לערכה — עדכונים יוצעו לאישור" (on) with its two help lines, and in add
 *             mode the duplicate lines "שדה '{f}' כבר קיים ב'{place}' — יידלג כדי למנוע כפילות";
 *   footer    ghost "ספריית הערכות" (→ the library on the chosen set), "ביטול", primary "החל על {n}
 *             תאים".
 * The radiogroups move and choose with the arrows (roving tabindex), as the publish dialog's.
 *
 * "החל" is applySetModel.applyFieldSet on the draft store — ONE store.edit per route touched, each
 * route then autosaves — and the dialog closes; the map shows the cells as "שינוי שלא פורסם". The set
 * applied is the library's saved version (an unsaved working copy in the library does not count).
 *
 * Each opening is a session of its own (keyed): the choices start fresh, and it stays mounted after
 * closing so the exit animation keeps its content.
 */

export type ApplyFieldSetDialogProps = {
  open: boolean;
  /** The cells to apply to, as chosen (the selection, the editor's cell, the onboarding's column). */
  cells: readonly MapCell[];
  /** The fields context on screen (the sub-line's route). */
  context: FieldsContextJson;
  /** The map built from it (useFieldsMap): the chips' rows and stations. */
  model: FieldsMapModel;
  /** The set to start on (the library's "החל על תאים…"); else the first set. */
  preferredSetId?: number | null;
  onClose: () => void;
  /** After the edits; the dialog has closed. */
  onApplied?: (counts: PasteCounts, setId: number) => void;
  /** "ספריית הערכות": the library's sets, on the chosen set. The dialog has closed. */
  onOpenLibrary: (setId: number | null) => void;
};

export default function ApplyFieldSetDialog(props: ApplyFieldSetDialogProps) {
  const { open } = props;
  // A new session per opening: the previous one's choices never leak into the next.
  const [session, setSession] = React.useState(0);
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((s) => s + 1);
  }
  return session > 0 ? <ApplySession key={session} {...props} /> : null;
}

/** Arrow keys inside a radiogroup: the next / previous radio is chosen and focused (down and left
 *  forward, up and right back — the publish dialog's mapping, right-to-left). */
function radioStep(e: React.KeyboardEvent): -1 | 0 | 1 {
  if (e.altKey || e.ctrlKey || e.metaKey) return 0;
  if (e.key === "ArrowDown" || e.key === "ArrowLeft") return 1;
  if (e.key === "ArrowUp" || e.key === "ArrowRight") return -1;
  return 0;
}

const MODE_TEXT: Record<ApplySetMode, { label: string; sub: string }> = {
  add: { label: APPLY_SET_TEXT.modeAdd, sub: APPLY_SET_TEXT.modeAddSub },
  replace: { label: APPLY_SET_TEXT.modeReplace, sub: APPLY_SET_TEXT.modeReplaceSub },
};

function ApplySession({ open, cells, context, model, preferredSetId, onClose, onApplied, onOpenLibrary }: ApplyFieldSetDialogProps) {
  const store = useDraftStore();
  const { model: drafts } = useDraftSnapshot();
  const sets = useFieldSets();
  const lists = useOptionLists().data;
  const { reload: reloadSets } = sets;
  // The sets of now: their usage moved with every apply and autosave since the page read them.
  React.useEffect(() => {
    void reloadSets();
  }, [reloadSets]);

  const all = React.useMemo(() => sets.data ?? [], [sets.data]);
  const [chosen, setChosen] = React.useState<number | null>(null);
  const setId = chosen != null && all.some((s) => s.id === chosen) ? chosen : initialSetId(all, preferredSetId);
  const set = all.find((s) => s.id === setId) ?? null;
  const [query, setQuery] = React.useState("");
  const [mode, setMode] = React.useState<ApplySetMode>("add");
  const [linked, setLinked] = React.useState(true);
  const visible = visibleSets(all, query);

  const configs = React.useMemo(() => currentConfigs(drafts), [drafts]);
  const preview = React.useMemo(() => (set ? applyPreview(configs, cells, set.fields, mode) : null), [configs, cells, set, mode]);
  const dupLines = React.useMemo(() => (preview ? duplicateLines(model, preview) : []), [model, preview]);
  const chips = React.useMemo(() => targetChips(model, cells), [model, cells]);
  const sub = applySubText(context.subject.desc.trim(), context.subject.route_number, cellStations(model, cells));
  const packageNote = showsPackageNote(cells);

  const baseId = React.useId();
  const subId = baseId + "-sub";
  const searchId = baseId + "-search";
  const modeLabelId = baseId + "-mode";
  const linkedLabelId = baseId + "-linked";
  const linkedHelpId = baseId + "-linked-help";
  const cardRefs = React.useRef(new Map<number, HTMLButtonElement>());
  const modeRefs = React.useRef(new Map<ApplySetMode, HTMLButtonElement>());

  // ui/Dialog names no description: the sub-line describes the dialog (artboard 9: aria-modal,
  // aria-describedby="afs-sub").
  const subRef = React.useCallback((el: HTMLParagraphElement | null) => {
    const dialog = el?.closest('[role="dialog"]');
    if (!el || !dialog) return;
    dialog.setAttribute("aria-describedby", el.id);
    dialog.setAttribute("aria-modal", "true");
  }, []);

  const listName = (ref: VersionRef) => lists?.find((l) => l.id === ref.id)?.name ?? null;

  const apply = () => {
    if (!set || cells.length === 0) return;
    const counts = applyFieldSet((routeId, mutate) => store.edit(routeId, mutate), { set, cells, mode, linked });
    onClose();
    onApplied?.(counts, set.id);
  };

  const openLibrary = () => {
    onClose();
    onOpenLibrary(setId);
  };

  // ---- the set cards: one tab stop, the arrows move and choose -------------------------------------
  const tabSetId = visible.some((s) => s.id === setId) ? setId : visible[0]?.id ?? null;
  const onCardKey = (e: React.KeyboardEvent, i: number) => {
    const step = radioStep(e);
    if (!step || visible.length === 0) return;
    e.preventDefault();
    const next = visible[(i + step + visible.length) % visible.length];
    setChosen(next.id);
    cardRefs.current.get(next.id)?.focus();
  };
  const onModeKey = (e: React.KeyboardEvent, i: number) => {
    const step = radioStep(e);
    if (!step) return;
    e.preventDefault();
    const next = APPLY_SET_MODES[(i + step + APPLY_SET_MODES.length) % APPLY_SET_MODES.length];
    setMode(next);
    modeRefs.current.get(next)?.focus();
  };

  const setsBody = (): React.ReactNode => {
    if (sets.state.status === "loading") {
      return (
        <div className="rf-afs__state" aria-busy="true">
          <CircularProgress size={24} />
        </div>
      );
    }
    if (sets.state.status === "error") {
      return (
        <Alert
          severity="error"
          action={(
            <Button variant="text" size="small" color="inherit" disabled={sets.state.retrying} onClick={() => void reloadSets()}>
              {APPLY_SET_UNDRAWN_TEXT.retry}
            </Button>
          )}
        >
          {APPLY_SET_UNDRAWN_TEXT.loadFailed}
        </Alert>
      );
    }
    if (visible.length === 0) return <div className="rf-afs__none">{APPLY_SET_TEXT.noMatches}</div>;
    return visible.map((s, i) => (
      <SetCard
        key={s.id}
        set={s}
        checked={s.id === setId}
        tabbable={s.id === tabSetId}
        refCb={(el) => {
          if (el) cardRefs.current.set(s.id, el);
          else cardRefs.current.delete(s.id);
        }}
        onPick={() => setChosen(s.id)}
        onKeyDown={(e) => onCardKey(e, i)}
      />
    ));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ className: "rf-afs" }}>
      <div className="rf-afs__head">
        <div className="rf-afs__head-main">
          <DialogTitle className="rf-afs__title">{applyTitleText(cells.length)}</DialogTitle>
          <p id={subId} ref={subRef} className="rf-afs__sub">{sub}</p>
        </div>
        <IconButton className="rf-afs__close" aria-label={APPLY_SET_TEXT.close} onClick={onClose}>
          <X size={20} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </div>

      <DialogContent className="rf-afs__body">
        {/* ערכת שדות */}
        <div className="rf-afs__section">
          <label htmlFor={searchId} className="rf-afs__label">{APPLY_SET_TEXT.searchLabel}</label>
          <div className="rf-afs__search">
            <Search className="rf-afs__search-icon" size={18} strokeWidth={1.75} aria-hidden />
            <input
              id={searchId}
              type="search"
              autoFocus
              autoComplete="off"
              className="rf-afs__search-input"
              placeholder={APPLY_SET_TEXT.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div role="radiogroup" aria-label={APPLY_SET_TEXT.groupLabel} className="rf-afs__cards">
            {setsBody()}
          </div>
        </div>

        {/* the preview */}
        {set && preview && (
          <div className="rf-afs__preview">
            <div className="rf-afs__pv-head">
              <Eye size={16} strokeWidth={1.75} className="rf-afs__pv-icon" aria-hidden />
              <span className="rf-afs__pv-title">{previewTitleText(mode, set.name)}</span>
              <span className="rf-afs__pv-count">{previewCountText(preview.fieldCount)}</span>
            </div>
            {preview.rows.map(({ field, skip }) => (
              <PreviewRow key={field.id} field={field} skip={skip && mode === "add"} listName={listName} />
            ))}
          </div>
        )}

        {/* יעד */}
        <div className="rf-afs__section">
          <span className="rf-afs__label">{APPLY_SET_TEXT.targetsLabel}</span>
          <div className="rf-afs__chips">
            {chips.map((c) => (
              <span key={c.key} className="rf-afs__chip">
                {c.station} ·{" "}
                {c.seq && <span className="rf-afs__chip-muted" dir="ltr">{c.seq}</span>}
                {c.seq && " "}
                {c.item}
                {c.qty && (
                  <>
                    {" "}
                    <span className="rf-afs__chip-muted" dir="ltr">{c.qty}</span>
                  </>
                )}
              </span>
            ))}
          </div>
          {packageNote && (
            <span className="rf-afs__note">
              <Package size={14} strokeWidth={1.75} className="rf-afs__note-icon" aria-hidden />
              {APPLY_SET_TEXT.packageNote}
            </span>
          )}
        </div>

        {/* אופן ההחלה */}
        <div className="rf-afs__section">
          <span id={modeLabelId} className="rf-afs__label">{APPLY_SET_TEXT.modeLabel}</span>
          <div role="radiogroup" aria-labelledby={modeLabelId} className="rf-afs__modes">
            {APPLY_SET_MODES.map((m, i) => {
              const on = mode === m;
              return (
                <button
                  key={m}
                  ref={(el) => {
                    if (el) modeRefs.current.set(m, el);
                    else modeRefs.current.delete(m);
                  }}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  className="pkg-choice rf-afs__mode"
                  onClick={() => setMode(m)}
                  onKeyDown={(e) => onModeKey(e, i)}
                >
                  <span className="rf-afs__radio" aria-hidden="true"><span className="rf-afs__radio-dot" /></span>
                  <span className="rf-afs__mode-text">
                    <span className="rf-afs__mode-title">{MODE_TEXT[m].label}</span>
                    <span className="rf-afs__mode-sub">{MODE_TEXT[m].sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {mode === "replace" && (
            <div role="alert" className="rf-afs__warning">
              <TriangleAlert size={16} strokeWidth={1.75} className="rf-afs__warning-icon" aria-hidden />
              <span>{APPLY_SET_TEXT.replaceWarning}</span>
            </div>
          )}
        </div>

        {/* השאר מקושר + duplicates */}
        <div className="rf-afs__linked-block">
          <button
            type="button"
            role="checkbox"
            aria-checked={linked}
            aria-labelledby={linkedLabelId}
            aria-describedby={linkedHelpId}
            className="rf-afs__linked"
            onClick={() => setLinked((v) => !v)}
          >
            <span className="rf-afs__box" aria-hidden="true">
              {linked && <Check size={14} strokeWidth={3} />}
            </span>
            <span className="rf-afs__linked-text">
              <span id={linkedLabelId} className="rf-afs__linked-label">
                <Link2 size={14} strokeWidth={2} className="rf-afs__linked-icon" aria-hidden />
                {APPLY_SET_TEXT.linked}
              </span>
              <span id={linkedHelpId} className="rf-afs__linked-help">
                {linked ? APPLY_SET_TEXT.linkedHelpOn : APPLY_SET_TEXT.linkedHelpOff}
              </span>
            </span>
          </button>
          {mode === "add" && dupLines.map((line) => (
            <p key={line} className="rf-afs__dup">
              <CircleAlert size={14} strokeWidth={2} className="rf-afs__dup-icon" aria-hidden />
              <span>{line}</span>
            </p>
          ))}
        </div>
      </DialogContent>

      <DialogActions className="rf-afs__foot">
        <Button
          variant="text"
          className="rf-afs__library"
          startIcon={<Library size={18} strokeWidth={1.75} aria-hidden />}
          onClick={openLibrary}
        >
          {APPLY_SET_TEXT.library}
        </Button>
        <Button variant="outlined" color="inherit" onClick={onClose}>{APPLY_SET_TEXT.cancel}</Button>
        <Button
          startIcon={<Check size={18} strokeWidth={1.75} aria-hidden />}
          disabled={!set || cells.length === 0}
          onClick={apply}
        >
          {applyButtonText(cells.length)}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---- a set card --------------------------------------------------------------------------------------
type SetCardProps = {
  set: FieldSetJson;
  checked: boolean;
  /** The radiogroup's one tab stop. */
  tabbable: boolean;
  refCb: (el: HTMLButtonElement | null) => void;
  onPick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

/** A 56px .pkg-choice card (artboard 9): the radio, the name (14/600), "{N} שדות · בשימוש ב-{n} תאים"
 *  (12 muted), Tag "גרסה {v}" from version 2 on, the Library icon. */
function SetCard({ set, checked, tabbable, refCb, onPick, onKeyDown }: SetCardProps) {
  const counts = setCounts(set.fields);
  return (
    <button
      ref={refCb}
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={tabbable ? 0 : -1}
      className="pkg-choice rf-afs__card"
      onClick={onPick}
      onKeyDown={onKeyDown}
    >
      <span className="rf-afs__radio" aria-hidden="true"><span className="rf-afs__radio-dot" /></span>
      <span className="rf-afs__card-text">
        <span className="rf-afs__card-name">{set.name}</span>
        <span className="rf-afs__card-line">{setRowLine(counts.fields, set.usage.cells)}</span>
      </span>
      {set.version > 1 && <Tag tone="primary" className="rf-afs__card-tag">{versionText(set.version)}</Tag>}
      <Library size={18} strokeWidth={1.75} className="rf-afs__card-icon" aria-hidden />
    </button>
  );
}

// ---- a preview row ---------------------------------------------------------------------------------------
/** The options a field shows in the preview, each with its tone dot: a choice field's own; a pass /
 *  fail field's two words; a checklist's boxes (no tone). */
function previewOptions(field: Exclude<Field, { type: "section" }>): { key: string; label: string; tone: Tone | null }[] {
  switch (field.type) {
    case "choice_row":
    case "multi_choice":
      return field.options.map((o) => ({ key: o.id, label: o.label, tone: o.tone }));
    case "pass_fail":
      return [
        { key: "pass", label: PASS_FAIL_WORD.pass, tone: "pass" },
        { key: "fail", label: PASS_FAIL_WORD.fail, tone: "fail" },
      ];
    case "checklist":
      return field.items.map((it) => ({ key: it.id, label: it.label, tone: null }));
    default:
      return [];
  }
}

function PreviewRow({ field, skip, listName }: { field: Field; skip: boolean; listName: (ref: VersionRef) => string | null }) {
  if (field.type === "section") return <div className="rf-afs__pv-section">{field.label}</div>;
  const listRef = (field.type === "choice_row" || field.type === "multi_choice") ? field.list_ref : undefined;
  const opts = previewOptions(field);
  return (
    <div className="rf-afs__pv-row" data-skip={skip || undefined}>
      <div className="rf-afs__pv-top">
        <span className="rf-afs__pv-name">{rowNameText(field.label)}</span>
        {field.required && <Tag tone="danger">{APPLY_SET_TEXT.required}</Tag>}
        {skip && <Tag tone="warning">{APPLY_SET_TEXT.skip}</Tag>}
        <span className="rf-afs__pv-meta">{fieldMetaText(field, listRef ? listName(listRef) : null)}</span>
      </div>
      {opts.length > 0 && (
        <div className="rf-afs__pv-opts">
          {opts.map((o) => (
            <span key={o.key} className="rf-afs__pv-opt">
              {o.tone && <span className="rf-afs__dot" data-tone={o.tone} aria-hidden="true" />}
              {o.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
