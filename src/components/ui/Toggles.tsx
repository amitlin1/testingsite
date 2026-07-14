"use client";
import React, { forwardRef } from "react";
import * as RSwitch from "@radix-ui/react-switch";
import * as RCheckbox from "@radix-ui/react-checkbox";
import * as RRadio from "@radix-ui/react-radio-group";
import { Check, Minus } from "lucide-react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";

type ChangeEvt = { target: { checked: boolean; name?: string; value?: unknown } };

/* -------------------------------------------------------------- Switch --- */
export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (e: ChangeEvt, checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  value?: unknown;
  size?: "small" | "medium";
  color?: string;
  sx?: SxInput;
  className?: string;
  id?: string;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, defaultChecked, onChange, disabled, name, value, sx, style, className, id }: SwitchProps & { style?: React.CSSProperties },
  ref,
) {
  return (
    <RSwitch.Root
      ref={ref}
      id={id}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      name={name}
      onCheckedChange={(c) => onChange?.({ target: { checked: c, name, value } }, c)}
      className={cn("sh-switch", className)}
      style={{ ...sxToStyle(sx), ...style }}
    >
      <RSwitch.Thumb className="sh-switch-thumb" />
    </RSwitch.Root>
  );
});

/* ------------------------------------------------------------ Checkbox --- */
export interface CheckboxProps {
  checked?: boolean;
  defaultChecked?: boolean;
  indeterminate?: boolean;
  onChange?: (e: ChangeEvt, checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  value?: unknown;
  size?: "small" | "medium";
  color?: string;
  sx?: SxInput;
  className?: string;
  id?: string;
}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { checked, defaultChecked, indeterminate, onChange, disabled, name, value, sx, style, className, id }: CheckboxProps & { style?: React.CSSProperties },
  ref,
) {
  const state = indeterminate ? "indeterminate" : checked;
  return (
    <RCheckbox.Root
      ref={ref}
      id={id}
      checked={state as boolean | "indeterminate"}
      defaultChecked={defaultChecked}
      disabled={disabled}
      name={name}
      value={value != null ? String(value) : undefined}
      onCheckedChange={(c) => onChange?.({ target: { checked: !!c, name, value } }, !!c)}
      className={cn("sh-checkbox", className)}
      style={{ ...sxToStyle(sx), ...style }}
    >
      <RCheckbox.Indicator>
        {indeterminate ? <Minus size={14} strokeWidth={3} /> : <Check size={14} strokeWidth={3} />}
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
});

/* --------------------------------------------------------- RadioGroup ---- */
export interface RadioGroupProps {
  value?: unknown;
  defaultValue?: unknown;
  onChange?: (e: { target: { value: string; name?: string } }, value: string) => void;
  name?: string;
  row?: boolean;
  sx?: SxInput;
  style?: React.CSSProperties;
  className?: string;
  children?: React.ReactNode;
  id?: string;
  "aria-label"?: string;
  role?: string;
}

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(function RadioGroup(
  { value, defaultValue, onChange, name, row, sx, style, children, ...rest },
  ref,
) {
  return (
    <RRadio.Root
      ref={ref}
      value={value != null ? String(value) : undefined}
      defaultValue={defaultValue != null ? String(defaultValue) : undefined}
      name={name}
      onValueChange={(v) => onChange?.({ target: { value: v, name } }, v)}
      style={{ display: "flex", flexDirection: row ? "row" : "column", gap: row ? 20 : 10, ...sxToStyle(sx), ...style }}
      {...rest}
    >
      {children}
    </RRadio.Root>
  );
});

/* -------------------------------------------------------------- Radio ---- */
export interface RadioProps {
  value?: unknown;
  disabled?: boolean;
  size?: "small" | "medium";
  color?: string;
  sx?: SxInput;
  className?: string;
  id?: string;
}

export const Radio = forwardRef<HTMLButtonElement, RadioProps>(function Radio(
  { value, disabled, sx, style, className, id }: RadioProps & { style?: React.CSSProperties },
  ref,
) {
  return (
    <RRadio.Item
      ref={ref}
      id={id}
      value={value != null ? String(value) : ""}
      disabled={disabled}
      className={cn("sh-radio", className)}
      style={{ ...sxToStyle(sx), ...style }}
    >
      <RRadio.Indicator className="sh-radio-dot" />
    </RRadio.Item>
  );
});

/* -------------------------------------------------- FormControlLabel ----- */
export interface FormControlLabelProps {
  control: React.ReactElement;
  label: React.ReactNode;
  value?: unknown;
  disabled?: boolean;
  labelPlacement?: "end" | "start" | "top" | "bottom";
  sx?: SxInput;
  className?: string;
  style?: React.CSSProperties;
}

export function FormControlLabel({ control, label, value, disabled, labelPlacement = "end", sx, style, className }: FormControlLabelProps) {
  const controlWithValue =
    value !== undefined ? React.cloneElement(control, { value, disabled } as Record<string, unknown>) : control;
  const dirStyle: React.CSSProperties =
    labelPlacement === "start"
      ? { flexDirection: "row-reverse" }
      : labelPlacement === "top"
        ? { flexDirection: "column-reverse", alignItems: "flex-start" }
        : labelPlacement === "bottom"
          ? { flexDirection: "column", alignItems: "flex-start" }
          : {};
  return (
    <label
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: disabled ? "not-allowed" : "pointer", ...dirStyle, ...sxToStyle(sx), ...style }}
    >
      {controlWithValue}
      <span style={{ fontSize: 15, color: disabled ? "var(--color-ink-muted-48)" : "var(--color-ink)" }}>{label}</span>
    </label>
  );
}
