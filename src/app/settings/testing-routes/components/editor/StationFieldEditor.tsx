"use client";
import * as React from "react";
import { Ellipsis, ListChecks, Lock } from "lucide-react";
import { ConfirmDialog, Menu, MenuItem, Tag } from "@/components/ui";
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
  EDITOR_COPY_PENDING, EDITOR_TEXT, editorFooterText, editorSubText, editorTitleText, fieldsTabText, targetChipText,
} from "../../lib/labels";
import {
  editorCounts, issuesOfGroup, lockedRowTexts, namedFieldCount, newField, opensExpanded, packageWizardAt, popupKindOf,
  targetChips, timelineStops,
} from "../../lib/editorModel";
import type { EditorPopover, PackageWizard, PopupLookup } from "../../lib/editorModel";
import { StationTimeline } from "./StationTimeline";
import { SharedRouteNotice } from "./SharedRouteNotice";
import { FieldRowsTable } from "./FieldRowsTable";
import type { FocusPart } from "./FieldRowsTable";
import { rowIds } from "./FieldRowEditor";
import { ADD_ROW_ID, AddFieldBar } from "./AddFieldBar";
import { EditorBreadcrumb } from "./EditorBreadcrumb";
import { WorkerPreviewCard } from "./WorkerPreviewCard";
import "./editor.css";

/**
 * The station field editor — artboard 2, `view=map&step=&target=` (route-fields spec §5.5): what the
 * worker fills at one station for one item (or one target of a kit's package-level station), with
 * the live worker preview beside it.
 *
 *   breadcrumb   EditorBreadcrumb, <nav aria-label="מיקום">: "חזרה למפה", "מפת שדות › {station} ›
 *                {item}" — in the view tabs' row when the page draws it there (`breadcrumbOutside`)
 *   station bar  StationTimeline — a stop per map column
 *   editor card  "שלב {n} מתוך {total} · {station}" + Tag, the sub-line, the ⋯ menu ("נקה את התא");
 *                "שדות · {n}"; the target chips ("פריט: …"); SharedRouteNotice; the locked rows of the
 *                popup the station really opens (spec §10.3); FieldRowsTable; AddFieldBar; the footer
 *   preview      WorkerPreviewCard (sticky, top 16) — the popup the station opens, and for a
 *                package-level step which wizard (the kit route's last step closes the kit)
 *
 * Data (spec §5.5.4): the cell's group in the WORKING COPY of the route that holds it (draftStore) —
 * an item column's group lives on the ITEM's route (decision 4, hence the shared notice); every edit
 * is store.edit(route_id, cfg => setGroupFields(cfg, binding, stepMeta, fields)) and autosaves.
 * ?field= focuses that row's name (the map error bar's "עבור לשדה"). A URL naming a cell the map does
 * not have goes back to the map.
 *
 * Not here yet: "העתק מ…" / "העתק לפריטים…" (not drawn as dialogs), "שמור כערכה…" / "החל ערכה…"
 * (sessions 2d / 2e), "פריסת החלון" (phase 3), "הדבק מאקסל" and "צור מסלול נפרד למארז הזה" (2e).
 */

export type StationFieldEditorProps = {
  context: FieldsContextJson;
  model: FieldsMapModel;
  query: RouteQuery;
  onNavigate: (q: RouteQuery) => void;
  /** Names of the shared option lists by id, once the screen loads them (session 2d). Without a
   *  name a linked field reads "רשימה: רשימה משותפת" (COPY-PENDING). */
  listNames?: Readonly<Record<number, string>>;
  /** The host draws the breadcrumb (EditorBreadcrumb) itself — the page puts it in the view tabs'
   *  row, as artboard 2 does. Without it the editor draws it above the station bar. */
  breadcrumbOutside?: boolean;
};

/** Which popup a station type opens on the worker screen (mainPopUp.ts — the one source). */
const POPUP_LOOKUP: PopupLookup = {
  hasWizard: hasStartTestDialog,
  isVerdict: (typeId) => getStartTestDialog(typeId) === VerdictStation,
};

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

function CellEditor({ context, model, query, onNavigate, listNames, breadcrumbOutside: crumbsOutside = false, cell, navFocusRef }: CellEditorProps) {
  const store = useDraftStore();
  const { model: drafts, summary } = useDraftSnapshot();
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

  const addField = (type: FieldType) => {
    const f = newField(type);
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

  const goTo = (target: MapCell, from: NavFocus) => {
    navFocusRef.current = from;
    onNavigate(withEditor(query, target.binding.step_uid, target.binding.target));
  };

  // ---- derived ---------------------------------------------------------------------------------
  const stationTypeName = context.stations[cell.stepMeta.station_type_id]?.label?.trim() || cell.stationLabel;
  const popupKind = popupKindOf(stepMeta.station_type_id, cell.packageLevel, POPUP_LOOKUP);
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
  const listName = (ref: VersionRef) => listNames?.[ref.id] ?? null;
  const cellMenuOpen = popover?.kind === "cellMenu";
  const n = column?.n ?? 1;
  const total = model.columns.length;

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
                  type="button"
                  className="sfe-card__more"
                  aria-label={EDITOR_TEXT.cellMenuLabel}
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
                  MenuListProps={{ className: "sfe-menu", "aria-label": EDITOR_TEXT.cellMenuLabel }}
                >
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

          <div className="sfe-card__body">
            {showShared && row?.routeNumber != null && (
              <SharedRouteNotice routeNumber={row.routeNumber} item={row.label} kits={cell.sharedWith.map((k) => k.desc)} />
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
          />
          {popover?.kind === "picker" && <div className="sfe-preview-col__veil" aria-hidden="true" />}
        </div>
      </div>

      <ConfirmDialog
        open={clearOpen}
        title={EDITOR_COPY_PENDING.clearTitle}
        message={EDITOR_COPY_PENDING.clearMessage}
        confirmText={EDITOR_TEXT.clearCell}
        cancelText={EDITOR_COPY_PENDING.clearCancel}
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
    </div>
  );
}

export default StationFieldEditor;
