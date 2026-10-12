"use client";
import React, { forwardRef } from "react";
import { resolveColor, splitSystemProps, sxToStyle, type SxInput, type SystemProps } from "./sx";

type Variant =
  | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
  | "subtitle1" | "subtitle2" | "body1" | "body2"
  | "caption" | "overline" | "button" | "inherit";

const DISPLAY = "var(--font-display)";

// The product type scale (tokens.css --text-*). Hebrew has no capitals, so
// overline gets no uppercase / tracking (they only hurt legibility).
const VARIANTS: Record<Exclude<Variant, "inherit">, React.CSSProperties> = {
  h1: { fontFamily: DISPLAY, fontWeight: 700, fontSize: "var(--text-page)", lineHeight: 1.1, letterSpacing: "var(--ls-display)" },
  h2: { fontFamily: DISPLAY, fontWeight: 700, fontSize: "var(--text-heading)", lineHeight: 1.15, letterSpacing: "var(--ls-display)" },
  h3: { fontFamily: DISPLAY, fontWeight: 700, fontSize: "var(--text-title)", lineHeight: 1.2 },
  h4: { fontFamily: DISPLAY, fontWeight: 700, fontSize: "var(--text-title)", lineHeight: 1.2 },
  h5: { fontFamily: DISPLAY, fontWeight: 600, fontSize: "var(--text-lead)", lineHeight: 1.25 },
  h6: { fontFamily: DISPLAY, fontWeight: 600, fontSize: "var(--text-body)", lineHeight: "var(--lh-snug)" },
  subtitle1: { fontWeight: 600, fontSize: "var(--text-body)", lineHeight: 1.4 },
  subtitle2: { fontWeight: 600, fontSize: "var(--text-body-sm)", lineHeight: 1.4 },
  body1: { fontWeight: 400, fontSize: "var(--text-body)", lineHeight: "var(--lh-body)" },
  body2: { fontWeight: 400, fontSize: "var(--text-body-sm)", lineHeight: "var(--lh-body)" },
  caption: { fontWeight: 400, fontSize: "var(--text-fine)", lineHeight: 1.4, color: "var(--color-ink-muted-48)" },
  overline: { fontWeight: 600, fontSize: "var(--text-fine)", lineHeight: 1.3, color: "var(--color-ink-muted-48)" },
  button: { fontWeight: 600, fontSize: "var(--text-body-sm)", lineHeight: 1.4 },
};

const TAG: Record<Exclude<Variant, "inherit">, string> = {
  h1: "h1", h2: "h2", h3: "h3", h4: "h4", h5: "h5", h6: "h6",
  subtitle1: "p", subtitle2: "p", body1: "p", body2: "p",
  caption: "span", overline: "span", button: "span",
};

const LEGACY_COLOR: Record<string, string> = {
  textPrimary: "var(--color-ink)",
  textSecondary: "var(--color-ink-muted-48)",
  primary: "var(--color-primary)",
  secondary: "var(--color-ink-muted-80)",
  error: "var(--color-destructive)",
  success: "var(--color-success-ink)",
  warning: "var(--color-warning-ink)",
  inherit: "inherit",
};

function resolveTextColor(c?: string): string | undefined {
  if (!c) return undefined;
  if (LEGACY_COLOR[c]) return LEGACY_COLOR[c];
  return resolveColor(c) as string;
}

export interface TypographyProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "color">,
    Partial<Omit<SystemProps, "fontWeight" | "fontSize">> {
  variant?: Variant;
  component?: React.ElementType;
  color?: string;
  align?: React.CSSProperties["textAlign"];
  gutterBottom?: boolean;
  paragraph?: boolean;
  noWrap?: boolean;
  fontWeight?: number | string;
  fontSize?: number | string;
  sx?: SxInput;
}

export const Typography = forwardRef<HTMLElement, TypographyProps>(function Typography(
  { variant = "body1", component, color, align, gutterBottom, paragraph, noWrap, fontWeight, fontSize, sx, children, ...rest },
  ref,
) {
  const Component = (component || (variant === "inherit" ? "span" : TAG[variant])) as React.ElementType;
  const base = variant === "inherit" ? {} : VARIANTS[variant];
  const { style: sysStyle, rest: domRest } = splitSystemProps(rest as Record<string, unknown>);
  const extra: React.CSSProperties = {
    color: resolveTextColor(color),
    textAlign: align,
    marginBottom: paragraph ? 16 : gutterBottom ? "0.35em" : undefined,
    fontWeight: fontWeight as React.CSSProperties["fontWeight"],
    fontSize,
    ...(noWrap ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : null),
  };
  return (
    <Component ref={ref} style={{ ...base, ...extra, ...sysStyle, ...sxToStyle(sx) }} {...(domRest as Record<string, unknown>)}>
      {children}
    </Component>
  );
});
