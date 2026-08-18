"use client";
import React, { useRef, useState, useMemo, useEffect, useLayoutEffect } from "react";
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

   The public API is unchanged, so every consumer (SearchableCombobox,
   WorkerPicker, dashboard filters, dialog fields) keeps working untouched.
   ========================================================================== */

type Reason = "selectOption" | "removeOption" | "clear" | "createOption" | "blur" | "input";

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
  renderOption?: (props: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key }, option: T, state: { selected: boolean }) => React.ReactNode;
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
  const [open, setOpen] = useState(false);
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current) onOpen?.();
    else if (!open && prevOpen.current) onClose?.();
    prevOpen.current = open;
  }, [open, onOpen, onClose]);
  const [internalValue, setInternalValue] = useState<T | T[] | null>(defaultValue ?? (multiple ? ([] as T[]) : null));
  const val = value !== undefined ? value : internalValue;
  const [inputText, setInputText] = useState("");
  const inputValue = inputValueProp !== undefined ? inputValueProp : inputText;

  // Live page-coordinates of the popup, measured from the field (the anchor).
  // `placement` flips to "top" when there isn't room below the field.
  const MENU_MAX_H = 320;
  const MIN_SPACE = 160; // below this much room under the field, prefer opening up
  const listRef = useRef<HTMLUListElement>(null);
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

  const selectedSingle = !multiple && val ? (val as T) : null;

  const filtered = useMemo(() => {
    if (filterOptions) return filterOptions(options, { inputValue });
    const q = inputValue.trim().toLowerCase();
    const selectedLabel = selectedSingle ? getOptionLabel(selectedSingle) : "";
    if (!q || (selectedSingle && inputValue === selectedLabel)) return options;
    return options.filter((o) => getOptionLabel(o).toLowerCase().includes(q));
  }, [options, inputValue, filterOptions, selectedSingle, getOptionLabel]);

  // Measure the field and keep the popup glued to it (open, scroll, resize).
  // Raw viewport coordinates from getBoundingClientRect() + position:fixed — no
  // scroll math — so it's immune to AppShell's inner scroller and any ancestor
  // with an offset / overflow. When flipped up, we anchor by `bottom` so the
  // list grows upward hugging the field regardless of how many items it has.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) { setPos(null); return; }
    const el = anchorRef.current;
    const GAP = 4, EDGE = 8; // px gap to field, min gap to viewport edge
    const update = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const spaceBelow = vh - r.bottom;
      const spaceAbove = r.top;
      const dir = getComputedStyle(el).direction === "rtl" ? "rtl" : "ltr";
      // open up only when there is genuinely no room below AND above has more
      const flip = spaceBelow < MIN_SPACE && spaceAbove > spaceBelow;
      if (flip) {
        // anchor by bottom => grows upward, glued to the field, item-count-agnostic
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
    };
    update();
    window.addEventListener("scroll", update, true); // capture: catch inner scrollers too
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, filtered.length]);

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

  const endAdornment = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {loading && <CircularProgress size={18} />}
      {!disableClearable && ((multiple && (val as T[]).length > 0) || (!multiple && selectedSingle)) && (
        <X size={16} strokeWidth={1.75} style={{ color: "var(--color-ink-muted-48)", cursor: "pointer" }}
          onMouseDown={(e) => { e.preventDefault(); clear(e); }} />
      )}
      <ChevronDown size={18} strokeWidth={1.75} style={{ color: "var(--color-ink-muted-48)", cursor: "pointer", transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }}
        onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o); }} />
    </span>
  );

  const displayValue = multiple ? inputValue : open ? inputValue : selectedSingle ? getOptionLabel(selectedSingle) : inputValue;

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
      onChange: (e) => { setInput(e, e.target.value, "input"); if (!open) setOpen(true); },
      onFocus: () => setOpen(true),
      // Reopen the list on click even when a value is already selected.
      onClick: () => setOpen(true),
      onBlur: (e) => {
        setTimeout(() => setOpen(false), 120);
        if (!multiple && freeSolo) setValue(e, inputValue as unknown as T, "blur");
      },
      onKeyDown: (e) => {
        if (e.key === "Escape") setOpen(false);
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
              <li className="sh-select-item" style={{ color: "var(--color-ink-muted-48)" }}>{loadingText}</li>
            ) : filtered.length === 0 ? (
              <li className="sh-select-item" style={{ color: "var(--color-ink-muted-48)" }}>{noOptionsText}</li>
            ) : (
              filtered.map((o, i) => {
                const selected = isSelected(o);
                const liProps: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key } = {
                  key: i,
                  className: "sh-select-item",
                  onClick: (e) => handleSelect(e, o),
                  style: selected ? { color: "var(--color-primary)", fontWeight: 600 } : undefined,
                };
                if (renderOption) return renderOption(liProps, o, { selected });
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
