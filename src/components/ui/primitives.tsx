"use client";
import React, { forwardRef } from "react";
import { splitSystemProps, sxToStyle, type SxInput, type SystemProps } from "./sx";
import { lastResponsive } from "./utils";

type AnyProps = Record<string, unknown>;

/* ------------------------------------------------------------------ Box --- */
export interface BoxProps extends React.HTMLAttributes<HTMLElement>, Partial<SystemProps> {
  sx?: SxInput;
  component?: React.ElementType;
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
  direction?: string | Record<string, string> | string[];
  spacing?: number | Record<string, number> | number[];
  alignItems?: string | Record<string, string>;
  justifyContent?: string | Record<string, string>;
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
  const dir = lastResponsive(direction) as React.CSSProperties["flexDirection"];
  const sp = lastResponsive(spacing) as number | string;
  const { style, rest } = splitSystemProps(props as AnyProps);

  const base: React.CSSProperties = {
    display: "flex",
    flexDirection: dir,
    gap: typeof sp === "number" ? sp * 8 : sp,
    alignItems: alignItems ? (lastResponsive(alignItems) as string) : undefined,
    justifyContent: justifyContent ? (lastResponsive(justifyContent) as string) : undefined,
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
  component?: React.ElementType;
}

export const Divider = forwardRef<HTMLElement, DividerProps>(function Divider(
  { orientation = "horizontal", flexItem, light, sx, style, component: Component = "div", children, ...rest },
  ref,
) {
  const vertical = orientation === "vertical";
  const base: React.CSSProperties = vertical
    ? {
        alignSelf: "stretch",
        width: 1,
        minHeight: flexItem ? undefined : "1em",
        backgroundColor: light ? "var(--color-divider-soft)" : "var(--color-hairline)",
      }
    : {
        height: 1,
        width: "100%",
        border: "none",
        backgroundColor: light ? "var(--color-divider-soft)" : "var(--color-hairline)",
      };
  return (
    <Component
      ref={ref}
      role="separator"
      aria-orientation={orientation}
      style={{ ...base, ...sxToStyle(sx), ...style }}
      {...rest}
    >
      {children}
    </Component>
  );
});

/* ------------------------------------------------------------ Container --- */
export interface ContainerProps extends React.HTMLAttributes<HTMLElement> {
  sx?: SxInput;
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl" | false;
  disableGutters?: boolean;
  component?: React.ElementType;
}

const MAXW: Record<string, number> = { xs: 444, sm: 600, md: 900, lg: 1200, xl: 1536 };

export const Container = forwardRef<HTMLElement, ContainerProps>(function Container(
  { maxWidth = "lg", disableGutters, sx, style, component: Component = "div", children, ...rest },
  ref,
) {
  const base: React.CSSProperties = {
    width: "100%",
    marginInline: "auto",
    maxWidth: maxWidth ? MAXW[maxWidth] : undefined,
    paddingInline: disableGutters ? undefined : 24,
    boxSizing: "border-box",
  };
  return (
    <Component ref={ref} style={{ ...base, ...sxToStyle(sx), ...style }} {...rest}>
      {children}
    </Component>
  );
});
