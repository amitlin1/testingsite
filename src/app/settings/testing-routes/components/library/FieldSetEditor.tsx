"use client";
import * as React from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { Copy, Link2, ListChecks, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { Alert, Button, ConfirmDialog, IconButton, Tag } from "@/components/ui";
import type { FieldSetJson, LibraryUseJson, OptionListJson } from "@/app/lib/station-fields/admin-types";
import type { Field, FieldId, FieldType, VersionRef } from "@/app/lib/station-fields/schema";
import { lintFields } from "@/app/lib/station-fields/validate";
import { DEFAULT_IDS, newField, opensExpanded } from "../../lib/editorModel";
import type { EditorPopover } from "../../lib/editorModel";
import { useDraftStore } from "../../lib/draftStore";
import {
  hasUnnamedField, outdatedUses, setCounts, setDraftDirty, setMetaText, usageChips,
} from "../../lib/libraryModel";
import type { RouteIndexRow, SetDraft, SetOrigin } from "../../lib/libraryModel";
import { routeQueryHref, withLibrary, withView } from "../../lib/routeQuery";
import type { RouteQuery } from "../../lib/routeQuery";
import {
  LIBRARY_UNDRAWN_TEXT, LIBRARY_TEXT, moreUsesText, outdatedText, saveAsVersionText, setEditorLabel,
  setFieldsTitle, setFootStats, unsavedVersionText, updateAllText, usedInCellsText, versionText,
} from "../../lib/libraryLabels";
import { deleteFieldSet, fetchFieldSetUsage, propagateSetToDrafts, saveFieldSet } from "../../lib/useLibrary";
import { FieldRowsTable } from "../editor/FieldRowsTable";
import type { FocusPart } from "../editor/FieldRowsTable";
import { rowIds } from "../editor/FieldRowEditor";
import { ADD_ROW_ID, AddFieldBar } from "../editor/AddFieldBar";

/**
 * "עריכת ערכה: {name}" — the field set editor (artboard 8, spec §5.9), the library's second pane:
 *   1. head: h2 (20/700) with Pencil ("שינוי שם הערכה": the name becomes an input in place — Enter or
 *      leaving it keeps it, Escape drops it), Tag "גרסה {v}", "לא בשימוש"; the meta line, or while the
 *      working copy differs "שינויים שלא נשמרו · יישמרו כגרסה {v+1}" with primary small "שמירה כגרסה
 *      {v+1}" (aria-disabled while a field has no name); ghost "שכפל", red ghost "מחק" (confirm and
 *      409 IN_USE: undrawn); outlined "החל על תאים…" (`onApplyToCells`, artboard 9): the page
 *      opens the map with the set kept for the apply dialog — the cells are chosen there. The saved
 *      version applies, not the working copy.
 *   2. usage (pearl): "בשימוש ב-{n} תאים" / "לא בשימוש"; a chip per cell (Link2; "… › {item}" after a
 *      chip of the same kit and station; an older version as a warning chip "גרסה {n}") that opens the
 *      cell editor; past five, "+{n} נוספים" → the map; unused: the paragraph.
 *   3. the outdated bar (role="status") with "עדכן את כולם ({n})" → POST …/propagate (drafts only).
 *   4. "שדות בערכה · {n}": the station editor's FieldRowsTable on artboard 8's grid; "אין עדיין שדות
 *      בערכה"; the add bar ("הוסף שורת בדיקה", "סוג שדה אחר").
 *   5. the footer: "{N} שדות · {M} חובה" and its line.
 * Edits are a working copy (`draft`, kept by FieldLibrary so the list shows the dot); "שמירה כגרסה"
 * PUTs it (409 VERSION_CONFLICT → "טען מחדש").
 */

export type FieldSetEditorProps = {
  set: FieldSetJson;
  /** The working copy; null = the saved set. */
  draft: SetDraft | null;
  onDraftChange: (next: SetDraft | null) => void;
  /** How this session came by the set (the meta line). */
  origin: SetOrigin | null;
  lists: readonly OptionListJson[] | null;
  routes: readonly RouteIndexRow[] | null;
  query: RouteQuery;
  onNavigate: (q: RouteQuery) => void;
  /** "שכפל" — FieldLibrary creates the copy and opens it. */
  onDuplicate: () => Promise<void>;
  duplicating: boolean;
  /** Reload the sets (after a save, a delete, an update of the cells). */
  reloadSets: () => Promise<boolean>;
  /** "החל על תאים…" (artboard 8 → 9). Without it the button is not drawn. */
  onApplyToCells?: () => void;
};

const PAGE = "/settings/testing-routes";

/** This browser's clock in 30-second steps, for the meta line's relative time ("עודכנה עכשיו"). */
const CLOCK_STEP_MS = 30_000;
const clockSnapshot = () => Math.floor(Date.now() / CLOCK_STEP_MS) * CLOCK_STEP_MS;
const clockSubscribe = (onTick: () => void) => {
  const t = setInterval(onTick, CLOCK_STEP_MS);
  return () => clearInterval(t);
};
const noClock = () => 0;
function useClock(): number {
  return React.useSyncExternalStore(clockSubscribe, clockSnapshot, noClock);
}

type UsageState = { key: string; uses: LibraryUseJson[] | null };
type Notice = { text: string; action: "retry-save" | "reload" | "retry-update" | null };

export function FieldSetEditor(props: FieldSetEditorProps) {
  const { set, draft, onDraftChange, lists, routes, query, onNavigate } = props;
  const store = useDraftStore();
  const now = useClock();
  const name = draft?.name ?? set.name;
  const fields = React.useMemo(() => draft?.fields ?? set.fields, [draft, set.fields]);
  const dirty = draft != null;
  const counts = setCounts(fields);
  const nextVersion = set.version + 1;
  const unnamed = hasUnnamedField(fields);

  // ---- usage --------------------------------------------------------------------------------------
  const [usageTick, setUsageTick] = React.useState(0);
  const usageKey = set.id + ":" + set.version + ":" + usageTick;
  const [usage, setUsage] = React.useState<UsageState>({ key: "", uses: null });
  React.useEffect(() => {
    let alive = true;
    void fetchFieldSetUsage(set.id).then((uses) => {
      if (alive) setUsage({ key: usageKey, uses });
    });
    return () => {
      alive = false;
    };
  }, [set.id, usageKey]);
  const usageReady = usage.key === usageKey && usage.uses != null;
  const usageFailed = usage.key === usageKey && usage.uses == null;
  const uses = usageReady ? usage.uses ?? [] : [];
  const cells = usageReady ? uses.length : set.usage.cells;
  const outdated = usageReady ? outdatedUses(uses, set.version) : [];
  const outdatedCount = usageReady ? outdated.length : set.usage.outdated;
  const chips = usageChips(uses, set.version, routes ?? [], query);

  // ---- editing state --------------------------------------------------------------------------------
  const [popover, setPopover] = React.useState<EditorPopover | null>(null);
  const [freshId, setFreshId] = React.useState<FieldId | null>(null);
  const [expanded, setExpanded] = React.useState<ReadonlySet<FieldId>>(() => new Set());
  const [focusReq, setFocusReq] = React.useState<{ target: { id: FieldId; part: FocusPart } | null; seq: number } | null>(null);
  const [renaming, setRenaming] = React.useState(false);
  const [busy, setBusy] = React.useState<"save" | "delete" | "update" | null>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const titleId = React.useId();
  const renameRef = React.useRef<HTMLButtonElement>(null);

  const requestFocus = React.useCallback((target: { id: FieldId; part: FocusPart } | null) => {
    setFocusReq((p) => ({ target, seq: (p?.seq ?? 0) + 1 }));
  }, []);
  React.useEffect(() => {
    if (!focusReq) return;
    const t = focusReq.target;
    const id = t == null ? ADD_ROW_ID : t.part === "name" ? rowIds(t.id).name : rowIds(t.id).grip;
    document.getElementById(id)?.focus();
  }, [focusReq]);

  /** The working copy, or none when it is back to the saved set. */
  const change = (next: SetDraft) => onDraftChange(setDraftDirty(set, next) ? next : null);
  const setFields = (next: Field[]) => change({ name, fields: next });

  const addField = (type: FieldType) => {
    const f = newField(type, DEFAULT_IDS, lists);
    setFields([...fields, f]);
    setFreshId(type === "section" ? null : f.id);
    if (opensExpanded(type)) setExpanded((s) => new Set(s).add(f.id));
    requestFocus({ id: f.id, part: "name" });
  };

  const toggleExpanded = (id: FieldId) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // ---- writes -----------------------------------------------------------------------------------------
  const save = async () => {
    if (!dirty || unnamed || busy) return;
    setBusy("save");
    setNotice(null);
    const r = await saveFieldSet(set.id, { name: name.trim() || set.name, fields, base_version: set.version });
    if (r.ok) {
      await props.reloadSets();
      onDraftChange(null);
      setUsageTick((t) => t + 1);
    } else if (r.error.kind === "conflict") {
      setNotice({ text: LIBRARY_UNDRAWN_TEXT.setConflict, action: "reload" });
    } else {
      setNotice({ text: LIBRARY_UNDRAWN_TEXT.saveFailed, action: "retry-save" });
    }
    setBusy(null);
  };

  const remove = async () => {
    setConfirmDelete(false);
    setBusy("delete");
    setNotice(null);
    const r = await deleteFieldSet(set.id);
    setBusy(null);
    if (r.ok) {
      onDraftChange(null);
      await props.reloadSets();
      onNavigate(withLibrary(query, "sets", null));
    } else {
      setNotice({ text: r.error.kind === "in_use" ? LIBRARY_UNDRAWN_TEXT.setInUse : LIBRARY_UNDRAWN_TEXT.deleteFailed, action: null });
    }
  };

  const updateAll = async () => {
    if (busy) return;
    setBusy("update");
    setNotice(null);
    const r = await propagateSetToDrafts(store, set.id, outdated.map((u) => u.route_id));
    setBusy(null);
    if (r.ok) {
      setUsageTick((t) => t + 1);
      void props.reloadSets();
    } else {
      setNotice({ text: LIBRARY_UNDRAWN_TEXT.updateFailed, action: "retry-update" });
    }
  };

  const onNoticeAction = () => {
    if (!notice) return;
    if (notice.action === "reload") {
      setNotice(null);
      onDraftChange(null);
      void props.reloadSets();
    } else if (notice.action === "retry-save") void save();
    else if (notice.action === "retry-update") void updateAll();
  };

  const listName = (ref: VersionRef) => lists?.find((l) => l.id === ref.id)?.name ?? null;
  const allIds = React.useMemo(() => new Set(fields.map((f) => f.id)), [fields]);
  const issues = React.useMemo(() => lintFields(fields), [fields]);

  return (
    <section aria-label={setEditorLabel(name)} className="settings-card rf-lib-editor">
      {/* 1. head */}
      <div className="rf-lib-head">
        <div className="rf-lib-head__titles">
          <div className="rf-lib-head__title-row">
            {renaming ? (
              <RenameInput
                label={LIBRARY_TEXT.renameSet}
                value={name}
                onDone={(next) => {
                  setRenaming(false);
                  if (next != null && next.trim() !== "") change({ name: next.trim(), fields });
                }}
                restoreFocus={() => renameRef.current?.focus()}
              />
            ) : (
              <>
                <h2 id={titleId} className="rf-lib-head__title">{name}</h2>
                <IconButton ref={renameRef} size="small" className="rf-lib-head__rename" aria-label={LIBRARY_TEXT.renameSet} onClick={() => setRenaming(true)}>
                  <Pencil size={16} strokeWidth={1.75} aria-hidden />
                </IconButton>
              </>
            )}
            <Tag tone="primary" size="md">{versionText(set.version)}</Tag>
            {cells === 0 && <Tag tone="neutral">{LIBRARY_TEXT.unused}</Tag>}
          </div>
          {dirty ? (
            <span className="rf-lib-head__dirty">
              <span className="rf-lib-head__dirty-dot" aria-hidden="true" />
              {unsavedVersionText(nextVersion)}
            </span>
          ) : (
            <span className="rf-lib-head__meta">{setMetaText(set, props.origin, now)}</span>
          )}
        </div>
        <div className="rf-lib-head__actions">
          <Button
            variant="text"
            className="rf-lib-ghost"
            loading={props.duplicating}
            startIcon={<Copy size={16} strokeWidth={1.75} aria-hidden />}
            onClick={() => void props.onDuplicate()}
          >
            {LIBRARY_TEXT.duplicate}
          </Button>
          <Button
            variant="text"
            color="error"
            className="rf-lib-ghost"
            loading={busy === "delete"}
            startIcon={<Trash2 size={16} strokeWidth={1.75} aria-hidden />}
            onClick={() => setConfirmDelete(true)}
          >
            {LIBRARY_TEXT.remove}
          </Button>
          {dirty && (
            <Button
              size="small"
              loading={busy === "save"}
              aria-disabled={unnamed || undefined}
              onClick={() => void save()}
            >
              {saveAsVersionText(nextVersion)}
            </Button>
          )}
          {props.onApplyToCells && (
            <Button variant="outlined" onClick={props.onApplyToCells}>{LIBRARY_TEXT.applyToCells}</Button>
          )}
        </div>
      </div>

      {notice && (
        <Alert
          severity="error"
          action={notice.action ? (
            <Button variant="text" size="small" color="inherit" disabled={busy != null} onClick={onNoticeAction}>
              {notice.action === "reload" ? LIBRARY_UNDRAWN_TEXT.conflictReload : LIBRARY_UNDRAWN_TEXT.retry}
            </Button>
          ) : undefined}
        >
          {notice.text}
        </Alert>
      )}

      {/* 2. usage */}
      <div className="rf-lib-block">
        <div className="rf-lib-block__head">
          <Link2 size={16} strokeWidth={1.75} className="rf-lib-block__icon" aria-hidden />
          <span className="rf-lib-block__title">{cells > 0 ? usedInCellsText(cells) : LIBRARY_TEXT.unused}</span>
          {cells > 0 && <span className="rf-lib-block__hint">{LIBRARY_TEXT.usageHint}</span>}
        </div>
        {cells > 0 && usageReady && (
          <div className="rf-lib-chips">
            {chips.chips.map((c) =>
              c.query ? (
                <Link
                  key={c.key}
                  href={routeQueryHref(PAGE, c.query)}
                  replace
                  scroll={false}
                  aria-label={c.aria}
                  className="rf-lib-chip"
                  data-old={c.oldVersion != null || undefined}
                >
                  <ChipBody text={c.text} oldVersion={c.oldVersion} />
                </Link>
              ) : (
                <span key={c.key} aria-label={c.aria} className="rf-lib-chip" data-old={c.oldVersion != null || undefined}>
                  <ChipBody text={c.text} oldVersion={c.oldVersion} />
                </span>
              ),
            )}
            {chips.more > 0 && (
              <Link href={routeQueryHref(PAGE, withView(query, "map"))} replace scroll={false} className="rf-lib-more">
                {moreUsesText(chips.more)}
              </Link>
            )}
          </div>
        )}
        {cells > 0 && usageFailed && (
          <div className="rf-lib-inline-error">
            <span>{LIBRARY_UNDRAWN_TEXT.usageFailed}</span>
            <Button variant="text" size="small" onClick={() => setUsageTick((t) => t + 1)}>{LIBRARY_UNDRAWN_TEXT.retry}</Button>
          </div>
        )}
        {cells === 0 && <p className="rf-lib-block__para">{LIBRARY_TEXT.usageNone}</p>}
      </div>

      {/* 3. cells on an older version */}
      {outdatedCount > 0 && (
        <div role="status" className="rf-lib-outdated">
          <TriangleAlert size={18} strokeWidth={1.75} className="rf-lib-outdated__icon" aria-hidden />
          <span className="rf-lib-outdated__text">
            <span className="rf-lib-outdated__title">{outdatedText(outdatedCount)}</span>
            <span className="rf-lib-outdated__note">{LIBRARY_TEXT.outdatedNote}</span>
          </span>
          <Button
            variant="outlined"
            size="small"
            className="rf-lib-outdated__btn"
            loading={busy === "update"}
            onClick={() => void updateAll()}
          >
            {updateAllText(outdatedCount)}
          </Button>
        </div>
      )}

      {/* 4. fields */}
      <div className="rf-lib-fields">
        <div className="rf-lib-fields__head">
          <h3 className="rf-lib-fields__title">{setFieldsTitle(counts.fields)}</h3>
          <span className="rf-lib-fields__note">{LIBRARY_TEXT.fieldsNote}</span>
        </div>
        {fields.length > 0 ? (
          <FieldRowsTable
            className="rf-set-table"
            fields={fields}
            publishedIds={allIds}
            freshId={freshId}
            issues={issues}
            popover={popover}
            setPopover={setPopover}
            expanded={expanded}
            onToggleExpanded={toggleExpanded}
            onFieldsChange={setFields}
            onNameBlur={(id) => setFreshId((f) => (f === id ? null : f))}
            onAddRow={() => addField("choice_row")}
            requestFocus={requestFocus}
            stationLabel={name}
            rowLabel=""
            listName={listName}
            onOpenList={(ref) => onNavigate(withLibrary(query, "lists", ref.id))}
          />
        ) : (
          <div className="rf-lib-empty-set">
            <ListChecks size={34} strokeWidth={1.75} className="rf-lib-empty-set__icon" aria-hidden />
            <span className="rf-lib-empty-set__title">{LIBRARY_TEXT.emptySetTitle}</span>
            <span className="rf-lib-empty-set__body">{LIBRARY_TEXT.emptySetBody}</span>
          </div>
        )}
      </div>
      <AddFieldBar
        pickerOpen={popover?.kind === "picker"}
        onPickerOpenChange={(o) => setPopover((p) => (o ? { kind: "picker" } : p?.kind === "picker" ? null : p))}
        onAddRow={() => addField("choice_row")}
        onPick={(type) => {
          setPopover((p) => (p?.kind === "picker" ? null : p));
          addField(type);
        }}
      />

      {/* 5. footer */}
      <div className="rf-lib-foot">
        <span className="rf-lib-foot__stats">{setFootStats(counts.fields, counts.required)}</span>
        <span>{cells > 0 ? LIBRARY_TEXT.footUsed : LIBRARY_TEXT.footUnused}</span>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={LIBRARY_UNDRAWN_TEXT.deleteSetTitle}
        message={LIBRARY_UNDRAWN_TEXT.deleteSetMessage}
        confirmText={LIBRARY_TEXT.remove}
        destructive
        draggable={false}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
    </section>
  );
}

function ChipBody({ text, oldVersion }: { text: string; oldVersion: number | null }) {
  return (
    <>
      <Link2 size={14} strokeWidth={1.75} className="rf-lib-chip__icon" aria-hidden />
      <span>{text}</span>
      {oldVersion != null && <span className="rf-lib-chip__old">{versionText(oldVersion)}</span>}
    </>
  );
}

/**
 * The name in place of the h2 (20/700): Enter or leaving it keeps the text, Escape drops it. After
 * Enter / Escape the focus goes back to the Pencil (`restoreFocus`); leaving it by a press elsewhere
 * leaves the focus where it went.
 */
export function RenameInput({ label, value, onDone, restoreFocus }: {
  label: string;
  value: string;
  onDone: (next: string | null) => void;
  restoreFocus: () => void;
}) {
  const [text, setText] = React.useState(value);
  const done = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // The Pencil was pressed to change the name: it takes the focus, its text selected.
  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const finish = (next: string | null, byKey = false) => {
    if (done.current) return;
    done.current = true;
    if (!byKey) {
      onDone(next);
      return;
    }
    // The Pencil comes back with this commit, so it can take the focus right after.
    flushSync(() => onDone(next));
    restoreFocus();
  };
  return (
    <input
      ref={inputRef}
      className="rf-lib-rename"
      aria-label={label}
      dir="auto"
      autoComplete="off"
      maxLength={100}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(text, true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(null, true);
        }
      }}
    />
  );
}

export default FieldSetEditor;
