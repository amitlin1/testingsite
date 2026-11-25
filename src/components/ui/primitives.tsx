"use client";
import React, { forwardRef } from "react";
import { splitSystemProps, sxToStyle, type SxInput, type SystemProps } from "./sx";

type AnyProps = Record<string, unknown>;

/* ------------------------------------------------------------------ Box --- */
export interface BoxProps extends React.HTMLAttributes<HTMLElement>, Partial<SystemProps> {
  sx?: SxInput;
  component?: React.ElementType;
  // Attributes for polymorphic `component` (img/a/button/input …).
  src?: string;
  alt?: string;
  href?: string;
  target?: string;
  rel?: string;
  download?: string | boolean;
  type?: string;
  name?: string;
  value?: string | number | readonly string[];
  disabled?: boolean;
  loading?: "lazy" | "eager";
}

export const Box = forwardRef<HTMLElement, BoxProps>(function Box(
  { component: Component = "div", children, ...props },
  ref,
) {
  const { style, rest } = splitSystemProps(props as AnyProps);
  return (
    <Component ref={ref} style={style} {...(rest as AnyProps)}>
      {children}
    </Component>
  );
});

/* ---------------------------------------------------------------- Stack --- */
export interface StackProps
  extends React.HTMLAttributes<HTMLElement>,
    Partial<Omit<SystemProps, "alignItems" | "justifyContent" | "flexWrap" | "flexDirection">> {
  sx?: SxInput;
  component?: React.ElementType;
  direction?: React.CSSProperties["flexDirection"];
  spacing?: number | string;
  alignItems?: React.CSSProperties["alignItems"];
  justifyContent?: React.CSSProperties["justifyContent"];
  flexWrap?: React.CSSProperties["flexWrap"];
  divider?: React.ReactNode;
}

export const Stack = forwardRef<HTMLElement, StackProps>(function Stack(
  {
    component: Component = "div",
    direction = "column",
    spacing = 0,
    alignItems,
    justifyContent,
    flexWrap,
    divider,
    children,
    ...props
  },
  ref,
) {
  const { style, rest } = splitSystemProps(props as AnyProps);

  const base: React.CSSProperties = {
    display: "flex",
    flexDirection: direction,
    gap: typeof spacing === "number" ? spacing * 8 : spacing,
    alignItems,
    justifyContent,
    flexWrap,
  };

  let content: React.ReactNode = children;
  if (divider) {
    const items = React.Children.toArray(children).filter((c) => c != null);
    content = items.map((child, i) => (
      <React.Fragment key={i}>
        {i > 0 && divider}
        {child}
      </React.Fragment>
    ));
  }

  return (
    <Component ref={ref} style={{ ...base, ...style }} {...(rest as AnyProps)}>
      {content}
    </Component>
  );
});

/* -------------------------------------------------------------- Divider --- */
export interface DividerProps extends React.HTMLAttributes<HTMLElement> {
  sx?: SxInput;
  orientation?: "horizontal" | "vertical";
  flexItem?: boolean;
  light?: boolean;
  textAlign?: "center" | "left" | "right" | "start" | "end";
  component?: React.ElementType;
}

export const Divider = forwardRef<HTMLElement, DividerProps>(function Divider(
  { orientation = "horizontal", flexItem, light, textAlign = "center", sx, style, component: Component = "div", children, ...rest },
  ref,
) {
  const vertical = orientation === "vertical";
  const lineColor = light ? "var(--color-divider-soft)" : "var(--color-hairline)";

  // Text divider: line — text — line, weighted by textAlign.
  if (!vertical && children != null && children !== "") {
    const startFlex = textAlign === "left" || textAlign === "start" ? 0.08 : 1;
    const endFlex = textAlign === "right" || textAlign === "end" ? 0.08 : 1;
    return (
      <Component
        ref={ref}
        role="separator"
        style={{ display: "flex", alignItems: "center", gap: 12, ...sxToStyle(sx), ...style }}
        {...rest}
      >
        <span style={{ flex: startFlex, height: 1, background: lineColor }} />
        <span style={{ fontSize: 14, color: "var(--color-ink-muted-48)", whiteSpace: "nowrap" }}>{children}</span>
        <span style={{ flex: endFlex, height: 1, background: lineColor }} />
      </Component>
    );
  }

  const base: React.CSSProperties = vertical
    ? { alignSelf: "stretch", width: 1, minHeight: flexItem ? undefined : "1em", backgroundColor: lineColor }
    : { height: 1, width: "100%", border: "none", backgroundColor: lineColor };
  return (
    <Component ref={ref} role="separator" aria-orientation={orientation} style={{ ...base, ...sxToStyle(sx), ...style }} {...rest}>
      {children}
    </Component>
  );
});
