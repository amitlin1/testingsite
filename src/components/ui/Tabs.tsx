"use client";
import React, { forwardRef } from "react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";

export interface TabProps {
  label?: React.ReactNode;
  value?: unknown;
  icon?: React.ReactNode;
  iconPosition?: "start" | "end" | "top" | "bottom";
  disabled?: boolean;
  sx?: SxInput;
  wrapped?: boolean;
}

/** Props holder — actual rendering is handled by <Tabs>. */
export function Tab(_props: TabProps) {
  return null;
}

export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value?: unknown;
  onChange?: (event: React.SyntheticEvent, value: any) => void;
  variant?: "standard" | "scrollable" | "fullWidth";
  centered?: boolean;
  orientation?: "horizontal" | "vertical";
  textColor?: string;
  indicatorColor?: string;
  sx?: SxInput;
}

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { value, onChange, variant, centered, orientation = "horizontal", textColor: _t, indicatorColor: _i, sx, style, className, children, ...rest },
  ref,
) {
  const vertical = orientation === "vertical";
  return (
    <div
      ref={ref}
      role="tablist"
      className={className}
      style={{
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        gap: 28,
        borderBottom: vertical ? undefined : "1px solid var(--color-hairline)",
        borderInlineEnd: vertical ? "1px solid var(--color-hairline)" : undefined,
        justifyContent: centered ? "center" : variant === "fullWidth" ? "stretch" : undefined,
        ...sxToStyle(sx),
        ...style,
      }}
      {...rest}
    >
      {React.Children.map(children, (child, i) => {
        if (!React.isValidElement(child)) return null;
        const p = child.props as TabProps;
        const tabValue = p.value !== undefined ? p.value : i;
        const active = tabValue === value;
        return (
          <button
            type="button"
            role="tab"
            aria-selected={active}
            disabled={p.disabled}
            data-state={active ? "active" : "inactive"}
            className={cn("sh-tab")}
            style={{ flex: variant === "fullWidth" ? 1 : undefined, display: "inline-flex", alignItems: "center", gap: 8, ...sxToStyle(p.sx) }}
            onClick={(e) => onChange?.(e, tabValue)}
          >
            {p.icon}
            {p.label}
          </button>
        );
      })}
    </div>
  );
});
