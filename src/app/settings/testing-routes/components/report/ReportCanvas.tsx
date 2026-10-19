"use client";

// Ported from ticketflow (src/components/form/PdfCanvas.tsx).
//
// Custom editor canvas + palette for the PDF template builder.
//
// WHY custom (not Puck.Preview): Puck renders the whole document in ONE
// continuous drop zone, so it can't show the document as discrete A4 sheets.
// We render the sheets ourselves from Puck's store (usePuck) — separate A4
// pages, each with the footer at its bottom — and do drag/drop with the native
// HTML5 API (Puck still owns STATE + the properties panel via Puck.Fields).
//
// Model: `content` is a flat node list; `PageBreak` nodes delimit pages.
// Each component's own `render` (from puckConfig) draws the block — identical
// to the server PDF renderer, so the canvas is true WYSIWYG.

import * as React from "react";
import { usePuck } from "@measured/puck";
import { Copy, GripVertical, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { puckConfig, HeaderBand, WIDTH_MM, pageNumberTemplate } from "@/app/lib/item-report/puck-config";
import type { ReportRenderMeta as PdfRenderMeta } from "@/app/lib/item-report/types";
import { Button, ConfirmDialog } from "@/components/ui";

type Node = { type: string; props: Record<string, unknown> & { id?: string } };

// Stable fallback so `content` (a useMemo dependency) doesn't change identity
// on every render while the store has no content yet.
const NO_NODES: Node[] = [];

const COMPONENTS = puckConfig.components as any;

const labelOf = (t: string): string => COMPONENTS[t]?.label ?? t;

// Split a row into N equal columns → the width name for each.
const equalWidth = (n: number): string =>
  n <= 1 ? "full" : n === 2 ? "half" : n === 3 ? "third" : "quarter";

function renderBlock(node: Node, meta: PdfRenderMeta): React.ReactNode {
  const comp = COMPONENTS[node.type];
  if (!comp) return null;
  return comp.render({
    ...node.props,
    puck: {
      metadata: meta as unknown as Record<string, unknown>,
      isEditing: true,
      dragRef: () => undefined,
      renderDropZone: () => null,
    },
  });
}

let idCounter = 0;
function newId(type: string): string {
  idCounter += 1;
  return `${type}-${Date.now().toString(36)}-${idCounter}`;
}

// The active drag's source, shared between the palette and the canvas. We need
// it during `dragover` (to preview the live reflow), but the HTML5
// `dataTransfer` is NOT readable during dragover — only on drop — so we stash
// the source here on dragstart and clear it on dragend. Lives outside React on
// purpose (it's per drag gesture, not render state); only event handlers write
// it, through `setDragSource`.
type DragSource = { kind: "new"; type: string } | { kind: "move"; index: number };
let dragSource: DragSource | null = null;
const getDragSource = (): DragSource | null => dragSource;
function setDragSource(next: DragSource | null): void {
  dragSource = next;
}

// ---- confirm (the app's shared dialog, layered above the editor) --------
interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

// ---- palette (custom, HTML5-draggable) ----------------------------------
export function BlockPalette() {
  const cats = (puckConfig.categories ?? {}) as Record<string, any>;
  return (
    <div className="pdfpal">
      {Object.entries(cats).map(([key, cat]) => {
        if (key === "other" || cat?.visible === false) return null;
        const items = (cat?.components ?? []) as string[];
        if (items.length === 0) return null;
        return (
          <div key={key} className="pdfpal__cat">
            <div className="pdfpal__cat-title">{cat?.title ?? key}</div>
            {items.map((type) => (
              <div
                key={type}
                className="pdfpal__chip"
                draggable
                onDragStart={(e) => {
                  setDragSource({ kind: "new", type });
                  e.dataTransfer.setData("text/pdf-new", type);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onDragEnd={() => {
                  setDragSource(null);
                }}
              >
                <span className="pdfpal__label">{labelOf(type)}</span>
                <span className="pdfpal__grip" aria-hidden="true">
                  <GripVertical size={14} aria-hidden />
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ---- canvas (discrete A4 sheets) ----------------------------------------
interface Page {
  start: number; // global content index where this page's blocks begin
  breakIndex: number | null; // global index of the PageBreak that STARTS this page (null for page 1)
  blocks: { node: Node; index: number }[];
}

// The live drop target:
//  - "into"   → drop INTO a row (share it): the row redistributes to equal
//               columns and a ghost slot appears at `slot` (0..member count).
//  - "newrow" → a NEW full-width row inserted before page-local block
//               `atLocalKey` (== page.blocks.length → appended at the page end).
type Drop =
  | { page: number; kind: "into"; rowKeys: number[]; slot: number }
  | { page: number; kind: "newrow"; atLocalKey: number };

export function PageCanvas({ metadata }: { metadata: PdfRenderMeta }) {
  const { appState, dispatch, history } = usePuck() as any;
  const content = (appState?.data?.content ?? NO_NODES) as Node[];
  const rootProps = (appState?.data?.root?.props ?? {}) as any;
  const header = rootProps.header ?? {};
  const footer = rootProps.footer ?? {};
  const border: string = rootProps.border ?? "none";
  const selIdx = (appState?.ui?.itemSelector?.index ?? null) as number | null;

  const setContent = React.useCallback(
    (next: Node[]) => {
      dispatch({ type: "setData", data: { content: next } } as any);
    },
    [dispatch],
  );
  const select = React.useCallback(
    (index: number | null) => {
      dispatch({ type: "setUi", ui: { itemSelector: index == null ? null : { index } } } as any);
    },
    [dispatch],
  );

  // Split the flat content into pages by PageBreak.
  const pages: Page[] = React.useMemo(() => {
    const out: Page[] = [];
    let cur: Page = { start: 0, breakIndex: null, blocks: [] };
    content.forEach((node, i) => {
      if (node.type === "PageBreak") {
        out.push(cur);
        cur = { start: i + 1, breakIndex: i, blocks: [] };
      } else {
        cur.blocks.push({ node, index: i });
      }
    });
    out.push(cur);
    return out;
  }, [content]);

  // `drop` (state) drives the visible indicator; `dropRef` mirrors it so the
  // drop handler reads the LATEST target even when `drop` fires in the same
  // tick as the last `dragover` (before React re-renders).
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null);
  const [drop, setDropState] = React.useState<Drop | null>(null);
  const dropRef = React.useRef<Drop | null>(null);
  const setDrop = (d: Drop | null) => {
    dropRef.current = d;
    setDropState(d);
  };
  const clearDrop = () => setDrop(null);

  // Clear the transient drag state whenever ANY drag ends (drop, Esc, or
  // released outside the canvas) so nothing gets left in a "dragging" look.
  React.useEffect(() => {
    const onEnd = () => {
      setDragSource(null);
      dropRef.current = null;
      setDropState(null);
    };
    window.addEventListener("dragend", onEnd);
    return () => window.removeEventListener("dragend", onEnd);
  }, []);

  // Detect the drop target from the pointer vs the CURRENT block rects.
  // Crucially, the horizontal slot is measured against the flow's FIXED
  // content width — not the (shifting) member positions — so the same pointer
  // always maps to the same slot even while the row is previewing a reflow.
  const detect = (
    pageIdx: number,
    page: Page,
    flowEl: HTMLElement,
    clientX: number,
    clientY: number,
  ): Drop => {
    const els = Array.from(flowEl.querySelectorAll<HTMLElement>(".pdfed-blockwrap"));
    if (els.length === 0) return { page: pageIdx, kind: "newrow", atLocalKey: 0 };
    // Group blocks into visual rows by their vertical band (DOM order === block
    // order). `data-k` carries the block's page-local key (source is skipped in
    // the DOM while dragging, so read the key rather than the array position).
    type Row = { keys: number[]; top: number; bottom: number };
    const rows: Row[] = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // hidden (dragged) source
      const k = Number(el.dataset.k);
      const last = rows[rows.length - 1];
      if (last && r.top < last.bottom - 4) {
        last.keys.push(k);
        last.top = Math.min(last.top, r.top);
        last.bottom = Math.max(last.bottom, r.bottom);
      } else {
        rows.push({ keys: [k], top: r.top, bottom: r.bottom });
      }
    }
    if (rows.length === 0) return { page: pageIdx, kind: "newrow", atLocalKey: 0 };
    // Which row is the pointer in?
    const ri = rows.findIndex((r) => clientY >= r.top && clientY <= r.bottom);
    if (ri < 0) {
      if (clientY < rows[0]!.top) return { page: pageIdx, kind: "newrow", atLocalKey: rows[0]!.keys[0]! };
      if (clientY > rows[rows.length - 1]!.bottom)
        return { page: pageIdx, kind: "newrow", atLocalKey: page.blocks.length };
      const below = rows.findIndex((r) => r.top > clientY);
      return { page: pageIdx, kind: "newrow", atLocalKey: rows[below < 0 ? rows.length - 1 : below]!.keys[0]! };
    }
    const row = rows[ri]!;
    const band = Math.max(1, row.bottom - row.top);
    const relY = (clientY - row.top) / band;
    // Near the top/bottom edge → a NEW full-width row above/below.
    if (relY < 0.24) return { page: pageIdx, kind: "newrow", atLocalKey: row.keys[0]! };
    if (relY > 0.76) return { page: pageIdx, kind: "newrow", atLocalKey: row.keys[row.keys.length - 1]! + 1 };
    // Middle band → INTO the row: pick the slot from X across the flow width.
    const fr = flowEl.getBoundingClientRect();
    const ds = getDragSource();
    const srcInRow =
      ds?.kind === "move" && row.keys.some((k) => page.blocks[k]?.index === ds.index);
    const memberCount = row.keys.length - (srcInRow ? 1 : 0);
    const slots = memberCount + 1;
    const slotW = (fr.width || 1) / slots;
    // RTL: slot 0 is the rightmost, so measure from the right edge.
    const slot = Math.max(0, Math.min(memberCount, Math.floor((fr.right - clientX) / slotW)));
    return { page: pageIdx, kind: "into", rowKeys: row.keys, slot };
  };

  const handleDrop = (pageIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const d = dropRef.current && dropRef.current.page === pageIdx ? dropRef.current : null;
    const src = getDragSource();
    setDrop(null);
    setDragSource(null);
    const page = pages[pageIdx]!;
    if (!d || !src) return;

    // Node to place + the moved-from index (−1 for a new block).
    let node: Node;
    let from = -1;
    if (src.kind === "new") {
      const comp = COMPONENTS[src.type];
      node = { type: src.type, props: { id: newId(src.type), ...(comp?.defaultProps ?? {}) } };
    } else {
      from = src.index;
      const existing = content[from];
      if (!existing) return;
      node = existing;
    }

    // Resolve: placed width, the anchor to insert next to, and (for "into") the
    // row members that must resize to equal columns.
    let placedWidth = "full";
    let anchorId: string | null = null;
    let after = false;
    const memberWidthIds: string[] = [];

    if (d.kind === "newrow") {
      if (d.atLocalKey < page.blocks.length) {
        anchorId = page.blocks[d.atLocalKey]!.node.props.id ?? null;
      } else if (page.blocks.length > 0) {
        anchorId = page.blocks[page.blocks.length - 1]!.node.props.id ?? null;
        after = true;
      }
    } else {
      const sourceKey = from >= 0 ? page.blocks.findIndex((b) => b.index === from) : -1;
      const memberKeys = d.rowKeys.filter((k) => k !== sourceKey);
      placedWidth = equalWidth(memberKeys.length + 1);
      for (const k of memberKeys) {
        const id = page.blocks[k]!.node.props.id;
        if (id) memberWidthIds.push(id);
      }
      if (d.slot >= memberKeys.length) {
        anchorId = memberKeys.length ? page.blocks[memberKeys[memberKeys.length - 1]!]!.node.props.id ?? null : null;
        after = true;
      } else {
        anchorId = page.blocks[memberKeys[d.slot]!]!.node.props.id ?? null;
      }
    }

    // Build the next content: remove source (move), resize row members, insert.
    node = { ...node, props: { ...node.props, width: placedWidth } };
    let next = content.filter((_, i) => i !== from); // from<0 → filters nothing
    if (memberWidthIds.length) {
      const wset = new Set(memberWidthIds);
      next = next.map((n) =>
        n.props?.id && wset.has(n.props.id) ? { ...n, props: { ...n.props, width: placedWidth } } : n,
      );
    }
    let idx: number;
    if (anchorId == null) {
      idx = page.start - (from >= 0 && from < page.start ? 1 : 0); // empty page
    } else {
      const ai = next.findIndex((n) => n.props?.id === anchorId);
      idx = ai < 0 ? next.length : after ? ai + 1 : ai;
    }
    next.splice(idx, 0, node);
    setContent(next);
    select(idx);
  };

  const addPage = () => {
    setContent([...content, { type: "PageBreak", props: { id: newId("PageBreak") } }]);
  };
  const removePage = (page: Page) => {
    if (page.breakIndex == null) return;
    const end = page.blocks.length > 0 ? page.blocks[page.blocks.length - 1]!.index + 1 : page.breakIndex + 1;
    setContent([...content.slice(0, page.breakIndex), ...content.slice(end)]);
  };
  const deletePage = (page: Page, pageNo: number) => {
    if (page.breakIndex == null) return;
    // Empty page → delete straight away; page with content → confirm first.
    if (page.blocks.length === 0) {
      removePage(page);
      return;
    }
    setConfirm({
      title: `מחיקת עמוד ${pageNo}`,
      message: `בעמוד יש ${page.blocks.length} בלוקים. מחיקת העמוד תמחק גם אותם. להמשיך?`,
      confirmLabel: "מחיקת העמוד",
      danger: true,
      onConfirm: () => removePage(page),
    });
  };
  const deleteBlock = (globalIndex: number) => {
    setContent(content.filter((_, i) => i !== globalIndex));
    select(null);
  };
  const duplicateBlock = (globalIndex: number) => {
    const n = content[globalIndex] as Node | undefined;
    if (!n) return;
    const copy: Node = { ...n, props: { ...n.props, id: newId(n.type) } };
    const next = [...content];
    next.splice(globalIndex + 1, 0, copy);
    setContent(next);
    select(globalIndex + 1);
  };

  const pageCount = pages.length;
  const pageNumStr = (pi: number): string =>
    pageNumberTemplate(footer.pageNumberStyle)
      .replace(/\{page\}/g, String(pi + 1))
      .replace(/\{pages\}/g, String(pageCount));
  const frameStyle =
    border && border !== "none"
      ? { boxShadow: "var(--shadow-pop, 0 4px 14px rgba(17,21,31,.12))", outline: "none" }
      : undefined;

  return (
    <div
      className="pdfed__center"
      onDragEnd={clearDrop}
      onClick={(e) => {
        // Click on empty canvas / sheet background → deselect → show document
        // (header / footer / border) settings in the properties panel.
        if (!(e.target as HTMLElement).closest(".pdfed-blockwrap")) select(null);
      }}
    >
      <div className="pdfed-history" onClick={(e) => e.stopPropagation()}>
        <Button size="small" variant="outlined" startIcon={<Undo2 size={14} style={{ transform: "scaleX(-1)" }} />} disabled={!history?.hasPast} onClick={() => history?.back?.()}>
          ביטול פעולה
        </Button>
        <Button size="small" variant="outlined" startIcon={<Redo2 size={14} style={{ transform: "scaleX(-1)" }} />} disabled={!history?.hasFuture} onClick={() => history?.forward?.()}>
          ביצוע מחדש
        </Button>
      </div>

      {pages.map((page, pi) => (
        <div key={pi} className="pdfed-sheet-wrap">
          <div className="pdf-page pdfed-sheet" style={frameStyle}>
            {border && border !== "none" ? (
              <div className={`pdfed-frame pdfed-frame--${border}`} aria-hidden="true" />
            ) : null}
            {pi === 0 && header.show !== false ? <HeaderBand h={header} meta={metadata} /> : null}

            {(() => {
              // ---- live drag preview for THIS page ----
              // "into": the target row redistributes to equal columns and a ghost
              // slot appears where the block will land — the existing blocks
              // actually move so you see the final layout before releasing.
              const into = drop && drop.page === pi && drop.kind === "into" ? drop : null;
              const newrow = drop && drop.page === pi && drop.kind === "newrow" ? drop : null;
              const ds = getDragSource();
              const srcKey =
                ds?.kind === "move" ? page.blocks.findIndex((b) => b.index === ds.index) : -1;
              let memberKeys: number[] = [];
              let previewW = "full";
              let ghostBeforeKey = -1; // render the "into" ghost before this key
              let ghostAtEndKey = -1; // ...or after this key (row end)
              if (into) {
                memberKeys = into.rowKeys.filter((k) => k !== srcKey);
                previewW = equalWidth(memberKeys.length + 1);
                if (into.slot >= memberKeys.length)
                  ghostAtEndKey = memberKeys.length ? memberKeys[memberKeys.length - 1]! : -1;
                else ghostBeforeKey = memberKeys[into.slot]!;
              }
              const memberSet = new Set(memberKeys);
              const intoGhost = () => (
                <div className="pdfed-ghost" style={{ width: WIDTH_MM[previewW] ?? WIDTH_MM.full }} aria-hidden="true" />
              );
              return (
                <div
                  className="pdf-flow pdfed-flow"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrop(detect(pi, page, e.currentTarget as HTMLElement, e.clientX, e.clientY));
                  }}
                  onDrop={(e) => handleDrop(pi, e)}
                >
                  {page.blocks.length === 0
                    ? newrow
                      ? <div className="pdfed-ghost pdfed-ghost--full" aria-hidden="true" />
                      : <div className="pdfed-empty">גררו לכאן רכיבים</div>
                    : null}

                  {page.blocks.map((b, k) => {
                    const isSel = selIdx === b.index;
                    const isSourceHidden = !!(into || newrow) && ds?.kind === "move" && k === srcKey;
                    const newrowBefore = !!newrow && newrow.atLocalKey < page.blocks.length && newrow.atLocalKey === k;
                    const wName = into && memberSet.has(k) ? previewW : ((b.node.props.width as string) ?? "full");
                    return (
                      <React.Fragment key={b.node.props.id ?? k}>
                        {newrowBefore ? <div className="pdfed-ghost pdfed-ghost--full" aria-hidden="true" /> : null}
                        {into && ghostBeforeKey === k ? intoGhost() : null}
                        <div
                          className={`pdfed-blockwrap${isSel ? " is-sel" : ""}`}
                          data-k={k}
                          style={{
                            width: WIDTH_MM[wName] ?? WIDTH_MM.full,
                            ...(isSourceHidden ? { display: "none" } : {}),
                          }}
                          draggable
                          onDragStart={(e) => {
                            setDragSource({ kind: "move", index: b.index });
                            e.dataTransfer.setData("text/pdf-move", String(b.index));
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            select(b.index);
                          }}
                        >
                          {isSel ? (
                            <div className="pdfed-blockbar" draggable={false} onClick={(e) => e.stopPropagation()}>
                              <span className="pdfed-blockbar__name">{labelOf(b.node.type)}</span>
                              <span className="pdfed-blockbar__sep" />
                              <button type="button" title="שכפול" aria-label="שכפול הבלוק" onClick={() => duplicateBlock(b.index)}>
                                <Copy size={14} aria-hidden />
                              </button>
                              <button type="button" title="מחיקה" aria-label="מחיקת הבלוק" className="is-del" onClick={() => deleteBlock(b.index)}>
                                <Trash2 size={14} aria-hidden />
                              </button>
                            </div>
                          ) : null}
                          {renderBlock(b.node, metadata)}
                        </div>
                        {into && ghostAtEndKey === k ? intoGhost() : null}
                      </React.Fragment>
                    );
                  })}

                  {newrow && newrow.atLocalKey >= page.blocks.length && page.blocks.length > 0 ? (
                    <div className="pdfed-ghost pdfed-ghost--full" aria-hidden="true" />
                  ) : null}
                </div>
              );
            })()}

            {footer.show !== false && (footer.text || footer.pageNumbers) ? (
              <div className="pdf-footer-preview">
                {footer.text ? (
                  <div style={{ textAlign: footer.textAlign || "center" }}>{footer.text}</div>
                ) : null}
                {footer.pageNumbers ? (
                  <div style={{ textAlign: footer.pageNumberAlign || "center" }}>{pageNumStr(pi)}</div>
                ) : null}
              </div>
            ) : null}

            {pi > 0 ? (
              <button
                type="button"
                className="pdfed-delpage"
                title="מחיקת העמוד"
                aria-label="מחיקת העמוד"
                onClick={(e) => {
                  e.stopPropagation();
                  deletePage(page, pi + 1);
                }}
              />
            ) : null}
          </div>
          <div className="pdfed-sheet-tag">עמוד {pi + 1} מתוך {pageCount}</div>
        </div>
      ))}

      <div className="pdfed__addpage">
        <Button
          variant="outlined"
          startIcon={<Plus size={16} />}
          onClick={(e) => {
            e.stopPropagation();
            addPage();
          }}
        >
          הוספת עמוד
        </Button>
      </div>

      <ConfirmDialog
        open={confirm != null}
        destructive={confirm?.danger}
        draggable={false}
        title={confirm?.title ?? ""}
        message={confirm?.message}
        confirmText={confirm?.confirmLabel}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
      />
    </div>
  );
}
