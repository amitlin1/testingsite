"use client";
import * as React from "react";
import { Ellipsis, ListChecks, Lock } from "lucide-react";
import { ConfirmDialog, Menu, MenuItem, Snackbar, Tag } from "@/components/ui";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import type { Field, FieldId, FieldType, VersionRef } from "@/app/lib/station-fields/schema";
import { getStartTestDialog, hasStartTestDialog } from "@/app/testing/tests-popups/mainPopUp";
import VerdictStation from "@/app/testing/tests-popups/VerdictStation";
import { setGroupFields } from "../../lib/draftModel";
import { useDraftSnapshot, useDraftStore } from "../../lib/draftStore";
import { bindingKey, findCell, getColumn, getRow, groupFieldsOf } from "../../lib/mapModel";
import type { FieldsMapModel, MapCell } from "../../lib/mapModel";
import { backToMap, withEditor } from "../../lib/routeQuery";
import type { RouteQuery } from "../../lib/routeQuery";
import {
  EDITOR_UNDRAWN_TEXT, EDITOR_TEXT, cellLabel, cellMenuText, editorFooterText, editorSubText, editorTitleText, fieldsTabText,
  targetChipText,
} from "../../lib/labels";
import type { CellMenuItem } from "../../lib/labels";
import { savedAsSetText } from "../../lib/applySetLabels";
import {
  DEFAULT_IDS, editorCounts, issuesOfGroup, lockedRowTexts, namedFieldCount, newField, opensExpanded, packageWizardAt,
  popupKindOf, targetChips, timelineStops,
} from "../../lib/editorModel";
import type { EditorPopover, PackageWizard, PopupLookup } from "../../lib/editorModel";
import { useFieldSets, useOptionLists } from "../../lib/useLibrary";
import { insertTsvRows, parseTsvRows } from "../../lib/pasteTsv";
import { alongsideFields, stepFieldIds } from "../../lib/bulkModel";
import { StationTimeline } from "./StationTimeline";
import { SharedRouteNotice } from "./SharedRouteNotice";
import { usePopupTemplateTypes } from "../../lib/usePopupTemplateTypes";
import { FieldRowsTable } from "./FieldRowsTable";
import type { FocusPart } from "./FieldRowsTable";
import { rowIds } from "./FieldRowEditor";
import { ADD_ROW_ID, AddFieldBar, PASTE_TSV_ID } from "./AddFieldBar";
import type { TsvPasteOutcome } from "./AddFieldBar";
import { EditorBreadcrumb } from "./EditorBreadcrumb";
import { WorkerPreviewCard } from "./WorkerPreviewCard";
import SaveAsSetDialog from "../dialogs/SaveAsSetDialog";
import "./editor.css";

/**
 * The station field editor — artboard 2, `view=map&step=&target=` (route-fields spec §5.5): what the
 * worker fills at one station for one item (or one target of a kit's package-level station), with
 * the live worker preview beside it.
 *
 *   breadcrumb   EditorBreadcrumb, <nav aria-label="מיקום">: "חזרה למפה", "מפת שדות › {station} ›
 *                {item}" — in the view tabs' row when the page draws it there (`breadcrumbOutside`)
 *   station bar  StationTimeline — a stop per map column
 *   editor card  "שלב {n} מתוך {total} · {station}" + Tag, the sub-line, the ⋯ menu ("שמור כערכה…",
 *                "החל ערכה…" when the host gives `onApplySet`, "נקה את התא" — its aria-label names
 *                exactly these); "שדות · {n}"; the target chips ("פריט: …"); SharedRouteNotice (with
 *                "צור מסלול נפרד למארז הזה" on a kit's map when the host gives `reloadContext`); the
 *                locked rows of the popup the station really opens (spec §10.3); FieldRowsTable;
 *                AddFieldBar; the footer
 *   preview      WorkerPreviewCard (sticky, top 16) — the popup the station opens, and for a
 *                package-level step which wizard (the kit route's last step closes the kit)
 *
 * Data (spec §5.5.4): the cell's group in the WORKING COPY of the route that holds it (draftStore) —
 * an item column's group lives on the ITEM's route (decision 4, hence the shared notice); every edit
 * is store.edit(route_id, cfg => setGroupFields(cfg, binding, stepMeta, fields)) and autosaves.
 * ?field= focuses that row's name (the map error bar's "עבור לשדה"). A URL naming a cell the map does
 * not have goes back to the map.
 *
 * "הדבק מאקסל" (AddFieldBar, spec §5.14): the clipboard's rows (pasteTsv) go after the row that had
 * the focus, else at the end — one draft edit; a name the cell already has (each_item's too, for a
 * kit item) is skipped.
 *
 * "שמור כערכה…" (spec §5.5.1; its dialog is not drawn, SaveAsSetDialog): a name, then
 * a new field set in the library with the cell's input fields; the cell does not change. "החל ערכה…"
 * opens the host's apply-set dialog (artboard 9) on this one cell.
 *
 * Not here: "העתק מ…" / "העתק לפריטים…" (not drawn as dialogs) and "פריסת החלון" (phase 3).
 */

export type StationFieldEditorProps = {
  context: FieldsContextJson;
  model: FieldsMapModel;
  query: RouteQuery;
  onNavigate: (q: RouteQuery) => void;
  /** Names of the shared option lists by id (useLibrary.useOptionListNames). Without it the editor
   *  reads them from the same shared store; a name not known yet reads "רשימה: רשימה משותפת"
   *  (undrawn). */
  listNames?: Readonly<Record<number, string>>;
  /** The host draws the breadcrumb (EditorBreadcrumb) itself — the page puts it in the view tabs'
   *  row, as artboard 2 does. Without it the editor draws it above the station bar. */
  breadcrumbOutside?: boolean;
  /** The ⋯'s "החל ערכה…": the host's apply-set dialog (artboard 9) on these cells (this one), and
   *  where the focus goes back once it closes (the ⋯). Without it the item is not in the menu. */
  onApplySet?: (cells: MapCell[], returnFocus: HTMLElement | null) => void;
  /** Ask for the fields context again (useFieldsContext's reload) — after "צור מסלול נפרד למארז
   *  הזה", whose link the shared notice shows on a kit's map only with it. */
  reloadContext?: () => void;
};

/** Which popup a station type opens on the worker screen (mainPopUp.ts — the one source), and
 *  whether its station type has a popup template (it wins; usePopupTemplateTypes). */
function popupLookup(templateTypes: ReadonlyMap<number, unknown> | null): PopupLookup {
  return {
    hasWizard: hasStartTestDialog,
    isVerdict: (typeId) => getStartTestDialog(typeId) === VerdictStation,
    hasTemplate: (typeId) => templateTypes?.has(typeId) ?? false,
  };
}

/** Where focus goes after the editor moved to another cell from its own controls. */
type NavFocus = "target" | "stop" | null;

export function StationFieldEditor(props: StationFieldEditorProps) {
  const { model, query, onNavigate } = props;
  const cell = query.step != null && query.target != null ? findCell(model, query.step, query.target) : null;
  // Set before the editor navigates to another cell: the new cell's editor puts focus back on the
  // chip / stop that was pressed (it is a new tree — see the key below).
  const navFocusRef = React.useRef<NavFocus>(null);

  React.useEffect(() => {
    if (!cell) onNavigate(backToMap(query));
  }, [cell, query, onNavigate]);

  if (!cell) return null;
  // One editor per cell: its rename, open popover, new row and expanded rows belong to that cell.
  return <CellEditor key={bindingKey(cell.binding)} {...props} cell={cell} navFocusRef={navFocusRef} />;
}

type CellEditorProps = StationFieldEditorProps & { cell: MapCell; navFocusRef: React.RefObject<NavFocus> };

function CellEditor({
  context, model, query, onNavigate, listNames, breadcrumbOutside: crumbsOutside = false, onApplySet, reloadContext, cell, navFocusRef,
}: CellEditorProps) {
  const store = useDraftStore();
  const { model: drafts, summary } = useDraftSnapshot();
  const templateTypes = usePopupTemplateTypes();
  const { binding, stepMeta } = cell;
  const entry = drafts.routes[binding.route_id];
  const column = getColumn(model, cell.columnKey);
  const row = getRow(model, cell.rowKey);
  const titleId = React.useId();

  const fields = React.useMemo(() => groupFieldsOf(entry?.current, binding.step_uid, binding.target), [entry, binding.step_uid, binding.target]);
  const publishedIds = React.useMemo(
    () => new Set(groupFieldsOf(entry?.published, binding.step_uid, binding.target).map((f) => f.id)),
    [entry, binding.step_uid, binding.target],
  );
  const issues = React.useMemo(
    () => issuesOfGroup(summary.issuesByRoute[binding.route_id] ?? [], binding.step_uid, binding.target),
    [summary, binding.route_id, binding.step_uid, binding.target],
  );
  const counts = editorCounts(fields);

  // ---- local state ------------------------------------------------------------------------------
  const [popover, setPopover] = React.useState<EditorPopover | null>(null);
  const [freshId, setFreshId] = React.useState<FieldId | null>(null);
  const [expanded, setExpanded] = React.useState<ReadonlySet<FieldId>>(() => new Set());
  const [clearOpen, setClearOpen] = React.useState(false);
  const [saveSetOpen, setSaveSetOpen] = React.useState(false);
  /** The message after "שמור כערכה…" (undrawn); a new one restarts the Snackbar (its key). */
  const [savedNotice, setSavedNotice] = React.useState<{ text: string; seq: number } | null>(null);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const [focusReq, setFocusReq] = React.useState<{ target: { id: FieldId; part: FocusPart } | null; seq: number } | null>(null);

  const requestFocus = React.useCallback((target: { id: FieldId; part: FocusPart } | null) => {
    setFocusReq((p) => ({ target, seq: (p?.seq ?? 0) + 1 }));
  }, []);

  React.useEffect(() => {
    if (!focusReq) return;
    const t = focusReq.target;
    const id = t == null ? ADD_ROW_ID : t.part === "name" ? rowIds(t.id).name : rowIds(t.id).grip;
    document.getElementById(id)?.focus();
  }, [focusReq]);

  // "עבור לשדה" (?field=): that row's name.
  React.useEffect(() => {
    if (!query.field) return;
    const el = document.getElementById(rowIds(query.field).name);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  }, [query.field]);

  // Arrived from a chip or a stop of the previous cell's editor: focus its counterpart here.
  React.useEffect(() => {
    const from = navFocusRef.current;
    navFocusRef.current = null;
    const sel = from === "target" ? '.sfe-target[aria-pressed="true"]' : from === "stop" ? '.sfe-stop[aria-current="step"]' : null;
    if (sel) document.querySelector<HTMLElement>(sel)?.focus();
  }, [navFocusRef]);

  // ---- edits -----------------------------------------------------------------------------------
  const setFields = React.useCallback(
    (next: Field[]) => store.edit(binding.route_id, (cfg) => setGroupFields(cfg, binding, stepMeta, next)),
    [store, binding, stepMeta],
  );

  // The shared lists: a new "שורת בדיקה" links to "תקינות כללית" when it exists (editorModel.newField).
  const optionLists = useOptionLists().data;
  const { reload: reloadSets } = useFieldSets();

  /** After a dialog of the ⋯ closed: ui/Dialog has no trigger to give the focus back to — the ⋯
   *  takes it, once the dialog has let go of it. */
  const refocusMoreSoon = () => {
    window.setTimeout(() => moreRef.current?.focus({ preventScroll: true }), 0);
  };

  const addField = (type: FieldType) => {
    const f = newField(type, DEFAULT_IDS, optionLists);
    setFields([...fields, f]);
    setFreshId(type === "section" ? null : f.id);
    if (opensExpanded(type)) setExpanded((s) => new Set(s).add(f.id));
    requestFocus({ id: f.id, part: "name" });
  };

  // "הדבק מאקסל" pastes after the row that had the focus last (spec §5.14). Focus moving to another
  // control of the card forgets it — except to the paste button itself; focus inside a portal (the
  // paste box, a popover) is not the card's.
  const pasteAfterRef = React.useRef<FieldId | null>(null);
  const trackRowFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const el = e.target;
    if (!(el instanceof Element) || !e.currentTarget.contains(el)) return;
    const row = el.closest<HTMLElement>("[data-field-id]");
    if (row) pasteAfterRef.current = row.dataset.fieldId ?? null;
    else if (!el.closest("#" + PASTE_TSV_ID)) pasteAfterRef.current = null;
  };
  const pasteTsv = (text: string): TsvPasteOutcome | null => {
    const rows = parseTsvRows(text);
    if (rows.length === 0) return null;
    const cfg = entry?.current;
    const r = insertTsvRows(fields, rows, {
      lists: optionLists,
      after: pasteAfterRef.current,
      alongside: alongsideFields(cfg, binding),
      takenIds: stepFieldIds(cfg, binding.step_uid),
    });
    if (r.added.length > 0) {
      setFields(r.fields);
      requestFocus({ id: r.added[0], part: "name" });
    }
    return { added: r.added.length, skipped: r.skipped, overflow: r.overflow };
  };

  const toggleExpanded = (id: FieldId) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const goTo = (target: MapCell, from: NavFocus) => {
    navFocusRef.current = from;
    onNavigate(withEditor(query, target.binding.step_uid, target.binding.target));
  };

  // ---- derived ---------------------------------------------------------------------------------
  const stationTypeName = context.stations[cell.stepMeta.station_type_id]?.label?.trim() || cell.stationLabel;
  const popupKind = popupKindOf(stepMeta.station_type_id, cell.packageLevel, popupLookup(templateTypes));
  let wizard: PackageWizard | null = null;
  if (popupKind === "package" && context.kit) {
    const r = context.kit.route;
    const at = r.step_uids.indexOf(binding.step_uid);
    wizard = at >= 0 ? packageWizardAt(at, r.route_steps.length) : null;
  }
  const locked = lockedRowTexts(popupKind, wizard, binding.target);
  const stops = timelineStops(model, cell);
  const chips = targetChips(model, cell);
  const namedOf = (c: MapCell) => namedFieldCount(groupFieldsOf(drafts.routes[c.binding.route_id]?.current, c.binding.step_uid, c.binding.target));
  const showShared = !cell.packageLevel && cell.sharedWith.length > 0 && row?.routeNumber != null;
  const listName = (ref: VersionRef) => listNames?.[ref.id] ?? optionLists?.find((l) => l.id === ref.id)?.name ?? null;
  const cellMenuOpen = popover?.kind === "cellMenu";
  const menuItems: CellMenuItem[] = onApplySet ? ["saveAsSet", "applySet", "clear"] : ["saveAsSet", "clear"];
  const menuLabel = cellMenuText(menuItems);
  const hasInputFields = fields.some((f) => f.type !== "section");
  const n = column?.n ?? 1;
  const total = model.columns.length;
  // "צור מסלול נפרד למארז הזה" (spec §3.2.1): an item column's route on a kit's map — the kit's line
  // moves to a copy of the route; the context is read again afterwards.
  const fork = showShared && context.kind === "package" && reloadContext
    ? {
        routeId: binding.route_id,
        packageTypeId: context.subject.item_type_id,
        kitName: context.subject.desc.trim(),
        onForked: () => reloadContext(),
        onStale: () => reloadContext(),
      }
    : undefined;

  return (
    <div className="sfe">
      {!crumbsOutside && (
        <EditorBreadcrumb stationLabel={cell.stationLabel} rowLabel={cell.rowLabel} onBackToMap={() => onNavigate(backToMap(query))} />
      )}

      <StationTimeline stops={stops} onGo={(c) => goTo(c, "stop")} />

      <div className="sfe-cols">
        <section aria-labelledby={titleId} className="sfe-card">
          <div className="sfe-card__head">
            <div className="sfe-card__top">
              <div className="sfe-card__titles">
                <div className="sfe-card__title-row">
                  <h2 id={titleId} className="sfe-card__title">{editorTitleText(n, total, cell.stationLabel)}</h2>
                  <Tag tone={cell.packageLevel ? "primary" : "neutral"}>{cell.packageLevel ? EDITOR_TEXT.packageLevel : EDITOR_TEXT.perItem}</Tag>
                </div>
                <p className="sfe-card__sub">{editorSubText(cell.rowLabel)}</p>
              </div>
              <div className="sfe-card__actions">
                <button
                  ref={moreRef}
                  type="button"
                  className="sfe-card__more"
                  aria-label={menuLabel}
                  aria-haspopup="menu"
                  aria-expanded={cellMenuOpen}
                  onClick={(e) => {
                    const anchor = e.currentTarget;
                    setPopover((p) => (p?.kind === "cellMenu" ? null : { kind: "cellMenu", anchor }));
                  }}
                >
                  <Ellipsis size={20} strokeWidth={1.75} aria-hidden />
                </button>
                <Menu
                  open={cellMenuOpen}
                  anchorEl={cellMenuOpen ? popover.anchor : null}
                  onClose={() => setPopover((p) => (p?.kind === "cellMenu" ? null : p))}
                  MenuListProps={{ className: "sfe-menu", "aria-label": menuLabel }}
                >
                  <MenuItem
                    disabled={!hasInputFields}
                    onClick={() => {
                      setPopover(null);
                      // ui/MenuItem marks a disabled item but still reports its click.
                      if (hasInputFields) setSaveSetOpen(true);
                    }}
                  >
                    {EDITOR_TEXT.saveAsSet}
                  </MenuItem>
                  {onApplySet && (
                    <MenuItem
                      onClick={() => {
                        setPopover(null);
                        onApplySet([cell], moreRef.current);
                      }}
                    >
                      {EDITOR_TEXT.applySet}
                    </MenuItem>
                  )}
                  <MenuItem
                    danger
                    disabled={fields.length === 0}
                    onClick={() => {
                      setPopover(null);
                      // ui/MenuItem marks a disabled item but still reports its click.
                      if (fields.length > 0) setClearOpen(true);
                    }}
                  >
                    {EDITOR_TEXT.clearCell}
                  </MenuItem>
                </Menu>
              </div>
            </div>
            <div className="sfe-card__bar">
              <div className="sfe-subtabs">
                <span className="sfe-subtab">
                  <ListChecks size={16} strokeWidth={1.75} aria-hidden />
                  {fieldsTabText(counts.named)}
                </span>
              </div>
              <div role="group" aria-label={EDITOR_TEXT.targetsLabel} className="sfe-targets">
                <span className="sfe-targets__lead">{EDITOR_TEXT.targetsLead}</span>
                {chips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className="sfe-target"
                    aria-pressed={c.pressed}
                    onClick={() => {
                      if (!c.pressed) goTo(c.cell, "target");
                    }}
                  >
                    {targetChipText(c.lead, namedOf(c.cell))}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="sfe-card__body" onFocus={trackRowFocus}>
            {showShared && row?.routeNumber != null && (
              <SharedRouteNotice routeNumber={row.routeNumber} item={row.label} kits={cell.sharedWith.map((k) => k.desc)} fork={fork} />
            )}
            <div className="sfe-locked">
              <Lock size={15} strokeWidth={1.75} aria-hidden />
              <span>{locked.top}</span>
            </div>
            <FieldRowsTable
              fields={fields}
              publishedIds={publishedIds}
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
              stationLabel={cell.stationLabel}
              rowLabel={cell.rowLabel}
              listName={listName}
            />
            <AddFieldBar
              pickerOpen={popover?.kind === "picker"}
              onPickerOpenChange={(o) => setPopover((p) => (o ? { kind: "picker" } : p?.kind === "picker" ? null : p))}
              onAddRow={() => addField("choice_row")}
              onAddSection={() => addField("section")}
              onPick={(type) => {
                setPopover((p) => (p?.kind === "picker" ? null : p));
                addField(type);
              }}
              onPasteTsv={pasteTsv}
            />
            <div className="sfe-locked">
              <Lock size={15} strokeWidth={1.75} aria-hidden />
              <span>{locked.bottom}</span>
            </div>
          </div>

          <footer className="sfe-card__foot">{editorFooterText(counts.named, counts.required, counts.unnamed)}</footer>
        </section>

        <div className="sfe-preview-col">
          <WorkerPreviewCard
            stationLabel={cell.stationLabel}
            rowLabel={cell.rowLabel}
            stepIndex={n}
            stepCount={total}
            fields={fields}
            popupKind={popupKind}
            stationTypeName={stationTypeName}
            packageWizard={wizard ?? undefined}
            stationTypeId={stepMeta.station_type_id}
            packageTemplateRole={popupKind === "package" ? templateTypes?.get(stepMeta.station_type_id)?.role ?? null : null}
          />
          {popover?.kind === "picker" && <div className="sfe-preview-col__veil" aria-hidden="true" />}
        </div>
      </div>

      <ConfirmDialog
        open={clearOpen}
        title={EDITOR_UNDRAWN_TEXT.clearTitle}
        message={EDITOR_UNDRAWN_TEXT.clearMessage}
        confirmText={EDITOR_TEXT.clearCell}
        cancelText={EDITOR_UNDRAWN_TEXT.clearCancel}
        destructive
        draggable={false}
        onCancel={() => setClearOpen(false)}
        onConfirm={() => {
          setClearOpen(false);
          setFreshId(null);
          setExpanded(new Set());
          setFields([]);
          requestFocus(null);
        }}
      />
      <SaveAsSetDialog
        open={saveSetOpen}
        defaultName={cellLabel(cell.stationLabel, cell.rowLabel)}
        fields={fields}
        onClose={() => {
          setSaveSetOpen(false);
          refocusMoreSoon();
        }}
        onSaved={(set) => {
          void reloadSets();
          setSavedNotice((p) => ({ text: savedAsSetText(set.name), seq: (p?.seq ?? 0) + 1 }));
        }}
      />
      <Snackbar
        key={savedNotice?.seq ?? 0}
        open={savedNotice != null}
        message={savedNotice?.text}
        autoHideDuration={5000}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        onClose={() => setSavedNotice(null)}
      />
    </div>
  );
}

export default StationFieldEditor;
