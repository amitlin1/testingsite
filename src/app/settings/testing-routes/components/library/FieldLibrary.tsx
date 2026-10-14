"use client";
import * as React from "react";
import { newFieldId } from "@/app/lib/station-fields/step-uids";
import type { LibraryTab, RouteQuery } from "../../lib/routeQuery";
import { withLibrary } from "../../lib/routeQuery";
import { copyName, copySetFields, setDraftDirty } from "../../lib/libraryModel";
import type { SetDraft, SetOrigin } from "../../lib/libraryModel";
import { LIBRARY_COPY_PENDING, LIBRARY_TEXT } from "../../lib/libraryLabels";
import { createFieldSet, createOptionList, useFieldSets, useOptionLists, useRouteIndex } from "../../lib/useLibrary";
import { OptionListPopover } from "../editor/OptionListPopover";
import { FieldSetList } from "./FieldSetList";
import { FieldSetEditor } from "./FieldSetEditor";
import { OptionListDetail } from "./OptionListDetail";
import "./library.css";

/**
 * "ערכות ורשימות" — `view=library` (artboard 8, spec §5.9): the field sets and the shared option lists,
 * global to every route (the page draws no context card here). Two panes on the .stations-grid pattern
 * (330px + flexible, 20 apart; one column under 900px):
 *   FieldSetList       the segmented sets | lists, "+ ערכה חדשה" / "+ רשימה חדשה", search, rows, footer
 *   FieldSetEditor     the open set (lib=sets)
 *   OptionListDetail   the open list (lib=lists)
 * The tab and the open item are the URL's (`lib`, `id` — routeQuery.withLibrary); without an id the
 * first one opens. Unsaved edits of each set are kept here, so the list shows their dot while another
 * set is open (they are not kept when the screen leaves the library).
 *
 * "+ ערכה חדשה" creates "ערכה חדשה" at once (POST, artboard 8 `addSet`) and opens it — its meta reads
 * "נוצרה עכשיו · {user}"; "שכפל" creates "{name} · עותק" from the working copy ("שוכפלה מ: {name}").
 * "+ רשימה חדשה" and "עריכת האפשרויות" open artboard 4 (OptionListPopover, library mode).
 *
 * Needs the page's DraftStoreProvider above it: a saved list and "עדכן את כולם" reach the linked
 * fields of the routes the screen holds.
 */

export type FieldLibraryProps = {
  query: RouteQuery;
  onNavigate: (q: RouteQuery) => void;
  /** The set editor's "החל על תאים…" (artboard 8 → 9): the page takes the set to the map. Without it
   *  the button is not drawn. */
  onApplyToCells?: (setId: number) => void;
};

/** The artboard-4 popover: a new list (against "+ רשימה חדשה") or the open list's options. Kept after
 *  it closes, so the focus goes back to the button that opened it. */
type ListPopover = { listId: number | null; open: boolean };

export function FieldLibrary({ query, onNavigate, onApplyToCells }: FieldLibraryProps) {
  const sets = useFieldSets();
  const lists = useOptionLists();
  const routes = useRouteIndex();
  const { reload: reloadSets } = sets;
  const { reload: reloadLists } = lists;
  const { reload: reloadRoutes } = routes;

  // Entering the library: the answers of now (another tab or admin may have changed them).
  React.useEffect(() => {
    void reloadSets();
    void reloadLists();
    void reloadRoutes();
  }, [reloadSets, reloadLists, reloadRoutes]);

  const tab: LibraryTab = query.lib ?? "sets";
  const allSets = React.useMemo(() => sets.data ?? [], [sets.data]);
  const allLists = React.useMemo(() => lists.data ?? [], [lists.data]);
  const openSet = tab === "sets" ? allSets.find((s) => s.id === query.id) ?? allSets[0] ?? null : null;
  const openList = tab === "lists" ? allLists.find((l) => l.id === query.id) ?? allLists[0] ?? null : null;

  const [search, setSearch] = React.useState<Record<LibraryTab, string>>({ sets: "", lists: "" });
  const [drafts, setDrafts] = React.useState<Readonly<Record<number, SetDraft>>>({});
  const [origins, setOrigins] = React.useState<Readonly<Record<number, SetOrigin>>>({});
  const [creating, setCreating] = React.useState<"set" | "dup-set" | "dup-list" | null>(null);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [listPopover, setListPopover] = React.useState<ListPopover>({ listId: null, open: false });
  const newListRef = React.useRef<HTMLButtonElement>(null);
  const editListRef = React.useRef<HTMLButtonElement>(null);

  // A draft is only kept while it differs from the set as saved now.
  const dirtyIds = React.useMemo(() => {
    const ids = new Set<number>();
    for (const s of allSets) if (setDraftDirty(s, drafts[s.id] ?? null)) ids.add(s.id);
    return ids;
  }, [allSets, drafts]);

  const openSetId = (id: number | null) => onNavigate(withLibrary(query, "sets", id));
  const openListId = (id: number | null) => onNavigate(withLibrary(query, "lists", id));

  const newSet = async () => {
    if (creating) return;
    setCreating("set");
    setCreateError(null);
    const r = await createFieldSet({ name: LIBRARY_TEXT.newSetName, fields: [] });
    setCreating(null);
    if (!r.ok) {
      setCreateError(LIBRARY_COPY_PENDING.createFailed);
      return;
    }
    setOrigins((o) => ({ ...o, [r.data.id]: { kind: "created" } }));
    setSearch((s) => ({ ...s, sets: "" }));
    await reloadSets();
    openSetId(r.data.id);
  };

  const duplicateSet = async () => {
    if (!openSet || creating) return;
    const from = drafts[openSet.id] ?? { name: openSet.name, fields: openSet.fields };
    setCreating("dup-set");
    setCreateError(null);
    const r = await createFieldSet({ name: copyName(from.name), fields: copySetFields(from.fields, () => newFieldId()) });
    setCreating(null);
    if (!r.ok) {
      setCreateError(LIBRARY_COPY_PENDING.createFailed);
      return;
    }
    setOrigins((o) => ({ ...o, [r.data.id]: { kind: "duplicated", from: from.name } }));
    setSearch((s) => ({ ...s, sets: "" }));
    await reloadSets();
    openSetId(r.data.id);
  };

  const duplicateList = async () => {
    if (!openList || creating) return;
    setCreating("dup-list");
    setCreateError(null);
    const r = await createOptionList({ name: copyName(openList.name), options: openList.options.map((o) => ({ ...o })) });
    setCreating(null);
    if (!r.ok) {
      setCreateError(LIBRARY_COPY_PENDING.createFailed);
      return;
    }
    setSearch((s) => ({ ...s, lists: "" }));
    await reloadLists();
    openListId(r.data.id);
  };

  return (
    <div className="stations-grid rf-lib">
      <FieldSetList
        tab={tab}
        onTab={(t) => {
          setCreateError(null);
          onNavigate(withLibrary(query, t, null));
        }}
        sets={sets.state}
        lists={lists.state}
        onRetry={(t) => void (t === "sets" ? reloadSets() : reloadLists())}
        selectedId={tab === "sets" ? openSet?.id ?? null : openList?.id ?? null}
        onSelect={(id) => (tab === "sets" ? openSetId(id) : openListId(id))}
        dirtyIds={dirtyIds}
        query={search[tab]}
        onQuery={(q) => setSearch((s) => ({ ...s, [tab]: q }))}
        onNewSet={() => void newSet()}
        creatingSet={creating === "set"}
        newListRef={newListRef}
        onNewList={() => setListPopover((p) => ({ listId: null, open: !(p.open && p.listId == null) }))}
        createError={createError}
      />

      {openSet && (
        <FieldSetEditor
          key={openSet.id}
          set={openSet}
          draft={dirtyIds.has(openSet.id) ? drafts[openSet.id] ?? null : null}
          onDraftChange={(next) =>
            setDrafts((d) => {
              const out = { ...d };
              if (next) out[openSet.id] = next;
              else delete out[openSet.id];
              return out;
            })}
          origin={origins[openSet.id] ?? null}
          lists={lists.data}
          routes={routes.data}
          query={query}
          onNavigate={onNavigate}
          onDuplicate={duplicateSet}
          duplicating={creating === "dup-set"}
          reloadSets={reloadSets}
          onApplyToCells={onApplyToCells ? () => onApplyToCells(openSet.id) : undefined}
        />
      )}

      {openList && (
        <OptionListDetail
          key={openList.id}
          list={openList}
          sets={allSets}
          query={query}
          onNavigate={onNavigate}
          editRef={editListRef}
          editOpen={listPopover.open && listPopover.listId === openList.id}
          onEdit={() => setListPopover((p) => ({ listId: openList.id, open: !(p.open && p.listId === openList.id) }))}
          onDuplicate={duplicateList}
          duplicating={creating === "dup-list"}
          reloadLists={reloadLists}
        />
      )}

      {/* Its content mounts on every opening, so each opening starts a working copy of its own. */}
      <OptionListPopover
        open={listPopover.open}
        onOpenChange={(o) => {
          if (!o) setListPopover((p) => ({ ...p, open: false }));
        }}
        anchorRef={listPopover.listId == null ? newListRef : editListRef}
        library={{
          listId: listPopover.listId,
          onSaved: (id) => openListId(id),
        }}
      />
    </div>
  );
}

export default FieldLibrary;
