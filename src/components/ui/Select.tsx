"use client";
import React, { forwardRef } from "react";
import * as RSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";

/** Radix forbids an empty-string item value; MUI uses "" freely. Bridge it. */
const EMPTY = "__sh_empty__";
const toRadix = (v: unknown) => (v === "" || v == null ? EMPTY : String(v));

export interface MenuItemProps extends Omit<React.LiHTMLAttributes<HTMLLIElement>, "value"> {
  value?: unknown;
  disabled?: boolean;
  /** danger styling when used inside a Menu (ignored in Select). */
  danger?: boolean;
  sx?: SxInput;
}

/** Dual purpose: read as an option by Select, or rendered standalone in a Menu. */
export function MenuItem({ value: _v, danger, sx, style, className, children, ...rest }: MenuItemProps) {
  return (
    <li className={cn("sh-menu-item", danger && "sh-menu-item--danger", className)} style={{ ...sxToStyle(sx), ...style }} {...rest}>
      {children}
    </li>
  );
}

type Option = { radix: string; original: unknown; label: React.ReactNode; disabled?: boolean };

function collectOptions(children: React.ReactNode): Option[] {
  const out: Option[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const p = child.props as MenuItemProps;
    if (p == null || !("value" in p)) return;
    out.push({ radix: toRadix(p.value), original: p.value, label: p.children, disabled: p.disabled });
  });
  return out;
}

type ChangeHandler = (e: { target: { value: unknown; name?: string } }, child?: React.ReactNode) => void;

export interface SelectProps {
  value?: unknown;
  defaultValue?: unknown;
  onChange?: ChangeHandler;
  name?: string;
  label?: React.ReactNode;
  labelId?: string;
  placeholder?: string;
  displayEmpty?: boolean;
  renderValue?: (value: unknown) => React.ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  error?: boolean;
  size?: "small" | "medium";
  sx?: SxInput;
  style?: React.CSSProperties;
  className?: string;
  children?: React.ReactNode;
  MenuProps?: unknown;
  variant?: string;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { value, defaultValue, onChange, name, label, placeholder, renderValue, disabled, fullWidth, error, sx, style, className, children },
  ref,
) {
  const options = collectOptions(children);
  const radixValue = value !== undefined ? toRadix(value) : undefined;
  const selected = options.find((o) => o.radix === (radixValue ?? toRadix(defaultValue)));

  const handleValueChange = (rv: string) => {
    const opt = options.find((o) => o.radix === rv);
    onChange?.({ target: { value: opt ? opt.original : rv, name } }, opt?.label);
  };

  const triggerLabel = renderValue
    ? renderValue(value)
    : selected
      ? selected.label
      : <span style={{ color: "var(--color-ink-muted-48)" }}>{placeholder ?? ""}</span>;

  return (
    <RSelect.Root
      value={radixValue}
      defaultValue={defaultValue !== undefined ? toRadix(defaultValue) : undefined}
      onValueChange={handleValueChange}
      disabled={disabled}
      dir="rtl"
    >
      <RSelect.Trigger
        ref={ref}
        aria-label={typeof label === "string" ? label : undefined}
        className={cn("sh-select-trigger", error && "sh-input--error", className)}
        style={{ width: fullWidth ? "100%" : undefined, ...sxToStyle(sx), ...style }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{triggerLabel}</span>
        <RSelect.Icon>
          <ChevronDown size={18} strokeWidth={1.75} style={{ color: "var(--color-ink-muted-48)" }} />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content position="popper" sideOffset={6} className="sh-select-content">
          <RSelect.Viewport>
            {options.map((o, i) => (
              <RSelect.Item key={o.radix + i} value={o.radix} disabled={o.disabled} className="sh-select-item">
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator>
                  <Check size={16} strokeWidth={2} style={{ color: "var(--color-primary)" }} />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
});

/* --------------------------------------------------- FormControl/Label --- */
export interface FormControlProps extends React.HTMLAttributes<HTMLDivElement> {
  fullWidth?: boolean;
  size?: "small" | "medium";
  error?: boolean;
  disabled?: boolean;
  variant?: string;
  margin?: string;
  sx?: SxInput;
  component?: React.ElementType;
}

export const FormControl = forwardRef<HTMLDivElement, FormControlProps>(function FormControl(
  { fullWidth, size: _s, error: _e, disabled: _d, variant: _v, margin: _m, sx, style, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      style={{ display: "inline-flex", flexDirection: "column", width: fullWidth ? "100%" : undefined, ...sxToStyle(sx), ...style }}
      {...rest}
    >
      {children}
    </div>
  );
});

export interface InputLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  error?: boolean;
  shrink?: boolean;
  sx?: SxInput;
}

export function InputLabel({ error, shrink: _sh, sx, style, className, children, ...rest }: InputLabelProps) {
  return (
    <label className={cn("sh-field-label", error && "sh-field-label--error", className)} style={{ ...sxToStyle(sx), ...style }} {...rest}>
      {children}
    </label>
  );
}

export default Select;
