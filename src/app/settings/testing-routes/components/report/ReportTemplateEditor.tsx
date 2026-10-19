"use client";

// Ported from ticketflow (src/components/form/PdfTemplateEditor.tsx). Edits the
// report template of one route; the toolbar adds "תצוגה מקדימה" — the unsaved
// template rendered by the server (Chromium), with a real item's data or with
// the variables' own labels.
//
// Full-screen PDF template editor built on Puck, with a custom Hebrew layout:
//   right rail : מבנה המסמך (Outline — ALWAYS visible) + רכיבים (palette)
//   center     : the A4 canvas (same print CSS as the PDF → WYSIWYG)
//   left rail  : מאפיינים (the selected block's fields; document settings when
//                nothing is selected)
// Blocks flow in a wrapping row by their width, so dragging a half-width block
// next to another puts them on the same row — no wrapper block.

import * as React from "react";
import { Puck, usePuck, type Data } from "@measured/puck";
// no-external.css, NOT puck.css: puck.css starts with
// `@import "https://rsms.me/inter/inter.css"`, which can't resolve in the
// air-gap. A failed @import makes the browser fire `error` on the chunk's
// <link>, so the lazy-loaded editor dies with ChunkLoadError ("This page
// couldn't load"). The two files are otherwise identical; the UI falls back to
// the system font stack.
import "@measured/puck/no-external.css";
import { Check, Eye, GripVertical, LayoutGrid, List, SlidersHorizontal } from "lucide-react";
import { buildEditorConfig } from "./editorConfig";
import { DEFAULT_ROOT_PROPS, puckConfig } from "@/app/lib/item-report/puck-config";
import { PageCanvas, BlockPalette } from "./ReportCanvas";
import { PDF_CSS } from "@/app/lib/item-report/pdf-styles";
import { sampleValues } from "@/app/lib/item-report/variables";
import type { ReportRenderMeta, ReportStepRef, ReportVar } from "@/app/lib/item-report/types";
import { Button, ConfirmDialog } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

// New templates start empty — the header/footer are document-level (rendered
// from the page settings), so a header is always present by default.
function emptyTemplate(): Data {
  return { root: { props: DEFAULT_ROOT_PROPS }, content: [], zones: {} } as unknown as Data;
}


// Custom "מבנה המסמך" (layers) panel — Puck's Outline isn't drag-sortable, so
// we render our own draggable list backed by the Puck store: drag to reorder
// blocks, click to select. Reorder/select dispatch into Puck.
const COMPONENT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries((puckConfig.components ?? {}) as Record<string, { label?: string }>).map(
    ([k, v]) => [k, v?.label || k],
  ),
);
// Stable fallback so `content` (an effect dependency) doesn't change identity
// on every render while the store has no content yet.
const NO_BLOCKS: Array<{ type?: string }> = [];
function DocOutline() {
  const { appState, dispatch } = usePuck();
  const content = (appState?.data?.content ?? NO_BLOCKS) as Array<{ type?: string }>;
  // Currently-selected block (kept in sync with the canvas: clicking a block on
  // the canvas sets the same itemSelector, so the outline marks it too).
  const selIdx = (appState?.ui?.itemSelector?.index ?? null) as number | null;
  const listRef = React.useRef<HTMLDivElement>(null);
  // Reorder is pointer-based and VERTICAL ONLY — the row never leaves the panel
  // (no native HTML5 drag, so no ghost flying across the screen). `overIdx` is
  // the insertion index (0..length) shown as a blue line.
  const [fromIdx, setFromIdx] = React.useState<number | null>(null);
  const [overIdx, setOverIdx] = React.useState<number | null>(null);
  const fromRef = React.useRef<number | null>(null);
  const overRef = React.useRef<number | null>(null);

  const select = (index: number) => {
    dispatch({ type: "setUi", ui: { itemSelector: { index } } } as any);
  };

  const computeOver = (clientY: number): number => {
    const items = listRef.current
      ? Array.from(listRef.current.querySelectorAll(".docol-item"))
      : [];
    for (let k = 0; k < items.length; k++) {
      const r = items[k]!.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return k;
    }
    return items.length;
  };

  React.useEffect(() => {
    if (fromIdx == null) return;
    const move = (e: PointerEvent) => {
      const o = computeOver(e.clientY);
      overRef.current = o;
      setOverIdx(o);
    };
    const up = () => {
      const from = fromRef.current;
      const to = overRef.current;
      if (from != null && to != null && to !== from && to !== from + 1) {
        const next = [...content];
        const [m] = next.splice(from, 1);
        if (m) {
          let ins = to;
          if (from < to) ins -= 1;
          next.splice(ins, 0, m);
          dispatch({ type: "setData", data: { content: next } } as any);
          dispatch({ type: "setUi", ui: { itemSelector: { index: ins } } } as any);
        }
      }
      setFromIdx(null);
      setOverIdx(null);
      fromRef.current = null;
      overRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [fromIdx, content, dispatch]);

  const startDrag = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fromRef.current = i;
    overRef.current = i;
    setFromIdx(i);
    setOverIdx(i);
  };

  if (content.length === 0) {
    return <div className="docol-empty">אין בלוקים עדיין — גררו רכיבים אל הדף</div>;
  }
  return (
    <div className="docol" ref={listRef}>
      {content.map((n, i) => {
        const isPb = n?.type === "PageBreak";
        return (
          <React.Fragment key={i}>
            {fromIdx != null && overIdx === i && overIdx !== fromIdx && overIdx !== fromIdx + 1 ? (
              <div className="docol-line" />
            ) : null}
            <button
              type="button"
              className={`docol-item${isPb ? " docol-item--pb" : ""}${fromIdx === i ? " docol-item--dragging" : ""}${selIdx === i ? " docol-item--selected" : ""}`}
              aria-current={selIdx === i ? "true" : undefined}
              onClick={() => select(i)}
            >
              <span className="docol-num">{i + 1}</span>
              <span className="docol-label">
                {isPb ? "מעבר עמוד" : COMPONENT_LABELS[n?.type ?? ""] ?? n?.type}
              </span>
              <span
                className="docol-grip"
                title="גרירה מעלה או מטה לשינוי הסדר"
                aria-hidden="true"
                onPointerDown={startDrag(i)}
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical size={14} aria-hidden />
              </span>
            </button>
          </React.Fragment>
        );
      })}
      {fromIdx != null && overIdx === content.length && overIdx !== fromIdx + 1 ? (
        <div className="docol-line" />
      ) : null}
    </div>
  );
}

// Width quick-bar — shown above the properties of the selected block. New
// blocks are always full-width; one click here splits the block's row (½ / ⅓ /
// ¼), and adjacent partial-width blocks flow onto the same row automatically
// (the canvas drop zone is a wrapping flex row). Predictable and reversible —
// no guessing intent from where a block was dropped.
const WIDTH_PRESETS = [
  { label: "מלא", value: "full", title: "שורה שלמה" },
  { label: "¾", value: "three-quarters", title: "שלושה רבעים" },
  { label: "⅔", value: "two-thirds", title: "שני שליש" },
  { label: "½", value: "half", title: "חצי שורה" },
  { label: "⅓", value: "third", title: "שליש" },
  { label: "¼", value: "quarter", title: "רבע" },
];
function WidthQuickBar() {
  const { appState, dispatch } = usePuck();
  const idx = appState?.ui?.itemSelector?.index;
  const content = (appState?.data?.content ?? []) as Array<{
    type?: string;
    props?: Record<string, unknown>;
  }>;
  if (idx == null || idx < 0 || idx >= content.length) return null;
  const node = content[idx];
  const cur = node?.props?.width as string | undefined;
  // Only blocks that expose a row-width (skip page breaks / spacers / dividers).
  if (cur === undefined) return null;
  const setW = (w: string) => {
    const next = content.map((n, i) =>
      i === idx ? { ...n, props: { ...(n.props ?? {}), width: w } } : n,
    );
    dispatch({ type: "setData", data: { content: next } } as any);
  };
  return (
    <div className="pdfed__wbar">
      <span className="pdfed__wbar-label">רוחב בשורה</span>
      <div className="pdfed__wbtns" role="group" aria-label="רוחב בשורה">
        {WIDTH_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            title={p.title}
            aria-label={p.title}
            aria-pressed={cur === p.value}
            className={`pdfed__wbtn${cur === p.value ? " is-on" : ""}`}
            onClick={() => setW(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const EDITOR_CSS = `
/* width quick-bar (above the selected block's properties) */
.pdfed__wbar { padding: 8px 2px 10px; margin-bottom: 8px; border-bottom: 1px solid var(--color-divider-soft); }
.pdfed__wbar-label { display: block; font-size: var(--text-fine); font-weight: 600; color: var(--color-ink-muted-70); margin-bottom: 6px; }
.pdfed__wbtns { display: flex; gap: 6px; flex-wrap: wrap; }
.pdfed__wbtn { flex: 1 1 34px; min-width: 34px; height: 30px; padding: 0 2px; border: 1px solid var(--color-hairline); background: var(--color-canvas); border-radius: var(--r-xs); cursor: pointer; font-size: var(--text-small); color: var(--color-ink-muted-70); }
.pdfed__wbtn:hover { background: var(--color-surface-pearl); }
.pdfed__wbtn.is-on { border-color: var(--color-primary-border); background: var(--color-primary-soft); color: var(--color-primary); font-weight: 700; }

/* top bar: title · cancel · save */
.pdfed-toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--color-hairline); background: var(--color-canvas); }
.pdfed-toolbar-title { margin: 0; margin-inline-end: auto; font-size: var(--text-lead); font-weight: 700; color: var(--color-ink); }
.pdf-editor-root:focus-visible { outline: none; }

/* Puck's own UI (the property fields) on the app palette, in both themes —
   dark mode no longer leaves white cards in a dark rail. Puck defines these
   on :root; the document CSS (PDF_CSS) doesn't use them. */
.pdf-editor-root {
  /* The app loads Rubik through next/font (--font-rubik); the print HTML inlines it as 'Rubik'. */
  --pdf-font: var(--font-rubik), "Rubik", Arial, sans-serif;
  --puck-font-family: var(--font-rubik), "Rubik", system-ui, -apple-system, "Segoe UI", sans-serif;
  --puck-color-white: var(--color-canvas);
  --puck-color-black: var(--color-ink);
  --puck-color-grey-01: var(--color-ink);
  --puck-color-grey-02: var(--color-ink);
  --puck-color-grey-03: var(--color-ink-muted-70);
  --puck-color-grey-04: var(--color-ink-muted-70);
  --puck-color-grey-05: var(--color-ink-muted-48);
  --puck-color-grey-06: var(--color-ink-muted-48);
  --puck-color-grey-07: var(--color-ink-muted-40);
  --puck-color-grey-08: var(--color-border-strong);
  --puck-color-grey-09: var(--color-hairline);
  --puck-color-grey-10: var(--color-surface-pearl);
  --puck-color-grey-11: var(--color-canvas-parchment);
  --puck-color-grey-12: var(--color-canvas-parchment);
  --puck-color-azure-01: var(--color-primary);
  --puck-color-azure-02: var(--color-primary);
  --puck-color-azure-03: var(--color-primary);
  --puck-color-azure-04: var(--color-primary);
  --puck-color-azure-05: var(--color-primary);
  --puck-color-azure-06: var(--color-primary-border);
  --puck-color-azure-07: var(--color-primary-border);
  --puck-color-azure-08: var(--color-primary-border);
  --puck-color-azure-09: var(--color-primary-soft);
  --puck-color-azure-10: var(--color-primary-soft);
  --puck-color-azure-11: var(--color-primary-soft);
  --puck-color-azure-12: var(--color-primary-soft);
}

/* Force the height chain THROUGH Puck's own wrapper so the inner panels
   scroll instead of the whole editor overflowing the viewport. Puck's root
   (.Puck) otherwise grows to content height with no scroll. */
.pdfed-host { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.pdfed-host > .Puck { flex: 1 1 auto; min-height: 0; height: 100%; overflow: hidden; }
.pdfed-host .Puck > * { height: 100%; min-height: 0; }

.pdfed { display: flex; height: 100%; min-height: 0; direction: rtl; }
.pdfed__rail { min-height: 0; overflow: hidden; background: var(--color-canvas); color: var(--color-ink); display: flex; flex-direction: column; }
.pdfed__rail--right { border-inline-start: 1px solid var(--color-hairline); }
.pdfed__rail--left { border-inline-end: 1px solid var(--color-hairline); }
.pdfed__center { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; background: var(--color-canvas-parchment,#f4f5f8); padding: 18px; display: flex; flex-direction: column; align-items: center; }

/* stacked, independently-scrolling windows (Photoshop-style) */
.pdfed__win { display: flex; flex-direction: column; min-height: 0; }
.pdfed__win-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px 12px 12px; }
.pdfed__h { display: flex; align-items: center; gap: 6px; margin: 0; font-size: var(--text-fine); font-weight: 700; color: var(--color-ink-muted-70); padding: 10px 14px 8px; background: var(--color-canvas-parchment); border-bottom: 1px solid var(--color-divider-soft); }
.pdfed__h svg { color: var(--color-ink-muted-48); }
.pdfed__split { flex: 0 0 9px; height: 9px; cursor: row-resize; background: var(--color-surface-pearl,#f1f3f6); display: flex; align-items: center; justify-content: center; border-block: 1px solid var(--color-divider-soft,#eef0f4); }
.pdfed__split:hover { background: var(--color-primary-soft,#eef1fe); }
.pdfed__split span { width: 34px; height: 3px; border-radius: 2px; background: var(--color-border-strong,#d6d9e2); }
/* vertical splitter — resize a side rail's width */
.pdfed__vsplit { flex: 0 0 9px; width: 9px; align-self: stretch; cursor: col-resize; background: var(--color-surface-pearl,#f1f3f6); border-inline: 1px solid var(--color-hairline,#e7e9ef); display: flex; align-items: center; justify-content: center; }
.pdfed__vsplit:hover { background: var(--color-primary-soft,#eef1fe); }
.pdfed__vsplit span { width: 3px; height: 34px; border-radius: 2px; background: var(--color-border-strong,#d6d9e2); }
.pdfed__center .pdf-page { box-shadow: var(--shadow-pop, 0 4px 14px rgba(17,21,31,.10)); }

/* add-page (+) control under the canvas */
.pdfed__addpage { display: flex; justify-content: center; padding: 20px 0 40px; }

/* ---- custom multi-sheet canvas ---- */
/* Each page is a discrete A4 sheet (via .pdf-page) with a gap + a "עמוד N"
   tag beneath it, so scrolling shows the document as separate pages. */
.pdfed-sheet-wrap { display: flex; flex-direction: column; align-items: center; margin-bottom: 22px; }
.pdfed-sheet { position: relative; box-shadow: var(--shadow-pop, 0 4px 14px rgba(17,21,31,.12)); }
.pdfed-sheet-tag { margin-top: 8px; font-size: var(--text-fine); font-weight: 600; color: var(--color-ink-muted-48,#8a93a6); background: var(--color-canvas,#fff); border: 1px solid var(--color-hairline,#e7e9ef); border-radius: 999px; padding: 2px 12px; }
/* the block flow inside a sheet grows so the footer sinks to the bottom edge */
.pdfed-flow { flex: 1 1 auto; align-content: flex-start; }
.pdfed-empty { flex-basis: 100%; text-align: center; color: var(--color-ink-muted-40,#aab1c0); font-size: 11pt; padding: 40px 0; border: 1.5px dashed var(--color-border-strong,#d6d9e2); border-radius: 8px; }
/* a block wrapper is the flex item that carries the row-width; the inner
   .pdf-block fills it. Click to select, drag to move. */
.pdfed-blockwrap { position: relative; box-sizing: border-box; cursor: grab; border: 1.5px solid transparent; border-radius: 6px; }
.pdfed-blockwrap > .pdf-block { width: 100% !important; }
.pdfed-blockwrap:hover { border-color: var(--color-primary-soft,#e0e4fb); }
.pdfed-blockwrap.is-sel { border-color: var(--color-primary,#4f46e5); box-shadow: 0 0 0 2px var(--color-primary-soft,#eef1fe); }
/* drop indicator — a RECTANGLE of the area the block will occupy. A full-width
   row rectangle for above/below (a real layout box so blocks shift to make
   room), or a non-reflowing overlay over the half it will share (below).
   pointer-events:none so it never intercepts the drag → hit-testing stays
   stable and dragging never gets stuck. */
.pdfed-ghost { box-sizing: border-box; align-self: stretch; min-height: 44px; padding-inline: 1.5mm; border: 2px dashed var(--color-primary,#4f46e5); border-radius: 8px; background: var(--color-primary-soft,#eef1fe); margin: 3px 0; pointer-events: none; animation: pdfedGhost .1s ease; }
.pdfed-ghost--full { flex-basis: 100%; width: 100%; }
@keyframes pdfedGhost { from { opacity: 0; } to { opacity: 1; } }
/* selected-block toolbar — a black pill with the block's NAME + duplicate /
   delete, floating at the top-right of the block (like the old canvas). */
.pdfed-blockbar { position: absolute; top: -15px; right: 8px; z-index: 6; display: flex; align-items: center; gap: 1px; direction: rtl; background: #1c2027; color: #fff; border-radius: 9px; padding: 3px 4px 3px 9px; box-shadow: 0 5px 16px rgba(0,0,0,.30); }
.pdfed-blockbar__name { font-size: var(--text-fine); font-weight: 600; white-space: nowrap; padding-inline-end: 2px; }
.pdfed-blockbar__sep { width: 1px; height: 15px; background: rgba(255,255,255,.22); margin: 0 4px; }
.pdfed-blockbar button { width: 24px; height: 22px; border: 0; background: none; color: #cbd0da; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.pdfed-blockbar button:hover { background: rgba(255,255,255,.15); color: #fff; }
.pdfed-blockbar button.is-del:hover { background: var(--color-destructive,#e5484d); color: #fff; }
/* per-sheet border frame (bordered forms) — absolute inside the sheet */
.pdfed-frame { position: absolute; inset: 6mm; border: 1.5pt solid var(--pdf-line,#222); pointer-events: none; z-index: 1; }
.pdfed-frame--dashed { border-style: dashed; }
/* per-sheet delete (−), top-left corner, pages 2+ */
/* iOS home-screen "remove" badge: a clean gray circle with a dark minus bar
   (like deleting apps on iPhone), pinned to the corner so it overhangs the
   page edge slightly. Neutral gray — no red. */
.pdfed-delpage { position: absolute; left: -11px; top: -11px; width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid #fff; background: #c7c7cc; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,.30); z-index: 3; padding: 0; transition: transform .1s ease, background .1s ease; }
.pdfed-delpage::before { content: ""; width: 11px; height: 2.5px; border-radius: 2px; background: #3a3a3c; }
.pdfed-delpage:hover { background: #b3b3b9; transform: scale(1.08); }
.pdfed-delpage:active { transform: scale(.95); }

/* undo / redo bar (sticky at the top of the canvas) */
.pdfed-history { position: sticky; top: 0; z-index: 10; align-self: stretch; display: flex; justify-content: center; gap: 8px; padding: 6px 0 12px; }
.pdfed-history .btn { box-shadow: var(--shadow-pop); }

/* alignment icon field (ימין / מרכז / שמאל) */
.pdf-alignfield { display: flex; gap: 6px; }
.pdf-alignbtn { flex: 1; height: 30px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--color-hairline); background: var(--color-canvas); border-radius: var(--r-xs); cursor: pointer; color: var(--color-ink-muted-70); }
.pdf-alignbtn:hover { background: var(--color-surface-pearl); }
.pdf-alignbtn.is-on { border-color: var(--color-primary-border); background: var(--color-primary-soft); color: var(--color-primary); }


/* custom palette (HTML5-draggable chips) */
/* PALETTE (רכיבים) — clean white "source" cards you DRAG onto the page.
   Label pinned to the RIGHT (start), a subtle grip on the left. */
.pdfpal { display: flex; flex-direction: column; gap: 12px; }
.pdfpal__cat-title { font-size: var(--text-fine); font-weight: 700; color: var(--color-ink-muted-48); margin: 2px 4px 6px; }
.pdfpal__chip { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; margin-bottom: 6px; border: 1px solid var(--color-hairline); border-radius: var(--r-sm); background: var(--color-canvas); cursor: grab; transition: border-color .12s, background .12s; }
.pdfpal__chip:hover { border-color: var(--color-primary-border); background: var(--color-primary-soft); }
.pdfpal__chip:active { cursor: grabbing; }
.pdfpal__label { flex: 1; min-width: 0; text-align: start; font-size: var(--text-small); font-weight: 600; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pdfpal__grip { flex: 0 0 auto; display: grid; place-items: center; color: var(--color-ink-muted-40); }

/* custom layers panel (מבנה המסמך) */
/* OUTLINE (מבנה המסמך) — a flat, NUMBERED "layers" list. Deliberately different
   from the palette: no accent bar, tighter rows, a numbered badge, and a grip
   that is the ONLY drag handle (reorder is vertical-only; rows never leave). */
.docol { display: flex; flex-direction: column; gap: 3px; }
.docol-empty { font-size: var(--text-small); color: var(--color-ink-muted-48); padding: 8px 2px; }
.docol-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border: 1px solid transparent; border-radius: var(--r-xs); background: transparent; color: var(--color-ink); font: inherit; font-size: var(--text-small); text-align: start; cursor: pointer; user-select: none; }
.docol-item:hover { background: var(--color-surface-pearl); }
.docol-item--dragging { opacity: .5; }
/* selected: tint + border, no start stripe */
.docol-item--selected { background: var(--color-primary-soft); border-color: var(--color-primary-border); color: var(--color-primary); font-weight: 600; }
.docol-item--pb { color: var(--color-primary); font-style: italic; }
.docol-num { flex: 0 0 auto; width: 18px; height: 18px; border-radius: var(--r-xs); background: var(--color-surface-pearl); color: var(--color-ink-muted-48); font-size: var(--text-fine); font-weight: 700; display: flex; align-items: center; justify-content: center; font-style: normal; }
.docol-item--selected .docol-num { background: var(--color-primary); color: var(--color-on-primary); }
.docol-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.docol-grip { flex: 0 0 auto; display: grid; place-items: center; color: var(--color-ink-muted-40); cursor: grab; padding: 0 2px; touch-action: none; }
.docol-grip:hover { color: var(--color-ink-muted-70); }
.docol-grip:active { cursor: grabbing; }
/* insertion line while reordering (shows where the row lands) */
.docol-line { height: 3px; background: var(--color-primary); border-radius: 2px; margin: 1px 4px; }
/* the outline window reads differently from the palette */
.pdfed__win-body--outline { background: var(--color-canvas-parchment); }

/* inline rich-text editor */
.rte { border: 1px solid var(--color-border-strong); border-radius: var(--r-sm); overflow: hidden; background: var(--color-canvas); color: var(--color-ink); }
.rte:focus-within { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary-focus); }
.rte-toolbar { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; padding: 5px 6px; border-bottom: 1px solid var(--color-divider-soft); background: var(--color-canvas-parchment); }
.rte-btn { width: 26px; height: 26px; border: 1px solid var(--color-hairline); background: var(--color-canvas); color: var(--color-ink); border-radius: var(--r-xs); cursor: pointer; font-size: var(--text-small); line-height: 1; }
.rte-btn:hover { background: var(--color-surface-pearl); }
.rte-btn.is-on { background: var(--color-primary); color: var(--color-on-primary); border-color: var(--color-primary); }
.rte-select { height: 26px; border: 1px solid var(--color-hairline); border-radius: var(--r-xs); background: var(--color-canvas); color: var(--color-ink); font-size: var(--text-fine); padding: 0 4px; }
.rte-select--var { color: var(--color-primary); font-weight: 600; }
.rte-area { padding: 8px 10px; font-size: var(--text-small); line-height: 1.7; outline: none; min-height: 64px; }
/* Variable chip looks like a fill-in field: the field name on an underline. */
.rpted-select { width: 100%; height: 34px; border: 1px solid var(--color-field-border); border-radius: var(--r-field); background: var(--color-canvas); color: var(--color-ink); font: inherit; font-size: var(--text-small); padding: 0 8px; }
.rpted-preview-item { width: 150px; height: 34px; border: 1px solid var(--color-field-border); border-radius: var(--r-field); padding: 0 10px; font: inherit; font-size: var(--text-small); text-align: right; }
.rpted-preview-err { color: var(--color-destructive); font-size: var(--text-small); }
.rpted-logo-box { height: 64px; border: 1px dashed var(--color-border-strong); border-radius: var(--r-sm); display: flex; align-items: center; justify-content: center; background: var(--color-canvas-parchment); overflow: hidden; color: var(--color-ink-muted-48); font-size: var(--text-fine); }
.rpted-logo-box img { max-height: 58px; max-width: 100%; object-fit: contain; }
.rpted-logo-bundled { display: flex; gap: 6px; }
.rpted-logo-pick { flex: 1; height: 40px; border: 1px solid var(--color-hairline); border-radius: var(--r-xs); background: var(--color-canvas); cursor: pointer; display: grid; place-items: center; padding: 2px; }
.rpted-logo-pick img { max-height: 34px; max-width: 100%; object-fit: contain; }
.rpted-logo-pick.is-on { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary-soft); }
.rte-chip { display: inline-block; min-width: 56px; text-align: center; background: var(--color-primary-soft,#eef1fe); color: var(--color-primary-hover,#3730a3); border-bottom: 1.5px solid var(--color-primary,#4f46e5); border-radius: 4px 4px 0 0; padding: 0 6px; margin: 0 2px; font-size: 12px; user-select: none; }
`;

export function ReportTemplateEditor({
  value,
  title,
  routeId,
  vars,
  steps,
  saving = false,
  onSave,
  onCancel,
}: {
  value: Data | null | undefined;
  /** "מסלול 1 של מחשב" — shown in the toolbar. */
  title: string;
  routeId: number;
  vars: ReportVar[];
  steps: ReportStepRef[];
  saving?: boolean;
  onSave: (data: Data) => void;
  onCancel: () => void;
}) {
  const config = React.useMemo(() => buildEditorConfig({ vars, steps }), [vars, steps]);

  // Leaving with edits asks first — "ביטול" used to drop all work silently.
  // "Edited" = the document differs from what the editor opened with (Puck's
  // undo history only covers property edits, not canvas moves / adds).
  const [edited, setEdited] = React.useState(false);
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const requestCancel = () => (edited ? setConfirmLeave(true) : onCancel());

  // The editor covers the page: focus moves into it, and back to the button
  // that opened it on close.
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Esc leaves the editor — unless a dialog is open (it closes first) or the
  // key belongs to a field being edited. A document listener: Puck stops
  // keydown from bubbling through React out of its canvas.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role='alertdialog'], [role='dialog'][data-state='open']:not(.pdf-editor-root)")) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (edited) setConfirmLeave(true);
      else onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [edited, onCancel]);

  const metadata = React.useMemo<ReportRenderMeta>(
    () => ({
      mode: "edit",
      vars,
      steps,
      values: sampleValues(vars),
      results: [],
      photos: {},
      signatures: {},
      signerMeta: {},
      logos: {},
    }),
    [vars, steps],
  );

  // "תצוגה מקדימה": the unsaved template as the server renders it.
  const [previewItem, setPreviewItem] = React.useState("");
  const [previewBusy, setPreviewBusy] = React.useState(false);
  const [previewErr, setPreviewErr] = React.useState("");
  const preview = async () => {
    setPreviewErr("");
    setPreviewBusy(true);
    // Open the tab now (inside the click) so the popup is not blocked.
    const win = window.open("", "_blank");
    try {
      const res = await apiFetch(`/api/item-reports/templates/${routeId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: dataRef.current, item_id: previewItem.trim() || null }),
      });
      if (!res.ok) throw new Error(res.status === 404 ? "הפריט לא נמצא" : "התצוגה המקדימה נכשלה");
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url;
      else window.open(url, "_blank");
    } catch (e) {
      win?.close();
      setPreviewErr(e instanceof Error ? e.message : "התצוגה המקדימה נכשלה");
    } finally {
      setPreviewBusy(false);
    }
  };

  const initial = React.useMemo<Data>(
    () =>
      value && Array.isArray((value as Data).content)
        ? (value as Data)
        : emptyTemplate(),
    [value],
  );
  const dataRef = React.useRef<Data>(initial);
  const initialJson = React.useMemo(() => JSON.stringify(initial), [initial]);
  const onPuckChange = React.useCallback(
    (d: Data) => {
      dataRef.current = d;
      setEdited(JSON.stringify(d) !== initialJson);
    },
    [initialJson],
  );

  // Resizable right rail (Photoshop-style): top window = רכיבים, bottom =
  // מבנה המסמך (layers). Drag the splitter to set the top window's height.
  const railRef = React.useRef<HTMLDivElement>(null);
  const [topH, setTopH] = React.useState<number | null>(null);
  const dragging = React.useRef(false);

  const onSplitDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  // Horizontal resize of the side rails (drag the border with the canvas).
  const [rightW, setRightW] = React.useState(290);
  // The properties panel (left) holds rich-text editors, so it opens wider.
  const [leftW, setLeftW] = React.useState(380);
  const hDrag = React.useRef<{ side: "right" | "left"; startX: number; startW: number } | null>(null);
  const onHDown = (side: "right" | "left", e: React.PointerEvent) => {
    e.preventDefault();
    hDrag.current = { side, startX: e.clientX, startW: side === "right" ? rightW : leftW };
  };

  React.useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragging.current && railRef.current) {
        const rect = railRef.current.getBoundingClientRect();
        setTopH(Math.max(120, Math.min(rect.height - 160, e.clientY - rect.top)));
      }
      if (hDrag.current) {
        const { side, startX, startW } = hDrag.current;
        // RTL: right rail sits on the right (drag left → wider); left rail on
        // the left (drag right → wider).
        const delta = side === "right" ? startX - e.clientX : e.clientX - startX;
        const w = Math.max(180, Math.min(560, startW + delta));
        if (side === "right") setRightW(w);
        else setLeftW(w);
      }
    };
    const up = () => {
      dragging.current = false;
      hDrag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="pdf-editor-root"
      style={rootStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdfed-title"
      tabIndex={-1}
    >
      <style>{PDF_CSS + EDITOR_CSS}</style>

      <div className="pdfed-toolbar">
        <h2 id="pdfed-title" className="pdfed-toolbar-title">
          תבנית דוח PDF · {title}
        </h2>
        {previewErr ? <span role="alert" className="rpted-preview-err">{previewErr}</span> : null}
        <input
          className="rpted-preview-item"
          dir="ltr"
          inputMode="numeric"
          placeholder="מספר פריט (לא חובה)"
          aria-label="מספר פריט לתצוגה המקדימה"
          value={previewItem}
          onChange={(e) => setPreviewItem(e.target.value.replace(/\D/g, ""))}
        />
        <Button variant="outlined" startIcon={<Eye size={16} />} loading={previewBusy} onClick={preview}>
          תצוגה מקדימה
        </Button>
        <Button variant="text" onClick={requestCancel} disabled={saving}>
          ביטול
        </Button>
        <Button variant="contained" startIcon={<Check size={16} />} loading={saving} onClick={() => onSave(dataRef.current)}>
          שמירת התבנית
        </Button>
      </div>

      <div className="pdfed-host">
        <Puck
          config={config}
          data={initial}
          metadata={metadata as unknown as Record<string, unknown>}
          iframe={{ enabled: false }}
          onChange={onPuckChange}
        >
          <div className="pdfed">
            <div
              className="pdfed__rail pdfed__rail--right"
              ref={railRef}
              style={{ flex: `0 0 ${rightW}px`, width: rightW }}
            >
              <div
                className="pdfed__win"
                style={topH != null ? { height: topH, flex: "none" } : { flex: 1 }}
              >
                <h3 className="pdfed__h">
                  <LayoutGrid size={14} aria-hidden />
                  רכיבים
                </h3>
                <div className="pdfed__win-body">
                  <BlockPalette />
                </div>
              </div>
              <div className="pdfed__split" onPointerDown={onSplitDown} title="גרירה לשינוי הגובה">
                <span />
              </div>
              <div className="pdfed__win" style={{ flex: 1 }}>
                <h3 className="pdfed__h">
                  <List size={14} aria-hidden />
                  מבנה המסמך
                </h3>
                <div className="pdfed__win-body pdfed__win-body--outline">
                  <DocOutline />
                </div>
              </div>
            </div>
            <div className="pdfed__vsplit" onPointerDown={(e) => onHDown("right", e)} title="גרירה לשינוי הרוחב">
              <span />
            </div>
            <PageCanvas metadata={metadata} />
            <div className="pdfed__vsplit" onPointerDown={(e) => onHDown("left", e)} title="גרירה לשינוי הרוחב">
              <span />
            </div>
            <div
              className="pdfed__rail pdfed__rail--left"
              style={{ flex: `0 0 ${leftW}px`, width: leftW }}
            >
              <div className="pdfed__win" style={{ flex: 1 }}>
                <h3 className="pdfed__h">
                  <SlidersHorizontal size={14} aria-hidden />
                  מאפיינים
                </h3>
                <div className="pdfed__win-body">
                  <WidthQuickBar />
                  <Puck.Fields />
                </div>
              </div>
            </div>
          </div>
        </Puck>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        destructive
        draggable={false}
        title="יציאה בלי שמירה"
        message='השינויים בתבנית לא יישמרו. כדי לשמור אותם, בחרו "שמירת התבנית".'
        confirmText="יציאה בלי שמירה"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={onCancel}
      />
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  // Under the app's dialogs (1300) so the confirm opens above the editor.
  zIndex: 1250,
  background: "var(--color-canvas-parchment)",
  color: "var(--color-ink)",
  display: "flex",
  flexDirection: "column",
  direction: "rtl",
};
