"use client";
import * as React from "react";
import { Ellipsis, ListChecks, Lock } from "lucide-react";
import { ConfirmDialog, DialogReturnFocus, Menu, MenuItem, Tag } from "@/components/ui";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import type { Field, VersionRef } from "@/app/lib/station-fields/schema";
import { bindingKey, groupFieldsOf, setGroupFields } from "../../lib/cellGroups";
import { cellStateOf, fillCell } from "../../lib/cellFill";
import { useDraftSnapshot, useDraftStore } from "../../lib/draftStore";
import { findCell, getColumn, getRow } from "../../lib/mapModel";
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
  editorCounts, issuesOfGroup, kitStepRole, lockedRowTexts, namedFieldCount, popupKindOf, targetChips, timelineStops,
} from "../../lib/editorModel";
import { isInputField } from "../../lib/optionFields";
import { useFieldSets, useOptionLists, usePopupTemplateTypes } from "../../lib/resources";
import { parseTsvRows, tsvFields } from "../../lib/pasteTsv";
import { NoticeSnackbar, useNotice } from "../shared/Notice";
import { StationTimeline } from "./StationTimeline";
import { SharedRouteNotice } from "./SharedRouteNotice";
import { FieldRowsTable } from "./FieldRowsTable";
import { AddFieldBar } from "./AddFieldBar";
import type { TsvPasteOutcome } from "./AddFieldBar";
import { WorkerPreviewCard } from "./WorkerPreviewCard";
import { focusRowName, useFieldListEditor } from "./useFieldListEditor";
import { SaveAsSetDialog } from "../dialogs/SaveAsSetDialog";
import "./editor.css";

/**
 * The station field editor — artboard 2, `view=map&step=&target=` (route-fields spec §5.5): what the
 * worker fills at one station for one item (or one target of a kit's package-level station), with
 * the live worker preview beside it. The page draws its breadcrumb (EditorBreadcrumb) in the view
 * tabs' row, as artboard 2 does.
 *
 * Data (spec §5.5.4): the cell's group in the WORKING COPY of the route that holds it (draftStore) —
 * an item column's group lives on the ITEM's route (decision 4, hence the shared notice and its
 * "צור מסלול נפרד למארז הזה", spec §3.2.1); every edit is setGroupFields on that route and autosaves.
 * The locked rows are the popup the station really opens (spec §10.3). ?field= focuses that row's name
 * (the map error bar's "עבור לשדה"). A URL naming a cell the map does not have goes back to the map.
 *
 * "הדבק מאקסל" (spec §5.14): the clipboard's rows go after the row that had the focus, else at the
 * end — one draft edit (cellFill). "שמור כערכה…" (spec §5.5.1; its dialog is not drawn): a new field
 * set with the cell's input fields; the cell does not change.
 *
 * Not here: "העתק מ…" / "העתק לפריטים…" (not drawn as dialogs) and "פריסת החלון" (phase 3).
 */

export type StationFieldEditorProps = {
  context: FieldsContextJson;
  model: FieldsMapModel;
  query: RouteQuery;
  onNavigate: (q: RouteQuery) => void;
  /** The ⋯'s "החל ערכה…": the host's apply-set dialog (artboard 9) on these cells (this one), and
   *  where the focus goes back once it closes (the ⋯). */
  onApplySet: (cells: MapCell[], returnFocus: HTMLElement | null) => void;
  /** Ask for the fields context again — after "צור מסלול נפרד למארז הזה". */
  reloadContext: () => void;
};

/** Where focus goes after the editor moved to another cell from its own controls. */
type NavFocus = "target" | "stop" | null;

export default function StationFieldEditor(props: StationFieldEditorProps) {
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

function CellEditor({ context, model, query, onNavigate, onApplySet, reloadContext, cell, navFocusRef }: CellEditorProps) {
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

  const setFields = React.useCallback(
    (next: Field[]) => store.edit(binding.route_id, (cfg) => setGroupFields(cfg, binding, stepMeta, next)),
    [store, binding, stepMeta],
  );

  const optionLists = useOptionLists().data;
  const { reload: reloadSets } = useFieldSets();
  const list = useFieldListEditor({ fields, setFields, lists: optionLists });
  const { popover, setPopover } = list;

  const [clearOpen, setClearOpen] = React.useState(false);
  const [saveSetOpen, setSaveSetOpen] = React.useState(false);
  const saved = useNotice();
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const pressedChipRef = React.useRef<HTMLButtonElement>(null);
  const currentStopRef = React.useRef<HTMLButtonElement>(null);
  const returnToMore = React.useCallback(() => moreRef.current, []);

  // "עבור לשדה" (?field=): that row's name.
  React.useEffect(() => {
    if (query.field) focusRowName(query.field);
  }, [query.field]);

  // Arrived from a chip or a stop of the previous cell's editor: focus its counterpart here.
  React.useEffect(() => {
    const from = navFocusRef.current;
    navFocusRef.current = null;
    if (from === "target") pressedChipRef.current?.focus();
    else if (from === "stop") currentStopRef.current?.focus();
  }, [navFocusRef]);

  const pasteTsv = (text: string): TsvPasteOutcome | null => {
    const rows = parseTsvRows(text);
    if (rows.length === 0) return null;
    const r = fillCell(cellStateOf(entry?.current, binding), tsvFields(rows, optionLists), { after: list.lastFocusedRow() });
    if (r.added.length > 0) {
      setFields(r.fields);
      list.requestFocus({ id: r.added[0].id, part: "name" });
    }
    return { added: r.added.length, skipped: r.skipped, overflow: r.overflow };
  };

  const goTo = (target: MapCell, from: NavFocus) => {
    navFocusRef.current = from;
    onNavigate(withEditor(query, target.binding.step_uid, target.binding.target));
  };

  // ---- derived ---------------------------------------------------------------------------------
  const stationTypeName = context.stations[cell.stepMeta.station_type_id]?.label?.trim() || cell.stationLabel;
  const popupKind = popupKindOf(stepMeta.station_type_id, cell.packageLevel, { hasTemplate: (typeId) => templateTypes?.has(typeId) ?? false });
  const role = popupKind === "package" ? kitStepRole(context, binding.step_uid) : null;
  const locked = lockedRowTexts(popupKind, role, binding.target);
  const stops = timelineStops(model, cell);
  const chips = targetChips(model, cell);
  const namedOf = (c: MapCell) => namedFieldCount(groupFieldsOf(drafts.routes[c.binding.route_id]?.current, c.binding.step_uid, c.binding.target));
  const showShared = !cell.packageLevel && cell.sharedWith.length > 0 && row?.routeNumber != null;
  const listName = (ref: VersionRef) => optionLists?.find((l) => l.id === ref.id)?.name ?? null;
  const cellMenuOpen = popover?.kind === "cellMenu";
  const menuItems: CellMenuItem[] = ["saveAsSet", "applySet", "clear"];
  const menuLabel = cellMenuText(menuItems);
  const hasInputFields = fields.some(isInputField);
  const n = column?.n ?? 1;
  const total = model.columns.length;

  return (
    <div className="sfe">
      <StationTimeline stops={stops} currentRef={currentStopRef} onGo={(c) => goTo(c, "stop")} />

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
                      setSaveSetOpen(true);
                    }}
                  >
                    {EDITOR_TEXT.saveAsSet}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setPopover(null);
                      onApplySet([cell], moreRef.current);
                    }}
                  >
                    {EDITOR_TEXT.applySet}
                  </MenuItem>
                  <MenuItem
                    danger
                    disabled={fields.length === 0}
                    onClick={() => {
                      setPopover(null);
                      setClearOpen(true);
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
                    ref={c.pressed ? pressedChipRef : undefined}
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

          <div className="sfe-card__body" onFocus={list.onListFocus}>
            {showShared && row?.routeNumber != null && (
              <SharedRouteNotice
                routeNumber={row.routeNumber}
                item={row.label}
                kits={cell.sharedWith.map((k) => k.desc)}
                fork={{
                  routeId: binding.route_id,
                  packageTypeId: context.subject.item_type_id,
                  kitName: context.subject.desc.trim(),
                  onReload: reloadContext,
                }}
              />
            )}
            <div className="sfe-locked">
              <Lock size={15} strokeWidth={1.75} aria-hidden />
              <span>{locked.top}</span>
            </div>
            <FieldRowsTable
              {...list.tableProps}
              publishedIds={publishedIds}
              issues={issues}
              stationLabel={cell.stationLabel}
              rowLabel={cell.rowLabel}
              listName={listName}
            />
            <AddFieldBar {...list.addBarProps} onAddSection={() => list.addField("section")} onPasteTsv={pasteTsv} />
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
            packageRole={role ?? undefined}
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
          list.reset();
          setFields([]);
        }}
      />
      <DialogReturnFocus.Provider value={returnToMore}>
        <SaveAsSetDialog
          open={saveSetOpen}
          defaultName={cellLabel(cell.stationLabel, cell.rowLabel)}
          fields={fields}
          onClose={() => setSaveSetOpen(false)}
          onSaved={(set) => {
            void reloadSets();
            saved.say(savedAsSetText(set.name));
          }}
        />
      </DialogReturnFocus.Provider>
      <NoticeSnackbar notice={saved.notice} onClose={saved.close} />
    </div>
  );
}
