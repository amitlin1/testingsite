"use client";
import React, { useRef, useState, useMemo, useEffect, useLayoutEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import { X, ChevronDown } from "lucide-react";
import { CircularProgress } from "./Progress";
import { sxToStyle, type SxInput } from "./sx";

/* =============================================================================
   Autocomplete — Shifthouse (final)

   POSITIONING MODEL — read this before touching it
   ------------------------------------------------
   The popup list must satisfy TWO things at once:
     (1) sit EXACTLY below the field, and
     (2) never be clipped by a card / dialog with `overflow: hidden`.

   Neither an in-flow `absolute` child (gets clipped by the card) nor a naive
   `fixed` popup (drifts off the field under transforms / on scroll) does both.

   So the list is PORTALED to <body> (escapes every ancestor's overflow) and
   positioned with the field's LIVE page coordinates — recomputed on open, on
   scroll (capture phase, so inner scrollers count) and on resize. Result: glued
   to the bottom edge of the trigger, and never clipped, in any card or dialog.

   FLIP RULE. The list opens upward only when the room under the field is
   smaller than what the list actually needs (its rendered height, capped at
   MENU_MAX_H, plus the gap and the viewport edge) AND there is more room
   above. A fixed threshold would flip a three-row list that fits perfectly.
   The list is measured again right after it mounts (layout effect, before
   paint), so the first open already lands on the right side — and the side is
   then LOCKED for the rest of that open, so typing that shrinks or grows the
   list can never make it jump between above and below the field.

   KEYBOARD. ArrowDown / ArrowUp move a highlight (`data-highlighted` on the
   row; pointer movement sets the same state), Enter selects the highlighted
   row, Escape closes the list (and only the list: the event stops there so a
   surrounding dialog stays open). The input is a WAI-ARIA combobox:
   aria-expanded / aria-controls / aria-activedescendant follow the state.
   When the list closes for any reason the text snaps back to the selected
   option's label (or empty), so a half-typed search never survives Esc, Tab
   or an outside click. freeSolo keeps whatever was typed.

   The public API is unchanged for every consumer; renderOption additionally
   receives `highlighted` in its state and `data-highlighted` in its props.
   ========================================================================== */

type Reason = "selectOption" | "removeOption" | "clear" | "createOption" | "blur" | "input" | "reset";

/** Props handed to renderOption for one row. Spread them on the <li>. */
export type OptionLiProps = React.LiHTMLAttributes<HTMLLIElement> & { key?: React.Key; "data-highlighted"?: "" };

export interface AutocompleteProps<
  T,
  _Multiple = boolean | undefined,
  _DisableClearable = boolean | undefined,
  _FreeSolo = boolean | undefined,
> {
  options: T[];
  value?: T | T[] | null;
  defaultValue?: T | T[] | null;
  onChange?: (event: React.SyntheticEvent, value: any, reason: Reason) => void;
  onOpen?: (event?: React.SyntheticEvent) => void;
  onClose?: (event?: React.SyntheticEvent, reason?: string) => void;
  inputValue?: string;
  onInputChange?: (event: React.SyntheticEvent | null, value: string, reason: Reason) => void;
  getOptionLabel?: (option: T) => string;
  isOptionEqualToValue?: (option: T, value: T) => boolean;
  renderInput: (params: RenderInputParams) => React.ReactNode;
  renderOption?: (props: OptionLiProps, option: T, state: { selected: boolean; highlighted: boolean }) => React.ReactNode;
  renderTags?: (value: T[], getTagProps: (opts: { index: number }) => { key: number; onDelete: () => void }) => React.ReactNode;
  filterOptions?: (options: T[], state: { inputValue: string }) => T[];
  multiple?: boolean;
  freeSolo?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  loading?: boolean;
  loadingText?: React.ReactNode;
  noOptionsText?: React.ReactNode;
  disableClearable?: boolean;
  size?: "small" | "medium";
  popupIcon?: React.ReactNode;
  clearIcon?: React.ReactNode;
  slotProps?: Record<string, unknown>;
  componentsProps?: Record<string, unknown>;
  sx?: SxInput;
  id?: string;
  className?: string;
}

export interface RenderInputParams {
  id?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: "small" | "medium";
  InputLabelProps: Record<string, unknown>;
  InputProps: { ref?: React.Ref<HTMLDivElement>; startAdornment?: React.ReactNode; endAdornment?: React.ReactNode; className?: string };
  inputProps: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> };
}

const defaultLabel = (o: unknown) => (typeof o === "string" ? o : String((o as { label?: string })?.label ?? ""));

// Field contract: the list is at most this tall; the gap to the field and the
// minimum distance kept from the viewport edge.
const MENU_MAX_H = 264;
const GAP = 6;
const EDGE = 8;

export function Autocomplete<
  T,
  _Multiple = boolean | undefined,
  _DisableClearable = boolean | undefined,
  _FreeSolo = boolean | undefined,
>(props: AutocompleteProps<T>) {
  const {
    options, value, defaultValue, onChange, onOpen, onClose, inputValue: inputValueProp, onInputChange,
    getOptionLabel = defaultLabel as (o: T) => string,
    isOptionEqualToValue = (a: T, b: T) => a === b,
    renderInput, renderOption, filterOptions, multiple, freeSolo, disabled, fullWidth,
    loading, loadingText = "טוען…", noOptionsText = "אין אפשרויות", disableClearable, size, sx, id,
  } = props;

  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState<T | T[] | null>(defaultValue ?? (multiple ? ([] as T[]) : null));
  const val = value !== undefined ? value : internalValue;
  const selectedSingle = !multiple && val ? (val as T) : null;
  const selectedLabel = selectedSingle ? getOptionLabel(selectedSingle) : "";
  // Seeded from the value, so a field that mounts with one never reports a
  // spurious "reset" before anyone touched it.
  const [inputText, setInputText] = useState(selectedLabel);
  const inputValue = inputValueProp !== undefined ? inputValueProp : inputText;
  // Index into `filtered` of the row the keyboard / pointer is on; -1 = none.
  const [highlight, setHighlight] = useState(-1);
  const scrollToHighlight = useRef(false);
  // The side chosen once the list has been measured for real stays for the
  // rest of that open (typing must not bounce the list between above/below).
  const lockedPlacement = useRef<"top" | "bottom" | null>(null);

  const [pos, setPos] = useState<{
    left: number; width: number; dir: "ltr" | "rtl";
    placement: "bottom" | "top"; top?: number; bottom?: number; maxH: number;
  } | null>(null);

  const setValue = (e: React.SyntheticEvent, v: T | T[] | null, reason: Reason) => {
    if (value === undefined) setInternalValue(v);
    onChange?.(e, v, reason);
  };
  const setInput = (e: React.SyntheticEvent | null, v: string, reason: Reason) => {
    if (inputValueProp === undefined) setInputText(v);
    onInputChange?.(e, v, reason);
  };

  // onOpen / onClose callbacks, and the highlight reset when the list closes.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current) onOpen?.();
    else if (!open && prevOpen.current) { onClose?.(); setHighlight(-1); lockedPlacement.current = null; }
    prevOpen.current = open;
  }, [open, onOpen, onClose]);

  // Closed ⇒ the text is the selected option's label (or empty). This is what
  // discards a partial search on Esc / Tab / outside click, and follows a
  // value changed from outside while the list is closed. freeSolo owns its
  // text, so it is left alone.
  useLayoutEffect(() => {
    if (open || multiple || freeSolo) return;
    if (inputValue !== selectedLabel) setInput(null, selectedLabel, "reset");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedLabel]);

  const filtered = useMemo(() => {
    if (filterOptions) return filterOptions(options, { inputValue });
    const q = inputValue.trim().toLowerCase();
    if (!q || (selectedSingle && inputValue === selectedLabel)) return options;
    return options.filter((o) => getOptionLabel(o).toLowerCase().includes(q));
  }, [options, inputValue, filterOptions, selectedSingle, selectedLabel, getOptionLabel]);
  const hl = highlight < filtered.length ? highlight : -1;
  useEffect(() => {
    if (highlight >= filtered.length && highlight !== -1) setHighlight(-1);
  }, [highlight, filtered.length]);

  // Measure the field and place the popup. Raw viewport coordinates from
  // getBoundingClientRect() + position:fixed — no scroll math — so it's immune
  // to AppShell's inner scroller and any ancestor with an offset / overflow.
  // When flipped up, we anchor by `bottom` so the list grows upward hugging the
  // field regardless of how many items it has.
  const measure = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const spaceBelow = vh - r.bottom;
    const spaceAbove = r.top;
    const dir = getComputedStyle(el).direction === "rtl" ? "rtl" : "ltr";
    // What the list needs: its real height (once rendered) capped at MENU_MAX_H.
    // Before the first render it is assumed full-height, and re-measured right
    // after the list mounts (still before paint).
    const listH = listRef.current?.scrollHeight ?? 0;
    const need = (listH > 0 ? Math.min(MENU_MAX_H, listH) : MENU_MAX_H) + GAP + EDGE;
    const flip = lockedPlacement.current
      ? lockedPlacement.current === "top"
      : spaceBelow < need && spaceAbove > spaceBelow;
    if (!lockedPlacement.current && listH > 0) lockedPlacement.current = flip ? "top" : "bottom";
    if (flip) {
      setPos({
        placement: "top",
        bottom: vh - r.top + GAP,
        left: r.left, width: r.width, dir,
        maxH: Math.max(120, Math.min(MENU_MAX_H, spaceAbove - GAP - EDGE)),
      });
    } else {
      setPos({
        placement: "bottom",
        top: r.bottom + GAP,
        left: r.left, width: r.width, dir,
        maxH: Math.max(120, Math.min(MENU_MAX_H, spaceBelow - GAP - EDGE)),
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    measure();
    window.addEventListener("scroll", measure, true); // capture: catch inner scrollers too
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, filtered.length, measure]);

  // Second pass: the list exists now, so its real height decides the side.
  const listMounted = open && pos !== null;
  useLayoutEffect(() => {
    if (listMounted) measure();
  }, [listMounted, filtered.length, loading, measure]);

  // Keep the highlighted row in view when it moved by keyboard.
  useLayoutEffect(() => {
    if (!open || !scrollToHighlight.current) return;
    scrollToHighlight.current = false;
    listRef.current?.querySelector<HTMLElement>("[data-highlighted]")?.scrollIntoView({ block: "nearest" });
  }, [open, hl]);

  const isSelected = (o: T) => {
    if (multiple) return (val as T[]).some((v) => isOptionEqualToValue(o, v));
    return selectedSingle != null && isOptionEqualToValue(o, selectedSingle);
  };

  const handleSelect = (e: React.SyntheticEvent, o: T) => {
    if (multiple) {
      const arr = val as T[];
      const exists = arr.some((v) => isOptionEqualToValue(o, v));
      const next = exists ? arr.filter((v) => !isOptionEqualToValue(o, v)) : [...arr, o];
      setValue(e, next, exists ? "removeOption" : "selectOption");
      setInput(e, "", "selectOption");
    } else {
      setValue(e, o, "selectOption");
      setInput(e, getOptionLabel(o), "selectOption");
      setOpen(false);
    }
  };

  const clear = (e: React.SyntheticEvent) => {
    setValue(e, multiple ? ([] as T[]) : null, "clear");
    setInput(e, "", "clear");
  };

  const moveHighlight = (dir: 1 | -1) => {
    if (loading || filtered.length === 0) return;
    // Nothing highlighted yet: step from the selected row, so it keeps its
    // tint until the cursor reaches it.
    const from = hl >= 0
      ? hl
      : selectedSingle != null
        ? filtered.findIndex((o) => isOptionEqualToValue(o, selectedSingle))
        : -1;
    const next = dir === 1 ? Math.min(filtered.length - 1, from + 1) : Math.max(0, from < 0 ? 0 : from - 1);
    scrollToHighlight.current = true;
    setHighlight(next);
  };

  // Tags for multiple
  const tags = multiple
    ? (val as T[]).map((o, index) => (
        <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--color-canvas-parchment)", borderRadius: "var(--r-xs)", padding: "3px 8px", fontSize: 14, margin: 2 }}>
          {getOptionLabel(o)}
          <X size={14} strokeWidth={1.75} style={{ color: "var(--color-ink-muted-48)", cursor: "pointer" }}
            onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); handleSelect(ev, o); }} />
        </span>
      ))
    : undefined;

  // The × and the arrow carry their own class names (sh-ac-clear / sh-ac-arrow)
  // so stylesheets never depend on lucide's generated class names. A disabled
  // field ignores both: it must not be clearable or openable from its arrow.
  const endAdornment = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {loading && <CircularProgress size={18} />}
      {!disableClearable && !disabled && ((multiple && (val as T[]).length > 0) || (!multiple && selectedSingle)) && (
        <X className="sh-ac-clear" size={16} strokeWidth={1.75} style={{ color: "var(--color-ink-muted-48)", cursor: "pointer" }}
          onMouseDown={(e) => { e.preventDefault(); clear(e); }} />
      )}
      <ChevronDown className="sh-ac-arrow" size={18} strokeWidth={1.75}
        style={{ color: "var(--color-ink-muted-48)", cursor: disabled ? "default" : "pointer", transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }}
        onMouseDown={(e) => {
          e.preventDefault();
          if (disabled) return;
          if (open) { setOpen(false); return; }
          setOpen(true);
          // Focus goes with the list: otherwise a list opened from the arrow
          // could never be closed by a click elsewhere (there is nothing to blur).
          anchorRef.current?.querySelector("input")?.focus();
        }} />
    </span>
  );

  const displayValue = multiple ? inputValue : open ? inputValue : selectedSingle ? selectedLabel : inputValue;

  const params: RenderInputParams = {
    id,
    disabled,
    fullWidth,
    size,
    InputLabelProps: {},
    InputProps: { startAdornment: tags, endAdornment },
    inputProps: {
      value: displayValue,
      disabled,
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": open,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open && hl >= 0 ? `${listId}-${hl}` : undefined,
      onChange: (e) => { setInput(e, e.target.value, "input"); setHighlight(0); if (!open) setOpen(true); },
      onFocus: () => setOpen(true),
      // Reopen the list on click even when a value is already selected.
      onClick: () => setOpen(true),
      onBlur: (e) => {
        setTimeout(() => setOpen(false), 120);
        if (!multiple && freeSolo) setValue(e, inputValue as unknown as T, "blur");
      },
      onKeyDown: (e) => {
        if (e.key === "Escape") {
          // Only the list closes; a dialog around the field must not.
          if (open) { e.stopPropagation(); e.preventDefault(); setOpen(false); }
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!open) { setOpen(true); return; }
          moveHighlight(e.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (e.key === "Enter" && open && !loading && hl >= 0) {
          e.preventDefault();
          handleSelect(e, filtered[hl]);
          return;
        }
        if (e.key === "Backspace" && multiple && !inputValue && (val as T[]).length) {
          handleSelect(e, (val as T[])[(val as T[]).length - 1]);
        }
      },
      autoComplete: "off",
    },
  };

  return (
    <div ref={anchorRef} style={{ position: "relative", width: fullWidth ? "100%" : undefined, ...sxToStyle(sx) }}>
      {renderInput(params)}
      {open && pos && typeof document !== "undefined" && createPortal(
        // This popup is portaled to <body> as a sibling of any Radix Dialog that
        // contains the field, not a DOM descendant of it. A modal Radix Dialog
        // sets `document.body.style.pointerEvents = "none"` while open and only
        // re-enables `auto` on its own content node — so without `pointerEvents:
        // "auto"` here, the list is visible but every click passes straight
        // through it to the page behind, which Radix then sees as an outside
        // click and dismisses the dialog before a selection is ever made.
        // DismissableLayerBranch registers this popup in the shared (global,
        // ancestor-independent) Radix DismissableLayerContext so that once
        // clicks DO land here, the dialog still doesn't treat them as "outside".
        <DismissableLayerBranch>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="sh-select-content"
            dir={pos.dir}
            style={{
              position: "fixed",
              pointerEvents: "auto",
              ...(pos.placement === "top" ? { bottom: pos.bottom } : { top: pos.top }),
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxH,
              overflowY: "auto",
              listStyle: "none",
              margin: 0,
              zIndex: 1450,
              // Shadow points away from the field: down when below, up when flipped.
              boxShadow: pos.placement === "top"
                ? "rgba(0,0,0,0.14) 0 -10px 34px 0"
                : "rgba(0,0,0,0.14) 0 12px 34px 0",
              transformOrigin: pos.placement === "top" ? "bottom center" : "top center",
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {loading ? (
              <li className="sh-select-item" role="presentation" style={{ color: "var(--color-ink-muted-48)" }}>{loadingText}</li>
            ) : filtered.length === 0 ? (
              <li className="sh-select-item" role="presentation" style={{ color: "var(--color-ink-muted-48)" }}>{noOptionsText}</li>
            ) : (
              filtered.map((o, i) => {
                const selected = isSelected(o);
                const highlighted = i === hl;
                const liProps: OptionLiProps = {
                  key: i,
                  id: `${listId}-${i}`,
                  className: "sh-select-item",
                  role: "option",
                  "aria-selected": selected,
                  "data-highlighted": highlighted ? "" : undefined,
                  onClick: (e) => handleSelect(e, o),
                  // Pointer MOVEMENT, not enter: a keyboard scroll that slides a
                  // row under a resting cursor must not steal the highlight.
                  onMouseMove: () => { if (!highlighted) setHighlight(i); },
                  style: selected ? { color: "var(--color-primary)", fontWeight: 600 } : undefined,
                };
                if (renderOption) return renderOption(liProps, o, { selected, highlighted });
                const { key: _k, ...liRest } = liProps;
                return <li key={i} {...liRest}>{getOptionLabel(o)}</li>;
              })
            )}
          </ul>
        </DismissableLayerBranch>,
        document.body,
      )}
    </div>
  );
}
