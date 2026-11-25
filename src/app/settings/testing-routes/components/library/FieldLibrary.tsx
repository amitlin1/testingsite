"use client";
import * as React from "react";
import { newFieldId } from "@/app/lib/station-fields/step-uids";
import type { LibraryTab, RouteQuery } from "../../lib/routeQuery";
import { withLibrary } from "../../lib/routeQuery";
import { copyName, copySetFields, setDraftDirty } from "../../lib/libraryModel";
import type { SetDraft, SetOrigin } from "../../lib/libraryModel";
import { LIBRARY_UNDRAWN_TEXT, LIBRARY_TEXT } from "../../lib/libraryLabels";
import { createFieldSet, createOptionList } from "../../lib/libraryWrites";
import type { LibraryResult } from "../../lib/libraryWrites";
import { useFieldSets, useOptionLists, useRoutes } from "../../lib/resources";
import { OptionListPopover } from "../editor/OptionListPopover";
import { FieldSetList } from "./FieldSetList";
import { FieldSetEditor } from "./FieldSetEditor";
import { OptionListDetail } from "./OptionListDetail";
import "./library.css";

/**
 * "ערכות ורשימות" — `view=library` (artboard 8, spec §5.9): the field sets and the shared option lists,
 * global to every route. The list pane, and the open set (lib=sets) or list (lib=lists): the tab and
 * the open item are the URL's (routeQuery.withLibrary); without an id the first one opens. Unsaved
 * edits of each set are kept here, so the list shows their dot while another set is open (they are not
 * kept when the screen leaves the library).
 *
 * "+ ערכה חדשה" creates the set at once (POST, artboard 8 `addSet`) and opens it; "שכפל" creates a copy
 * from the working copy. "+ רשימה חדשה" and "עריכת האפשרויות" open artboard 4 (OptionListPopover,
 * library mode).
 *
 * Needs the page's DraftStoreProvider above it: a saved list and "עדכן את כולם" reach the linked
 * fields of the routes the screen holds.
 */

export type FieldLibraryProps = {
  query: RouteQuery;
  onNavigate: (q: RouteQuery) => void;
  /** The set editor's "החל על תאים…" (artboard 8 → 9): the page takes the set to the map. */
  onApplyToCells: (setId: number) => void;
};

/** The artboard-4 popover: a new list (against "+ רשימה חדשה") or the open list's options. Kept after
 *  it closes, so the focus goes back to the button that opened it. */
type ListPopover = { listId: number | null; open: boolean };

export default function FieldLibrary({ query, onNavigate, onApplyToCells }: FieldLibraryProps) {
  const sets = useFieldSets();
  const lists = useOptionLists();
  const routes = useRoutes();
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

  /** A new set or list: written, then the tab's search cleared, the list read again and the new one
   *  opened; a failure is shown under the list's header. */
  const create = async (kind: NonNullable<typeof creating>, into: LibraryTab, write: () => Promise<LibraryResult<{ id: number }>>, origin?: SetOrigin) => {
    setCreating(kind);
    setCreateError(null);
    const r = await write();
    setCreating(null);
    if (!r.ok) {
      setCreateError(LIBRARY_UNDRAWN_TEXT.createFailed);
      return;
    }
    const id = r.data.id;
    if (origin) setOrigins((o) => ({ ...o, [id]: origin }));
    setSearch((s) => ({ ...s, [into]: "" }));
    if (into === "sets") {
      await reloadSets();
      openSetId(id);
    } else {
      await reloadLists();
      openListId(id);
    }
  };

  const newSet = async () => {
    if (creating) return;
    await create("set", "sets", () => createFieldSet({ name: LIBRARY_TEXT.newSetName, fields: [] }), { kind: "created" });
  };

  const duplicateSet = async () => {
    if (!openSet || creating) return;
    const from = drafts[openSet.id] ?? { name: openSet.name, fields: openSet.fields };
    await create(
      "dup-set",
      "sets",
      () => createFieldSet({ name: copyName(from.name), fields: copySetFields(from.fields, () => newFieldId()) }),
      { kind: "duplicated", from: from.name },
    );
  };

  const duplicateList = async () => {
    if (!openList || creating) return;
    await create("dup-list", "lists", () => createOptionList({ name: copyName(openList.name), options: openList.options.map((o) => ({ ...o })) }));
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
          onApplyToCells={() => onApplyToCells(openSet.id)}
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
