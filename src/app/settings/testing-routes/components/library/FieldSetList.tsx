"use client";
import * as React from "react";
import { ChevronLeft, Info, Plus, Search } from "lucide-react";
import { Button, Skeleton, Tag, cn } from "@/components/ui";
import type { FieldSetJson, OptionListJson } from "@/app/lib/station-fields/admin-types";
import type { ResourceState } from "../../lib/useLibrary";
import type { LibraryTab } from "../../lib/routeQuery";
import { filterByName, setCounts } from "../../lib/libraryModel";
import {
  LIBRARY_UNDRAWN_TEXT, LIBRARY_TEXT, listRowLine, listsSegText, setRowLine, setsSegText,
} from "../../lib/libraryLabels";

/**
 * The library's list pane (artboard 8, spec §5.9 "חלונית הרשימה"), <section aria-label="ספריית ערכות
 * ורשימות">:
 *   - the segmented control (role="group" aria-label="תוכן הספרייה"): "ערכות שדות · {n}" |
 *     "רשימות אפשרויות · {n}";
 *   - h2 "ערכות שדות" / "רשימות אפשרויות" with outlined small "+ ערכה חדשה" / "+ רשימה חדשה";
 *   - the 40px pill search "חיפוש ערכה…" / "חיפוש רשימה…";
 *   - role="list" rows, 56px (the .stz-row pattern, aria-current on the open one): a set — its name
 *     (14/600), "{N} שדות · בשימוש ב-{n} תאים", Tag "לא בשימוש", the orange dot "שינויים שלא נשמרו";
 *     a list — its name, "{n} אפשרויות · בשימוש ב-{m} שדות" and its tone dots;
 *   - "אין תוצאות" + "אין ערכה בשם הזה. אפשר ליצור ערכה חדשה." / "אין רשימה בשם הזה." when no row is
 *     left (artboard 8 `noResults`: whenever the rows are empty);
 *   - the pearl footer with the tab's one-line explanation.
 * A load that failed is never an empty library: undrawn text and "נסה שוב".
 */

export type FieldSetListProps = {
  tab: LibraryTab;
  onTab: (tab: LibraryTab) => void;
  sets: ResourceState<FieldSetJson[]>;
  lists: ResourceState<OptionListJson[]>;
  onRetry: (tab: LibraryTab) => void;
  /** The open set / list (aria-current). */
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Sets with unsaved changes (the orange dot). */
  dirtyIds: ReadonlySet<number>;
  query: string;
  onQuery: (q: string) => void;
  /** "+ ערכה חדשה" (busy while it is created). */
  onNewSet: () => void;
  creatingSet: boolean;
  /** "+ רשימה חדשה" opens artboard 4 against this button. */
  newListRef: React.RefObject<HTMLButtonElement | null>;
  onNewList: () => void;
  /** A create that failed, under the header. */
  createError: string | null;
};

export function FieldSetList({
  tab, onTab, sets, lists, onRetry, selectedId, onSelect, dirtyIds, query, onQuery, onNewSet, creatingSet, newListRef,
  onNewList, createError,
}: FieldSetListProps) {
  const isSets = tab === "sets";
  const state = isSets ? sets : lists;
  const setRows = sets.status === "ready" ? sets.data : [];
  const listRows = lists.status === "ready" ? lists.data : [];
  const searchId = React.useId();
  const title = isSets ? LIBRARY_TEXT.setsTitle : LIBRARY_TEXT.listsTitle;
  const placeholder = isSets ? LIBRARY_TEXT.searchSets : LIBRARY_TEXT.searchLists;

  const shownSets = filterByName(setRows, query);
  const shownLists = filterByName(listRows, query);
  const shownCount = isSets ? shownSets.length : shownLists.length;

  return (
    <section aria-label={LIBRARY_TEXT.paneLabel} className="settings-card rf-lib-pane">
      <div className="rf-lib-pane__head">
        <div role="group" aria-label={LIBRARY_TEXT.segGroupLabel} className="rf-lib-seg">
          <button type="button" className="rf-lib-seg__btn" aria-pressed={isSets} onClick={() => onTab("sets")}>
            {setsSegText(setRows.length)}
          </button>
          <button type="button" className="rf-lib-seg__btn" aria-pressed={!isSets} onClick={() => onTab("lists")}>
            {listsSegText(listRows.length)}
          </button>
        </div>
        <div className="rf-lib-pane__title-row">
          <h2 className="rf-lib-pane__title">{title}</h2>
          {isSets ? (
            <Button
              variant="outlined"
              size="small"
              className="rf-lib-pane__new"
              loading={creatingSet}
              startIcon={<Plus size={15} strokeWidth={1.75} aria-hidden />}
              onClick={onNewSet}
            >
              {LIBRARY_TEXT.newSet}
            </Button>
          ) : (
            <Button
              ref={newListRef}
              variant="outlined"
              size="small"
              className="rf-lib-pane__new"
              aria-haspopup="dialog"
              startIcon={<Plus size={15} strokeWidth={1.75} aria-hidden />}
              onClick={onNewList}
            >
              {LIBRARY_TEXT.newList}
            </Button>
          )}
        </div>
        {createError && <span role="alert" className="rf-lib-error">{createError}</span>}
        <div className="rf-lib-search">
          <label htmlFor={searchId} className="sfe-sr">{placeholder}</label>
          <Search size={18} strokeWidth={1.75} className="rf-lib-search__icon" aria-hidden />
          <input
            id={searchId}
            type="search"
            className="rf-lib-search__input"
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
      </div>

      {state.status === "loading" && (
        <div className="rf-lib-rows" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rf-lib-row rf-lib-row--skeleton">
              <Skeleton width="55%" height={14} />
              <Skeleton width="35%" height={12} />
            </div>
          ))}
        </div>
      )}

      {state.status === "error" && (
        <div className="rf-lib-empty">
          <span className="rf-lib-empty__title">{LIBRARY_UNDRAWN_TEXT.loadFailed}</span>
          <Button variant="outlined" color="inherit" size="small" loading={state.retrying} onClick={() => onRetry(tab)}>
            {LIBRARY_UNDRAWN_TEXT.retry}
          </Button>
        </div>
      )}

      {state.status === "ready" && (
        <>
          <div role="list" aria-label={title} className="rf-lib-rows">
            {isSets
              ? shownSets.map((s) => {
                const counts = setCounts(s.fields);
                const on = s.id === selectedId;
                return (
                  <div role="listitem" key={s.id}>
                    <button
                      type="button"
                      className="stz-row rf-lib-row"
                      data-selected={on || undefined}
                      aria-current={on ? "true" : undefined}
                      onClick={() => onSelect(s.id)}
                    >
                      <span className="rf-lib-row__text">
                        <span className="rf-lib-row__name">{s.name}</span>
                        <span className="rf-lib-row__line">{setRowLine(counts.fields, s.usage.cells)}</span>
                      </span>
                      {s.usage.cells === 0 && <Tag tone="neutral">{LIBRARY_TEXT.unused}</Tag>}
                      {dirtyIds.has(s.id) && <span className="rf-lib-row__dirty" title={LIBRARY_TEXT.unsaved} />}
                      <ChevronLeft size={16} strokeWidth={1.75} className="rf-lib-row__chev" aria-hidden />
                    </button>
                  </div>
                );
              })
              : shownLists.map((l) => {
                const on = l.id === selectedId;
                return (
                  <div role="listitem" key={l.id}>
                    <button
                      type="button"
                      className="stz-row rf-lib-row"
                      data-selected={on || undefined}
                      aria-current={on ? "true" : undefined}
                      onClick={() => onSelect(l.id)}
                    >
                      <span className="rf-lib-row__text">
                        <span className="rf-lib-row__name">{l.name}</span>
                        <span className="rf-lib-row__line">{listRowLine(l.options.length, l.usage.fields)}</span>
                      </span>
                      <span className="rf-lib-row__dots" aria-hidden="true">
                        {l.options.map((o) => <span key={o.id} className="rf-tone-dot" data-tone={o.tone} />)}
                      </span>
                      <ChevronLeft size={16} strokeWidth={1.75} className="rf-lib-row__chev" aria-hidden />
                    </button>
                  </div>
                );
              })}
          </div>
          {shownCount === 0 && (
            <div className={cn("rf-lib-empty", "rf-lib-empty--rule")}>
              <span className="rf-lib-empty__title">{LIBRARY_TEXT.noResults}</span>
              <span className="rf-lib-empty__body">{isSets ? LIBRARY_TEXT.noSets : LIBRARY_TEXT.noLists}</span>
            </div>
          )}
        </>
      )}

      <div className="rf-lib-pane__foot">
        <Info size={16} strokeWidth={1.75} className="rf-lib-pane__foot-icon" aria-hidden />
        <span>{isSets ? LIBRARY_TEXT.setsFoot : LIBRARY_TEXT.listsFoot}</span>
      </div>
    </section>
  );
}

export default FieldSetList;
