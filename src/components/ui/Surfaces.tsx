"use client";
import React, { forwardRef } from "react";
import { splitSystemProps, type SxInput, type SystemProps } from "./sx";

type AnyProps = Record<string, unknown>;

/* -------------------------------------------------------------- Paper ---- */
export interface PaperProps extends React.HTMLAttributes<HTMLElement>, Partial<SystemProps> {
  square?: boolean;
  variant?: "elevation" | "outlined";
  component?: React.ElementType;
  sx?: SxInput;
}

/** Flat surface — never a shadow. Outlined variant adds a hairline. */
export const Paper = forwardRef<HTMLElement, PaperProps>(function Paper(
  { square, variant, component: Component = "div", children, ...props },
  ref,
) {
  const { style, rest } = splitSystemProps(props as AnyProps);
  const base: React.CSSProperties = {
    backgroundColor: "var(--color-canvas)",
    borderRadius: square ? 0 : "var(--r-md)",
    border: variant === "outlined" ? "1px solid var(--color-hairline)" : undefined,
  };
  return (
    <Component ref={ref} style={{ ...base, ...style }} {...(rest as AnyProps)}>
      {children}
    </Component>
  );
});
