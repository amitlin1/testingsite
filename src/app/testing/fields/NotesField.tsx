"use client";
import React from "react";
import { flushSync } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { AnchoredPopover, Button, IconButton, cn } from "@/components/ui";
import { NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import "./notes.css";

/* =============================================================================
   NotesField — the worker's note that grows as needed (route-fields spec §6,
   artboard 7א, and the note logic in the scripts of artboards 12–18). Used in
   the field rows, for the verdict notes of a popup that has fields, and in the
   admin screen's live worker preview. Controlled (value / onChange), no state
   outside the component, nothing read from the window while rendering.

   - Sizes: "row" — one 20px line at rest (44px), a line at a time up to six
     (146px), then it scrolls; "row-compact" — the same from 38px to 138px
     (artboards 17/18); "pack" — three lines at rest (84px) up to six (146px),
     the column's full width (artboard 18's "הערות אריזה"); "area" — 76px, up
     to 560px wide (the open wizard's "הערות"); "verdict" — three rows
     (VerdictCard / "הערות נוספות"). The row sizes and "pack" grow with
     `field-sizing: content`, or from script where it is missing.
   - Out of focus and longer than it is at rest (two lines; three for "pack"),
     a growing note shows that many, a fade into the row, and "הצג הכל · N
     שורות", which puts the focus back in it.
     Lines are counted the way the artboard scripts count them: every
     paragraph is at least one line and wraps every `floor(width / 7.4)`
     characters (their average 14px glyph), with the box's real text width.
   - The expand button (Maximize2, the box's inline-end corner) opens a 520px
     editor below the note, above it when there is no room. It shows while the
     note has focus, when it is longer than one line, when it was the last note
     to have focus, and while its editor is open (the artboards' `expandOn`).
   - The editor is an AnchoredPopover: role="dialog" named by `editorTitle`.
     Escape closes it and only it; Escape, × and "סיום" put the focus back in
     the note, at the editor's caret. One editor is open at a time, and opening
     it closes an open list: a press or focus anywhere else closes it, and
     opening it takes the focus (which closes a list).
   - Length: `maxLength={max}`, in UTF-16 code units (String length, as the
     server counts it). The counter "{len} / {max}" shows from 80%; at the max
     it turns --color-warning-ink and "הגעת לאורך המרבי" appears beside it, as
     the popup's artboard draws it (`look`).
   - dir="auto" (Hebrew and English mix), aligned with the column.
   ========================================================================== */

// ---- the component's own text (artboards 7א, 12–18) -------------------------------------
/** Over a required note — a line above the box, or a legend on its border (artboard 14). */
const REQUIRED_LABEL = "הערה · חובה";
/** A required note left empty: a line under the box, or the placeholder (artboard 14). */
const ERROR_TEXT = "יש לפרט את החריגה";
/** The expand button's name. */
const EXPAND_LABEL = "פתח עורך הערה";
/** The editor's ×. */
const CLOSE_LABEL = "סגירה";
/** The editor's button. */
const DONE_LABEL = "סיום";
/** Beside the counter at the limit. */
const AT_MAX_TEXT = "הגעת לאורך המרבי";
/** Under a collapsed note — always three lines or more, so always the plural (artboard 7א `moreLabel`). */
const showAllLabel = (lines: number) => `הצג הכל · ${lines} שורות`;

/** The artboards' average glyph width (their `cplFor`: floor((column − 52) / 7.4)). */
const GLYPH_PX = 7.4;

/** Lines a note takes, counted as the artboard scripts count them. */
function countLines(text: string, perLine: number): number {
  return text.split("\n").reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
}

/** Without `field-sizing: content` (Firefox, older Safari) a growing note's height follows its text
 *  from here: "auto", then the text's height capped at the CSS max-height (146px, or 64px collapsed). */
function fitHeight(el: HTMLTextAreaElement) {
  if (typeof CSS !== "undefined" && CSS.supports("field-sizing", "content")) return;
  el.style.height = "auto";
  const cs = getComputedStyle(el);
  const h = el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const max = parseFloat(cs.maxHeight); // NaN for "none"
  el.style.height = `${Number.isNaN(max) ? h : Math.min(h, max)}px`;
}

/** Marks every note textarea (the note's and its editor's), so a note knows when another one
 *  takes the focus — it stops being "the last note that had focus". */
const NOTE_ATTR = "data-note-field";

export type NotesFieldSize = "row" | "row-compact" | "pack" | "area" | "verdict";

/** How a popup draws the counter at the limit and the editor's "סיום": the artboards differ, and
 *  each popup keeps its own (spec §4.4). Every note of a popup draws the same.
 *  - "plain" (12, 14): "הגעת לאורך המרבי" 8px beside the count; "סיום" 16px a side.
 *  - "dot" (15, 16): "הגעת לאורך המרבי · " before the count, under the note and in the editor
 *    alike; "סיום" 16px a side.
 *  - "bold" (13, 17, 18): the words in 600, 6px from the count; "סיום" 18px a side. */
export type NoteLook = "plain" | "dot" | "bold";

/** The sizes that grow with their text, and the lines each shows when it folds out of focus (it
 *  folds once its text is longer than that): two in the field rows, three for "pack". */
const FOLDED_LINES: Partial<Record<NotesFieldSize, number>> = { row: 2, "row-compact": 2, pack: 3 };

export interface NotesFieldProps {
  /** The textarea's id. A host that draws its own label ("הערות", "הערות נוספות", "הערות אריזה")
   *  points it here with htmlFor. The editor's textarea is `${id}-editor`, the error `${id}-error`. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Max length in UTF-16 code units — default 1000 (NOTE_MAX_DEFAULT); a field's def.note_max
   *  (500 | 1000 | 2000). Typing stops there; a longer value from outside is cut on the next edit. */
  max?: number;
  /** The note must be filled: "הערה · חובה" (where: `requiredLabel`) and aria-required. */
  required?: boolean;
  /** The required note is missing: a red border, aria-invalid, and "יש לפרט את החריגה" (how:
   *  `errorStyle`), tied to the textarea by aria-describedby and announced politely. */
  error?: boolean;
  /** "פרט את החריגה…" / "פרט את החריגה (אופציונלי)" / "הערה (אופציונלי)" (rows); the popup's own
   *  for the verdict and area notes. The editor shows it too. */
  placeholder: string;
  /** The editor's title and its dialog name: "הערה · {label}", "הערה · הערות",
   *  "הערה · הערות נוספות", "הערה · הערות אריזה", "הערות · הקופסה", "הערות · {type}". */
  editorTitle: string;
  /** Default "row". */
  size?: NotesFieldSize;
  /** The popup's counter at the limit and "סיום" (NoteLook). Default "plain". */
  look?: NoteLook;
  /** The row's background — "fail" rows are --color-danger-bg: the collapsed note's fade, and the
   *  legend's upper half, end in it. Default "normal" (white). */
  rowTone?: "fail" | "normal";
  /** The note's name when nothing visible names it — drawn visually hidden while the note is not
   *  required (a required note is named by "הערה · חובה"). Field rows pass `הערה ל${label}`;
   *  omit it when the host has its own <label htmlFor={id}>. */
  labelText?: string;
  /** Where "הערה · חובה" goes: "above" (default) — a 12px/600 red line over the box: 16px + 4px,
   *  so the row pads its other columns by 20px to stay level with the box (artboards 12, 13,
   *  15–18); "legend" — 11px/600 on the box's top border, which stays red while the note is
   *  required, with no padding for the other columns (artboard 14); "none" — aria-required
   *  alone, for a textarea field whose row already shows its "*" (spec §4.5). */
  requiredLabel?: "above" | "legend" | "none";
  /** How the error shows: "line" (default) — "יש לפרט את החריגה", 12px red, under the box;
   *  "placeholder" — the same words as the placeholder, in red, and nothing under the box
   *  (artboard 14; assistive tech still gets the line, visually hidden); "edge" — the red
   *  border and aria-invalid alone, no words: a required textarea field left empty after a save
   *  attempt (artboard 14 `tried`), which is no note to explain. */
  errorStyle?: "line" | "placeholder" | "edge";
  /** Override of the legend's background (default: the row's colour over the box's white, from
   *  `rowTone` — artboard 14's `legendBg`). */
  legendBg?: string;
  /** More ids for the textarea's aria-describedby (e.g. the row's help text). */
  describedBy?: string;
  /** On the root (layout only — e.g. a host-side max-width). */
  className?: string;
  /** The note's textarea (e.g. to move the focus to it after a choice that makes it required). */
  ref?: React.Ref<HTMLTextAreaElement>;
}

export function NotesField({
  id, value, onChange, max = NOTE_MAX_DEFAULT, required = false, error = false,
  placeholder, editorTitle, size = "row", look = "plain", rowTone = "normal", labelText,
  requiredLabel = "above", errorStyle = "line", legendBg, describedBy, className, ref,
}: NotesFieldProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const noteRef = React.useRef<HTMLTextAreaElement>(null);
  const editorRef = React.useRef<HTMLTextAreaElement>(null);
  /** The note's caret, whichever of its two textareas had it last; null = never placed (→ the end). */
  const caretRef = React.useRef<[number, number] | null>(null);
  /** Escape, × and "סיום" hand the focus back to the note; a press or focus elsewhere keeps it there. */
  const restoreFocusRef = React.useRef(false);
  React.useImperativeHandle(ref, () => noteRef.current as HTMLTextAreaElement, []);

  const [focused, setFocused] = React.useState(false);
  const [wasLast, setWasLast] = React.useState(false);
  const [editorOpen, setEditorOpen] = React.useState(false);
  /** Characters per line in the box's text width; null until measured. */
  const [perLine, setPerLine] = React.useState<number | null>(null);

  const folded = FOLDED_LINES[size];
  const grows = folded !== undefined;
  const len = value.length;
  const lines = countLines(value, perLine ?? Infinity);
  const collapsed = folded !== undefined && !focused && lines > folded;
  const near = len >= Math.ceil(max * 0.8);
  const showExpand = focused || lines > 1 || wasLast || editorOpen;
  const legend = required && requiredLabel === "legend";
  const errorAsPlaceholder = error && errorStyle === "placeholder";
  /** "יש לפרט את החריגה" is said — as the line, or as the placeholder ("edge" says nothing). */
  const errorWords = error && errorStyle !== "edge";
  const shownPlaceholder = errorAsPlaceholder ? ERROR_TEXT : placeholder;
  const errorId = `${id}-error`;
  const editorId = `${id}-editor`;
  const described = [errorWords ? errorId : null, describedBy].filter(Boolean).join(" ") || undefined;

  // Characters per line follow the box's width. Measured as the box is laid out — before the
  // first paint — so a long note never flashes open before it collapses.
  React.useLayoutEffect(() => {
    const el = noteRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = 0;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w === 0 || w === width) return; // hidden, or only the height changed
      width = w;
      const cs = getComputedStyle(el);
      const textWidth = w - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      flushSync(() => setPerLine(Math.max(1, Math.floor(textWidth / GLYPH_PX))));
      if (grows) fitHeight(el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [grows]);

  // The height where field-sizing is missing; a collapsed note shows its first two lines.
  React.useLayoutEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    if (collapsed) el.scrollTop = 0;
    if (grows) fitHeight(el);
  }, [value, collapsed, grows]);

  // The last note that had focus keeps its expand button until another note takes the focus.
  React.useEffect(() => {
    if (!wasLast) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.hasAttribute(NOTE_ATTR) && t !== noteRef.current && t !== editorRef.current) {
        setWasLast(false);
      }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [wasLast]);

  // The caret follows typing (onChange: input with no key events too — virtual keyboards, IMEs)
  // and moves (onSelect).
  const trackCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    caretRef.current = [e.currentTarget.selectionStart, e.currentTarget.selectionEnd];
  };
  const change = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    trackCaret(e);
    onChange(e.target.value.slice(0, max));
  };
  const placeCaret = (el: HTMLTextAreaElement) => {
    const end = el.value.length;
    const [start, stop] = caretRef.current ?? [end, end];
    el.setSelectionRange(Math.min(start, end), Math.min(stop, end));
  };

  const onEditorOpenChange = (open: boolean) => {
    setEditorOpen(open);
    if (open) setWasLast(true);
  };
  /** Escape, × and "סיום": the note gets the focus back, at the editor's caret. */
  const handBack = () => {
    const ed = editorRef.current;
    if (ed) caretRef.current = [ed.selectionStart, ed.selectionEnd];
    restoreFocusRef.current = true;
  };
  const closeEditor = () => {
    handBack();
    setEditorOpen(false);
  };
  // Opening: the editor's textarea takes the focus (not the ×), at the note's caret. Not scrolled
  // into view — the popover is still being placed.
  const focusEditor = (e: Event) => {
    e.preventDefault();
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus({ preventScroll: true });
    placeCaret(ed);
  };
  // Closing: never Radix's own refocus (the trigger) — back to the note, or left where it went.
  const returnFocus = (e: Event) => {
    e.preventDefault();
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = false;
    const note = noteRef.current;
    if (!restore || !note) return;
    note.focus();
    placeCaret(note);
  };

  const expandButton = (
    <button type="button" className="tst-note-expand" aria-label={EXPAND_LABEL}>
      <Maximize2 size={16} strokeWidth={1.75} aria-hidden />
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "tst-note",
        `tst-note--${size}`,
        rowTone === "fail" && "tst-note--fail",
        legend && "tst-note--legend",
        className,
      )}
      style={legendBg ? ({ "--tst-note-legend-bg": legendBg } as React.CSSProperties) : undefined}
    >
      {required && requiredLabel !== "none" ? (
        <label htmlFor={id} className={requiredLabel === "legend" ? "tst-note-legend" : "tst-note-req"}>
          {REQUIRED_LABEL}
        </label>
      ) : labelText ? (
        <label htmlFor={id} className="sh-visually-hidden">{labelText}</label>
      ) : null}

      <div className="tst-note-box">
        <textarea
          ref={noteRef}
          id={id}
          className="tst-note-input"
          value={value}
          onChange={change}
          onSelect={trackCaret}
          onFocus={() => { setFocused(true); setWasLast(true); }}
          onBlur={() => setFocused(false)}
          rows={grows ? 1 : size === "verdict" ? 3 : undefined}
          maxLength={max}
          dir="auto"
          placeholder={shownPlaceholder}
          aria-required={required || undefined}
          aria-invalid={error || undefined}
          aria-describedby={described}
          data-collapsed={collapsed || undefined}
          data-error-placeholder={errorAsPlaceholder || undefined}
          {...{ [NOTE_ATTR]: "" }}
        />
        {collapsed && <span className="tst-note-fade" aria-hidden />}
        <AnchoredPopover
          open={editorOpen}
          onOpenChange={onEditorOpenChange}
          trigger={showExpand ? expandButton : undefined}
          anchorRef={rootRef}
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          // Portaled: the look and the legend's focus ring (artboard 14) travel on the editor itself.
          className={cn("tst-note-editor", look === "bold" && "tst-note-editor--bold", legend && "tst-note-editor--legend")}
          aria-label={editorTitle}
          onOpenAutoFocus={focusEditor}
          onCloseAutoFocus={returnFocus}
          onEscapeKeyDown={handBack}
          onInteractOutside={() => { restoreFocusRef.current = false; }}
        >
          <div className="tst-note-ed-head">
            <label htmlFor={editorId} className="tst-note-ed-title">{editorTitle}</label>
            <IconButton size="small" className="tst-note-ed-x" aria-label={CLOSE_LABEL} onClick={closeEditor}>
              <X size={16} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </div>
          <textarea
            ref={editorRef}
            id={editorId}
            className="tst-note-input tst-note-ed-input"
            value={value}
            onChange={change}
            onSelect={trackCaret}
            rows={8}
            maxLength={max}
            dir="auto"
            placeholder={shownPlaceholder}
            aria-required={required || undefined}
            aria-invalid={error || undefined}
            aria-describedby={described}
            data-error-placeholder={errorAsPlaceholder || undefined}
            {...{ [NOTE_ATTR]: "" }}
          />
          <div className="tst-note-ed-foot">
            {/* Always shown here; announced from 80%, like the note's own counter. */}
            <Counter len={len} max={max} live={near} look={look} countFirst />
            <Button size="small" className="tst-note-ed-done" onClick={closeEditor}>{DONE_LABEL}</Button>
          </div>
        </AnchoredPopover>
      </div>

      {/* Always in the page: a live region announces only what is added to it. */}
      <span id={errorId} className={errorStyle === "line" ? "tst-note-error" : "sh-visually-hidden"} aria-live="polite">
        {errorWords ? ERROR_TEXT : null}
      </span>

      {(collapsed || near) && (
        <div className="tst-note-meta">
          {collapsed && (
            // Out of the Tab order: the keyboard reaches the note itself, which opens on focus.
            <button
              type="button"
              className="tst-note-more"
              tabIndex={-1}
              aria-controls={id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => noteRef.current?.focus()}
            >
              {showAllLabel(lines)}
            </button>
          )}
          {/* Quiet while the editor is open: its own counter speaks. */}
          {near && <Counter len={len} max={max} live={!editorOpen} look={look} />}
        </div>
      )}
    </div>
  );
}

/** "{len} / {max}" (left to right), and "הגעת לאורך המרבי" beside it at the limit, as `look` draws
 *  it: "plain" / "bold" put the words before the count under the note and after it in the editor
 *  (artboards 12, 13); "dot" writes "הגעת לאורך המרבי · {count}" in both (artboards 15/16). */
function Counter({ len, max, live, look, countFirst = false }: {
  len: number; max: number; live: boolean; look: NoteLook; countFirst?: boolean;
}) {
  const atMax = len >= max;
  const count = <span dir="ltr" className="tst-note-count-num">{len} / {max}</span>;
  const limit = !atMax ? null : look === "dot" ? <span>{AT_MAX_TEXT + " · "}</span> : <span className="tst-note-limit">{AT_MAX_TEXT}</span>;
  return (
    <span className={cn("tst-note-count", look !== "plain" && `tst-note-count--${look}`)} data-at-max={atMax || undefined}
      aria-live={live ? "polite" : "off"} aria-atomic="true">
      {countFirst && look !== "dot" ? <>{count}{limit}</> : <>{limit}{count}</>}
    </span>
  );
}

export default NotesField;
