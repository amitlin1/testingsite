"use client";
import * as React from "react";
import { ClipboardCheck, Info, Layers, Monitor } from "lucide-react";
import { Alert, Button, Skeleton, Tag } from "@/components/ui";
import { SUGGEST_PREFIX } from "@/app/lib/station-fields/labels";
import type { Field, FieldId } from "@/app/lib/station-fields/schema";
import { FieldRow, type UploadFieldPhoto } from "./FieldRow";
import { SuggestionLine } from "./SuggestionLine";
import { WORKER_UNDRAWN_TEXT } from "./labels";
import type { StationFieldsState } from "./useStationFields";
import { inputFieldCount, type Drafts, type FieldDraft } from "./useFieldsState";
import {
  BLOCK_TEXT, blockItems, blockStatus, fieldCountText, fieldRowIds, groupFields, rowState, statusRuns,
  type BlockItem, type FieldRowVariant, type FieldsBlockGroup, type FieldsBlockState, type FieldsBlockVariant,
} from "./fieldsBlockModel";
import "./fields.css";

/**
 * The station fields of a worker popup, as ONE block in the step where the worker already checks
 * (route-fields spec §4.4; artboards 12–18): a header — title · "{n} שדות" · "מהגדרות המסלול" ·
 * the status — over a white card of FieldRows. Each popup's own metrics and wording come from
 * its variant (fieldsBlockModel VARIANT_SPEC, fields.css):
 *
 *   station 12 VerdictStation · photo 13 PhotoStation · dialog 14 PopUpTestDialog ·
 *   wizard 15 the open wizard's box · kit-item 16 an item in the open wizard · pack 18 packing.
 *
 * Artboard 17 nests fields under each item inside the close wizard's one kit card: the host draws
 * PackFieldsBand once at the top of the card, then PackItemFields (or PackFieldsPending) under
 * each item row.
 *
 * Values: `fx` is useFieldsState() as it is, or draftsFieldsState() over drafts the host keeps in
 * its own state (the package wizards' per-item drafts). The suggestion line is the host's — under
 * its verdict question (VerdictCard `suggestion` in 12/13) — except in 14, where it closes the
 * block (`footer`), and in 17, where PackItemFields draws it under each item's fields.
 * "הכל תקין" (artboard 5) is phase 3: `allOk` stays off. The blue markNew frame is a design note
 * and is not drawn; the tag is.
 */

export interface FieldsBlockProps {
  variant: FieldsBlockVariant;
  /** The artboard's title: stationBlockTitle(stationTypeName) in 12/13, BLOCK_TITLE.* elsewhere. */
  title: string;
  /** One group for every block but a kit item's, whose groups carry their labels
   *  (kitItemFieldGroups). */
  groups: readonly FieldsBlockGroup[];
  fx: FieldsBlockState;
  /** Artboard 14 after the first "שמור וסיים": empty required fields show it on their row. */
  showRequiredErrors?: boolean;
  /** Prefix of the rows' ids (`${idPrefix}-c-${id}` / `-n-`); the host's React.useId() — one is
   *  made when it is left out. */
  idPrefix?: string;
  /** "הכל תקין" — phase 3 (spec §4.10). */
  allOk?: false;
  /** Under the card, inside the block (artboard 14: the SuggestionLine). */
  footer?: React.ReactNode;
  /** Uploads a photo field's shot (see FieldRow). */
  uploadPhoto?: UploadFieldPhoto;
  /** At the header's inline end, after the status. */
  headerExtra?: React.ReactNode;
}

const FOCUSABLE_CONTROL = "[data-fx-control] :is(input:not([type='file']), textarea, button):not(:disabled):not([tabindex='-1'])";

/** Moves the focus to the first control of the rows after `id` (spec §4.6: after a pick, the
 *  next row — for a list, focusing it opens it and closes the one before). */
function focusRowAfter(card: HTMLElement | null, id: FieldId) {
  if (!card) return;
  const rows = Array.from(card.querySelectorAll<HTMLElement>("[data-fx-row]"));
  const at = rows.findIndex((r) => r.dataset.fxRow === id);
  if (at < 0) return;
  for (const row of rows.slice(at + 1)) {
    const control = row.querySelector<HTMLElement>(FOCUSABLE_CONTROL);
    if (control) {
      control.focus();
      return;
    }
  }
}

function draftOf(drafts: Readonly<Drafts>, id: FieldId): FieldDraft | undefined {
  return Object.prototype.hasOwnProperty.call(drafts, id) ? drafts[id] : undefined;
}

/** The card and its lines (group labels, section titles, rows). */
function FieldsCard({ variant, title, groups, fx, prefix, showRequiredErrors, uploadPhoto }: {
  variant: FieldRowVariant; title: string; groups: readonly FieldsBlockGroup[]; fx: FieldsBlockState;
  prefix: string; showRequiredErrors: boolean; uploadPhoto: UploadFieldPhoto | undefined;
}) {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const items = blockItems(groups);
  // The open wizard's blocks name every group (artboards 15/16): its label, or the block's title.
  const groupsNamed = variant === "wizard" || variant === "kit-item";

  const line = (it: BlockItem, gi: number) => {
    if (it.kind === "mini") {
      // Spec §4.4 / §4.11.3: Layers for "לכל פריט", Monitor for the item type's group (artboard
      // 16 draws it for a screen; an icon for other types is not decided — spec §10.4).
      return (
        <div key="mini" id={`${prefix}-g${gi}`} className="tst-fx-mini" data-rule={it.rule || undefined}>
          {it.icon === "each" && <Layers size={12} strokeWidth={1.75} aria-hidden />}
          {it.icon === "type" && <Monitor size={12} strokeWidth={1.75} aria-hidden />}
          <span>{it.text}</span>
        </div>
      );
    }
    if (it.kind === "section") {
      return <div key={it.def.id} className="tst-fx-section" data-rule={it.rule || undefined}>{it.def.label}</div>;
    }
    const id = it.def.id;
    return (
      <FieldRow
        key={id} def={it.def} draft={draftOf(fx.drafts, id)} onChange={(patch) => fx.set(id, patch)}
        {...rowState(it.def, fx.ev, showRequiredErrors)} variant={variant} ids={fieldRowIds(prefix, id)}
        rule={it.rule} inMini={it.inMini} onFocusNext={() => focusRowAfter(cardRef.current, id)} uploadPhoto={uploadPhoto} />
    );
  };

  return (
    <div ref={cardRef} className={`tst-fx-card tst-fx-card--${variant}`}>
      {groups.map((g, gi) => {
        const lines = items.filter((it) => it.group === gi).map((it) => line(it, gi));
        if (g.mini) return <div key={gi} role="group" aria-labelledby={`${prefix}-g${gi}`}>{lines}</div>;
        if (groupsNamed) return <div key={gi} role="group" aria-label={title}>{lines}</div>;
        return <React.Fragment key={gi}>{lines}</React.Fragment>;
      })}
    </div>
  );
}

const RouteTag = () => <Tag tone="primary" size="sm">{BLOCK_TEXT.tag}</Tag>;

/** The block's title takes the keyboard focus when the block replaces a fallback that held it
 *  (after "נסה שוב" — FieldsBlockFallback). A ref callback: it runs as the title is attached. */
const focusIfFallbackHadIt = (title: HTMLElement | null) => {
  if (title && takeFocusFromFallback()) title.focus();
};

export function FieldsBlock({
  variant, title, groups, fx, showRequiredErrors = false, idPrefix, footer, uploadPhoto, headerExtra,
}: FieldsBlockProps) {
  const autoId = React.useId();
  const prefix = idPrefix ?? autoId;
  const titleId = `${prefix}-fx-title`;
  const defs: Field[] = groupFields(groups);
  const count = fieldCountText(inputFieldCount(defs));
  const status = blockStatus(variant, defs, fx.ev);
  const card = (
    <FieldsCard variant={variant} title={title} groups={groups} fx={fx} prefix={prefix}
      showRequiredErrors={showRequiredErrors} uploadPhoto={uploadPhoto} />
  );

  // Artboard 18: a labelled group with a small title, "·", the count and the tag — no status
  // (the next button says what is missing).
  if (variant === "pack") {
    return (
      <div role="group" aria-labelledby={titleId} className="tst-fx tst-fx--pack">
        <div className="tst-fx-head">
          <span id={titleId} ref={focusIfFallbackHadIt} tabIndex={-1} className="tst-fx-title">{title}</span>
          <span aria-hidden="true" className="tst-fx-sep">·</span>
          <span className="tst-fx-count">{count}</span>
          <RouteTag />
          {headerExtra}
        </div>
        {card}
        {footer}
      </div>
    );
  }

  const Heading = variant === "wizard" || variant === "kit-item" ? "h4" : "h3";
  return (
    <section aria-labelledby={titleId} className={`tst-fx tst-fx--${variant}`}>
      <div className="tst-fx-head">
        {variant === "dialog" ? (
          <>
            <ClipboardCheck size={18} strokeWidth={1.75} aria-hidden className="tst-fx-head-icon" />
            <Heading id={titleId} ref={focusIfFallbackHadIt} tabIndex={-1} className="tst-fx-title">{title}<span className="tst-fx-count">{count}</span></Heading>
          </>
        ) : (
          <>
            <Heading id={titleId} ref={focusIfFallbackHadIt} tabIndex={-1} className="tst-fx-title">{title}</Heading>
            <span className="tst-fx-count">{count}</span>
          </>
        )}
        <RouteTag />
        <span className="tst-fx-spacer" />
        {status && (
          <span role="status" className="tst-fx-status" data-tone={status.tone}>
            {statusRuns(status.text).map((run, i) => (run.ltr ? <bdi key={i} dir="ltr">{run.text}</bdi> : <React.Fragment key={i}>{run.text}</React.Fragment>))}
          </span>
        )}
        {headerExtra}
      </div>
      {card}
      {footer}
    </section>
  );
}

// ---- artboard 17: the close wizard's kit card ------------------------------------------------------
/** The band at the top of the kit card, before the item rows: "בדיקות בסגירה · {n} שדות" and the
 *  tag. `count` counts only the items whose fields are shown (17 `fieldCount`). Its title is the
 *  block's: it takes the focus from a fallback that held it, as FieldsBlock's does — the rows
 *  under it are new nodes by then (their wrapper became the item's group). */
export function PackFieldsBand({ title, count }: { title: string; count: number }) {
  return (
    <div className="tst-fx-band">
      <span ref={focusIfFallbackHadIt} tabIndex={-1} className="tst-fx-title">{title}</span>
      <span aria-hidden="true" className="tst-fx-sep">·</span>
      <span className="tst-fx-count">{fieldCountText(count)}</span>
      <RouteTag />
    </div>
  );
}

export interface PackItemFieldsProps {
  /** The kit item's fields, its groups flattened (useStationFields kitItemDefs). */
  fields: readonly Field[];
  fx: FieldsBlockState;
  /** Unique per item; one is made when it is left out. */
  idPrefix?: string;
  uploadPhoto?: UploadFieldPhoto;
  showRequiredErrors?: boolean;
}

/** Under one kit item's row (inside the host's role="group" wrapper of that item): its fields in
 *  a nested card of compact rows, then its own suggestion line (artboard 17). */
export function PackItemFields({ fields, fx, idPrefix, uploadPhoto, showRequiredErrors = false }: PackItemFieldsProps) {
  const autoId = React.useId();
  return (
    <div className="tst-fx-pack-item">
      <FieldsCard variant="pack-item" title="" groups={[{ fields }]} fx={fx} prefix={idPrefix ?? autoId}
        showRequiredErrors={showRequiredErrors} uploadPhoto={uploadPhoto} />
      <SuggestionLine fails={fx.ev.fails} defs={fields} prefix={SUGGEST_PREFIX} size="12.5" style={{ padding: "8px 2px 0" }} />
    </div>
  );
}

/** Under an item that has not arrived and has no decision yet (artboard 17). */
export function PackFieldsPending() {
  return (
    <div className="tst-fx-pending">
      <Info size={14} strokeWidth={1.75} aria-hidden />
      <span>{BLOCK_TEXT.pending}</span>
    </div>
  );
}

// ---- before the block can be drawn (spec §4.2) -------------------------------------------------
/** In the block's place while the step's fields load — three 44px skeleton rows — or after the
 *  load failed — the error with "נסה שוב" (both strings undrawn, labels.ts). Nothing for
 *  "legacy" or "ready". */
export function FieldsBlockFallback({ sf }: { sf: StationFieldsState }) {
  return sf.status === "loading" || sf.status === "error" ? <FallbackRegion sf={sf} /> : null;
}

// The keyboard focus across "נסה שוב" (spec §4.13: the window's focus model does not change).
// Pressing it removes the button, so the focus waits on the region (the same element through
// loading and error); if the fields fail again it goes back to the button; when the region gives
// way it goes to the block's title — or, with no block in its place, to the next control.

/** Set while a region that held the focus gives way: the block mounting in the same commit takes
 *  it (its title's ref callback runs in that commit, before the microtask that clears this). */
let focusFromFallback = false;
function takeFocusFromFallback(): boolean {
  const had = focusFromFallback;
  focusFromFallback = false;
  return had;
}

const TABBABLE = "a[href], button, input, select, textarea, [tabindex]";
/** The first control after `el` that Tab would reach, inside its dialog; null when there is none. */
function nextTabbable(el: HTMLElement): HTMLElement | null {
  const scope = el.closest<HTMLElement>('[role="dialog"]') ?? document.body;
  for (const c of Array.from(scope.querySelectorAll<HTMLElement>(TABBABLE))) {
    if (el.contains(c) || !(el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (c.tabIndex < 0 || c.matches(":disabled") || c.closest("[inert], [hidden]")) continue;
    if (c.getClientRects().length === 0) continue;   // not displayed
    return c;
  }
  return null;
}

/** A region holding the focus gives way (it is still in the page): the block that mounts in the
 *  same commit takes the focus; with none, the next control does once the commit is over. */
function passFocusOn(region: HTMLElement) {
  if (!region.contains(document.activeElement)) return;
  focusFromFallback = true;
  const next = nextTabbable(region);
  queueMicrotask(() => {
    if (takeFocusFromFallback() && next?.isConnected) next.focus();
  });
}

function FallbackRegion({ sf }: { sf: Extract<StationFieldsState, { status: "loading" | "error" }> }) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const retryRef = React.useRef<HTMLButtonElement>(null);
  const failed = sf.status === "error";

  // Failed again while the region held the focus: back to "נסה שוב".
  React.useLayoutEffect(() => {
    if (failed && document.activeElement === rootRef.current) retryRef.current?.focus();
  }, [failed]);

  // Giving way (a layout cleanup runs before React removes the region, so it is still in the page).
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    return () => {
      if (root) passFocusOn(root);
    };
  }, []);

  const retry = () => {
    rootRef.current?.focus();
    sf.reload();
  };

  return (
    <div ref={rootRef} tabIndex={-1} className="tst-fx-fallback" aria-busy={failed ? undefined : true}>
      {failed ? (
        <Alert severity="error" action={
          <Button ref={retryRef} variant="outlined" color="error" className="tst-fx-retry" onClick={retry}>{WORKER_UNDRAWN_TEXT.retry}</Button>
        }>
          {WORKER_UNDRAWN_TEXT.loadFailed}
        </Alert>
      ) : (
        <div className="tst-fx-skeleton">
          <Skeleton variant="rounded" width="100%" height={44} />
          <Skeleton variant="rounded" width="100%" height={44} />
          <Skeleton variant="rounded" width="100%" height={44} />
        </div>
      )}
    </div>
  );
}

export default FieldsBlock;
