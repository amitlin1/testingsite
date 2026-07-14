"use client";
import React, { forwardRef } from "react";
import { splitSystemProps, sxToStyle, type SxInput, type SystemProps } from "./sx";
import { cn } from "./utils";

type AnyProps = Record<string, unknown>;

/* --------------------------------------------------------------- Grid ---- */
type GridSize = number | "auto" | boolean | { xs?: number | "auto" | boolean; sm?: number | "auto" | boolean; md?: number | "auto" | boolean; lg?: number | "auto" | boolean; xl?: number | "auto" | boolean };

export interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  container?: boolean;
  item?: boolean;
  spacing?: number;
  rowSpacing?: number;
  columnSpacing?: number;
  columns?: number;
  size?: GridSize;
  xs?: number | "auto" | boolean;
  sm?: number | "auto" | boolean;
  md?: number | "auto" | boolean;
  lg?: number | "auto" | boolean;
  xl?: number | "auto" | boolean;
  direction?: React.CSSProperties["flexDirection"];
  alignItems?: string;
  justifyContent?: string;
  wrap?: React.CSSProperties["flexWrap"];
  sx?: SxInput;
  component?: React.ElementType;
}

function resolveSpan(p: GridProps): number | "auto" | undefined {
  const fromSize = p.size !== undefined
    ? typeof p.size === "object"
      ? (p.size.xl ?? p.size.lg ?? p.size.md ?? p.size.sm ?? p.size.xs)
      : p.size
    : (p.xl ?? p.lg ?? p.md ?? p.sm ?? p.xs);
  if (fromSize === undefined) return undefined;
  if (fromSize === true || fromSize === "auto") return "auto";
  if (fromSize === false) return undefined;
  return fromSize as number;
}

export const Grid = forwardRef<HTMLDivElement, GridProps>(function Grid(
  { container, item, spacing = 0, rowSpacing, columnSpacing, columns = 12, size, xs, sm, md, lg, xl, direction, alignItems, justifyContent, wrap, sx, style, component: Component = "div", children, ...rest },
  ref,
) {
  const span = resolveSpan({ size, xs, sm, md, lg, xl });
  const containerStyle: React.CSSProperties = container
    ? {
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        columnGap: (columnSpacing ?? spacing) * 8,
        rowGap: (rowSpacing ?? spacing) * 8,
        alignItems,
        justifyContent,
      }
    : {};
  const itemStyle: React.CSSProperties = item || span !== undefined
    ? { gridColumn: span === "auto" || span === undefined ? "auto" : `span ${Math.min(columns, span)} / span ${Math.min(columns, span)}`, minWidth: 0 }
    : {};
  return (
    <Component ref={ref} style={{ ...containerStyle, ...itemStyle, ...sxToStyle(sx), ...style }} {...(rest as AnyProps)}>
      {children}
    </Component>
  );
});

/* --------------------------------------------------------------- List ---- */
export interface ListProps extends React.HTMLAttributes<HTMLUListElement>, Partial<SystemProps> {
  dense?: boolean;
  disablePadding?: boolean;
  subheader?: React.ReactNode;
  component?: React.ElementType;
  sx?: SxInput;
}
export const List = forwardRef<HTMLUListElement, ListProps>(function List(
  { dense: _d, disablePadding, subheader, component: Component = "ul", children, ...props },
  ref,
) {
  const { style, rest } = splitSystemProps(props as AnyProps);
  return (
    <Component ref={ref} style={{ listStyle: "none", margin: 0, padding: disablePadding ? 0 : "8px 0", ...style }} {...(rest as AnyProps)}>
      {subheader}
      {children}
    </Component>
  );
});

export interface ListItemProps
  extends React.LiHTMLAttributes<HTMLLIElement>,
    Partial<Omit<SystemProps, "alignItems">> {
  disablePadding?: boolean;
  disableGutters?: boolean;
  secondaryAction?: React.ReactNode;
  alignItems?: "center" | "flex-start";
  divider?: boolean;
  component?: React.ElementType;
  sx?: SxInput;
}
export const ListItem = forwardRef<HTMLLIElement, ListItemProps>(function ListItem(
  { disablePadding, disableGutters, secondaryAction, alignItems = "center", divider, component: Component = "li", children, ...props },
  ref,
) {
  const { style, rest } = splitSystemProps(props as AnyProps);
  return (
    <Component
      ref={ref}
      style={{
        display: "flex",
        alignItems,
        gap: 12,
        padding: disablePadding ? 0 : disableGutters ? "8px 0" : "8px 16px",
        borderBottom: divider ? "1px solid var(--color-divider-soft)" : undefined,
        position: secondaryAction ? "relative" : undefined,
        ...style,
      }}
      {...(rest as AnyProps)}
    >
      {children}
      {secondaryAction && <span style={{ marginInlineStart: "auto" }}>{secondaryAction}</span>}
    </Component>
  );
});

export interface ListItemButtonProps extends React.HTMLAttributes<HTMLDivElement>, Partial<SystemProps> {
  selected?: boolean;
  disabled?: boolean;
  disableGutters?: boolean;
  dense?: boolean;
  component?: React.ElementType;
  href?: string;
  sx?: SxInput;
}
export const ListItemButton = forwardRef<HTMLDivElement, ListItemButtonProps>(function ListItemButton(
  { selected, disabled, disableGutters, dense: _dn, component, href, children, className, ...props },
  ref,
) {
  const { style, rest } = splitSystemProps(props as AnyProps);
  const Component = (component || (href ? "a" : "div")) as React.ElementType;
  return (
    <Component
      ref={ref}
      href={href}
      className={cn("sh-list-button", selected && "sh-list-button--selected", className)}
      aria-disabled={disabled || undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: disableGutters ? "8px 0" : "8px 16px",
        cursor: disabled ? "not-allowed" : "pointer",
        borderRadius: "var(--r-sm)",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
      {...(rest as AnyProps)}
    >
      {children}
    </Component>
  );
});

export function ListItemIcon({ children, style, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", minWidth: 32, color: "var(--color-ink-muted-48)", ...style }} {...rest}>
      {children}
    </span>
  );
}
export function ListItemText({ primary, secondary, style, primaryTypographyProps: _p, secondaryTypographyProps: _s, ...rest }: { primary?: React.ReactNode; secondary?: React.ReactNode; primaryTypographyProps?: unknown; secondaryTypographyProps?: unknown } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, ...style }} {...rest}>
      {primary != null && <span style={{ fontSize: 15 }}>{primary}</span>}
      {secondary != null && <span style={{ fontSize: 13, color: "var(--color-ink-muted-48)" }}>{secondary}</span>}
    </span>
  );
}
export function ListItemAvatar({ children, style, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span style={{ display: "inline-flex", minWidth: 40, ...style }} {...rest}>{children}</span>;
}
export function ListSubheader({ children, style, ...rest }: React.HTMLAttributes<HTMLLIElement>) {
  return (
    <li style={{ listStyle: "none", padding: "8px 16px", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--color-ink-muted-48)", ...style }} {...rest}>
      {children}
    </li>
  );
}

/* ------------------------------------------------------------- Collapse -- */
export interface CollapseProps extends React.HTMLAttributes<HTMLDivElement> {
  in?: boolean;
  orientation?: "vertical" | "horizontal";
  timeout?: number | "auto";
  unmountOnExit?: boolean;
  sx?: SxInput;
}
export const Collapse = forwardRef<HTMLDivElement, CollapseProps>(function Collapse(
  { in: open = false, orientation = "vertical", timeout: _t, unmountOnExit, sx, style, children, ...rest },
  ref,
) {
  if (unmountOnExit && !open) return null;
  const horizontal = orientation === "horizontal";
  return (
    <div
      ref={ref}
      style={{
        display: "grid",
        gridTemplateRows: horizontal ? undefined : open ? "1fr" : "0fr",
        gridTemplateColumns: horizontal ? (open ? "1fr" : "0fr") : undefined,
        transition: "grid-template-rows .25s ease, grid-template-columns .25s ease",
        ...sxToStyle(sx),
        ...style,
      }}
      {...rest}
    >
      <div style={{ overflow: "hidden", minHeight: 0, minWidth: 0 }}>{children}</div>
    </div>
  );
});

/* ------------------------------------------------------------- Toolbar --- */
export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement>, Partial<SystemProps> {
  variant?: "regular" | "dense";
  disableGutters?: boolean;
  sx?: SxInput;
}
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(
  { variant, disableGutters, children, ...props },
  ref,
) {
  const { style, rest } = splitSystemProps(props as AnyProps);
  return (
    <div
      ref={ref}
      style={{ display: "flex", alignItems: "center", minHeight: variant === "dense" ? 48 : 56, paddingInline: disableGutters ? 0 : 16, ...style }}
      {...(rest as AnyProps)}
    >
      {children}
    </div>
  );
});

/* ---------------------------------------------------------- Breadcrumbs -- */
export interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  separator?: React.ReactNode;
  sx?: SxInput;
}
export const Breadcrumbs = forwardRef<HTMLElement, BreadcrumbsProps>(function Breadcrumbs(
  { separator = "/", sx, style, children, ...rest },
  ref,
) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <nav ref={ref} aria-label="breadcrumb" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--color-ink-muted-48)", ...sxToStyle(sx), ...style }} {...rest}>
      {items.map((child, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: "var(--color-ink-muted-48)" }}>{separator}</span>}
          {child}
        </React.Fragment>
      ))}
    </nav>
  );
});
