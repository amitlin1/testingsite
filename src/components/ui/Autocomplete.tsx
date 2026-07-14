"use client";
import React, { useRef, useState, useLayoutEffect, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, ChevronDown } from "lucide-react";
import { CircularProgress } from "./Progress";
import { sxToStyle, type SxInput } from "./sx";

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
  const [rect, setRect] = useState<DOMRect | null>(null);

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

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const update = () => setRect(anchorRef.current!.getBoundingClientRect());
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
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
      {open && rect && typeof document !== "undefined" && createPortal(
        <ul
          role="listbox"
          className="sh-select-content"
          style={{ position: "fixed", top: rect.bottom + 4, insetInlineStart: rect.left, width: rect.width, maxHeight: 320, overflowY: "auto", listStyle: "none", margin: 0, zIndex: 1450 }}
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
        </ul>,
        document.body,
      )}
    </div>
  );
}
