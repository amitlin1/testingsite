"use client";
import React, { forwardRef } from "react";
import { sxToStyle, type SxInput } from "./sx";

type TColor = "standard" | "primary" | "secondary" | "success" | "error" | "warning" | "info";

const TINT: Record<TColor, { bg: string; fg: string }> = {
  standard: { bg: "rgba(0,102,204,.08)", fg: "var(--color-primary)" },
  primary: { bg: "rgba(0,102,204,.10)", fg: "var(--color-primary)" },
  secondary: { bg: "rgba(0,0,0,.06)", fg: "var(--color-ink)" },
  success: { bg: "rgba(31,138,91,.10)", fg: "var(--color-status-approved)" },
  error: { bg: "rgba(191,53,53,.10)", fg: "var(--color-destructive)" },
  warning: { bg: "rgba(217,119,6,.10)", fg: "var(--color-status-late)" },
  info: { bg: "rgba(0,102,204,.08)", fg: "var(--color-primary)" },
};

interface GroupCtx {
  value?: unknown;
  exclusive?: boolean;
  onItemClick?: (e: React.MouseEvent, v: unknown) => void;
  size?: "small" | "medium" | "large";
  color?: TColor;
  disabled?: boolean;
}
const Ctx = React.createContext<GroupCtx | null>(null);

export interface ToggleButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onChange" | "color"> {
  value: unknown;
  selected?: boolean;
  color?: TColor;
  size?: "small" | "medium" | "large";
  onChange?: (e: any, value: any) => void;
  sx?: SxInput;
}

export const ToggleButton = forwardRef<HTMLButtonElement, ToggleButtonProps>(function ToggleButton(
  { value, selected, color, size, onChange, disabled, sx, style, children, onClick, ...rest },
  ref,
) {
  const group = React.useContext(Ctx);
  const isSelected = group
    ? group.exclusive
      ? group.value === value
      : Array.isArray(group.value) && (group.value as unknown[]).includes(value)
    : selected;
  const col = color ?? group?.color ?? "standard";
  const tint = TINT[col];
  const sz = size ?? group?.size ?? "medium";
  const pad = sz === "small" ? "6px 14px" : sz === "large" ? "11px 26px" : "9px 22px";
  const isDisabled = disabled ?? group?.disabled;

  return (
    <button
      ref={ref}
      type="button"
      disabled={isDisabled}
      aria-pressed={!!isSelected}
      onClick={(e) => {
        onClick?.(e);
        if (group?.onItemClick) group.onItemClick(e, value);
        else onChange?.(e, value);
      }}
      style={{
        boxSizing: "border-box",
        cursor: isDisabled ? "not-allowed" : "pointer",
        padding: pad,
        fontFamily: "inherit",
        fontSize: 15,
        textAlign: "center",
        border: "none",
        background: isSelected ? tint.bg : "transparent",
        color: isSelected ? tint.fg : "var(--color-ink-muted-48)",
        fontWeight: isSelected ? 600 : 400,
        transition: "background .15s ease, color .15s ease",
        opacity: isDisabled ? 0.5 : 1,
        ...sxToStyle(sx),
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
});

export interface ToggleButtonGroupProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value?: unknown;
  exclusive?: boolean;
  onChange?: (event: any, value: any) => void;
  size?: "small" | "medium" | "large";
  color?: TColor;
  orientation?: "horizontal" | "vertical";
  fullWidth?: boolean;
  disabled?: boolean;
  sx?: SxInput;
}

export const ToggleButtonGroup = forwardRef<HTMLDivElement, ToggleButtonGroupProps>(function ToggleButtonGroup(
  { value, exclusive, onChange, size, color, orientation = "horizontal", fullWidth, disabled, sx, style, children, ...rest },
  ref,
) {
  const vertical = orientation === "vertical";
  const onItemClick = (e: React.MouseEvent, v: unknown) => {
    if (exclusive) onChange?.(e, value === v ? null : v);
    else {
      const arr = Array.isArray(value) ? [...(value as unknown[])] : [];
      const idx = arr.indexOf(v);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(v);
      onChange?.(e, arr);
    }
  };
  const items = React.Children.toArray(children).filter(React.isValidElement);
  return (
    <Ctx.Provider value={{ value, exclusive, onItemClick, size, color, disabled }}>
      <div
        ref={ref}
        style={{
          display: "inline-flex",
          flexDirection: vertical ? "column" : "row",
          width: fullWidth ? "100%" : undefined,
          border: "1px solid var(--color-hairline)",
          borderRadius: "var(--r-sm)",
          overflow: "hidden",
          background: "var(--color-canvas)",
          ...sxToStyle(sx),
          ...style,
        }}
        {...rest}
      >
        {items.map((child, i) => (
          <div
            key={i}
            style={{
              flex: fullWidth ? 1 : undefined,
              display: "flex",
              borderInlineStart: i > 0 && !vertical ? "1px solid var(--color-hairline)" : undefined,
              borderTop: i > 0 && vertical ? "1px solid var(--color-hairline)" : undefined,
            }}
          >
            {React.cloneElement(child as React.ReactElement<any>, { style: { flex: 1, ...(child as React.ReactElement<any>).props.style } })}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
});
