"use client";
import React, { forwardRef } from "react";
import { splitSystemProps, sxToStyle, type SxInput, type SystemProps } from "./sx";

type AnyProps = Record<string, unknown>;

/* -------------------------------------------------------------- Paper ---- */
export interface PaperProps extends React.HTMLAttributes<HTMLElement>, Partial<SystemProps> {
  elevation?: number;
  square?: boolean;
  variant?: "elevation" | "outlined";
  component?: React.ElementType;
  sx?: SxInput;
}

/** Flat surface — never a shadow. Outlined variant adds a hairline. */
export const Paper = forwardRef<HTMLElement, PaperProps>(function Paper(
  { elevation: _e, square, variant, component: Component = "div", children, ...props },
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

/* --------------------------------------------------------------- Card ---- */
export interface CardProps extends React.HTMLAttributes<HTMLElement>, Partial<SystemProps> {
  variant?: "elevation" | "outlined";
  elevation?: number;
  component?: React.ElementType;
  sx?: SxInput;
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { variant: _v, elevation: _e, component: Component = "div", children, ...props },
  ref,
) {
  const { style, rest } = splitSystemProps(props as AnyProps);
  const base: React.CSSProperties = {
    backgroundColor: "var(--color-canvas)",
    border: "1px solid var(--color-hairline)",
    borderRadius: "var(--r-lg)",
  };
  return (
    <Component ref={ref} style={{ ...base, ...style }} {...(rest as AnyProps)}>
      {children}
    </Component>
  );
});

export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {
  sx?: SxInput;
}
export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(function CardContent(
  { sx, style, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} style={{ padding: 24, ...sxToStyle(sx), ...style }} {...rest}>
      {children}
    </div>
  );
});

export interface CardActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  sx?: SxInput;
}
export const CardActions = forwardRef<HTMLDivElement, CardActionsProps>(function CardActions(
  { sx, style, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 24px", ...sxToStyle(sx), ...style }} {...rest}>
      {children}
    </div>
  );
});

export interface CardHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  subheader?: React.ReactNode;
  action?: React.ReactNode;
  avatar?: React.ReactNode;
  sx?: SxInput;
}
export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  { title, subheader, action, avatar, sx, style, ...rest },
  ref,
) {
  return (
    <div ref={ref} style={{ display: "flex", alignItems: "center", gap: 12, padding: 24, ...sxToStyle(sx), ...style }} {...rest}>
      {avatar}
      <div style={{ flex: 1 }}>
        {title && <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18 }}>{title}</div>}
        {subheader && <div style={{ fontSize: 14, color: "var(--color-ink-muted-48)" }}>{subheader}</div>}
      </div>
      {action}
    </div>
  );
});
