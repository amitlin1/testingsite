"use client";
import React, { forwardRef } from "react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";

export interface TableContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  component?: React.ElementType;
  sx?: SxInput;
}
export const TableContainer = forwardRef<HTMLDivElement, TableContainerProps>(function TableContainer(
  { component: Component = "div", sx, style, className, children, ...rest },
  ref,
) {
  return (
    <Component
      ref={ref}
      className={className}
      style={{ width: "100%", overflow: "auto", ...sxToStyle(sx), ...style }}
      {...rest}
    >
      {children}
    </Component>
  );
});

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  size?: "small" | "medium";
  stickyHeader?: boolean;
  sx?: SxInput;
}
export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  { size, stickyHeader, sx, style, className, children, ...rest },
  ref,
) {
  return (
    <table
      ref={ref}
      className={cn("sh-table", stickyHeader && "sh-table--sticky", size === "small" && "sh-table--sm", className)}
      style={{ ...sxToStyle(sx), ...style }}
      {...rest}
    >
      {children}
    </table>
  );
});

export const TableHead = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement> & { sx?: SxInput }>(
  function TableHead({ sx, style, children, ...rest }, ref) {
    return <thead ref={ref} style={{ ...sxToStyle(sx), ...style }} {...rest}>{children}</thead>;
  },
);

export const TableBody = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement> & { sx?: SxInput }>(
  function TableBody({ sx, style, children, ...rest }, ref) {
    return <tbody ref={ref} style={{ ...sxToStyle(sx), ...style }} {...rest}>{children}</tbody>;
  },
);

export const TableFooter = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement> & { sx?: SxInput }>(
  function TableFooter({ sx, style, children, ...rest }, ref) {
    return <tfoot ref={ref} style={{ ...sxToStyle(sx), ...style }} {...rest}>{children}</tfoot>;
  },
);

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  hover?: boolean;
  selected?: boolean;
  sx?: SxInput;
}
export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow(
  { hover, selected, sx, style, className, children, ...rest },
  ref,
) {
  return (
    <tr
      ref={ref}
      className={cn(hover && "sh-row-hover", className)}
      style={{ background: selected ? "var(--color-surface-pearl)" : undefined, ...sxToStyle(sx), ...style }}
      {...rest}
    >
      {children}
    </tr>
  );
});

type CellAlign = "inherit" | "left" | "center" | "right" | "justify" | "start" | "end";
export interface TableCellProps extends Omit<React.TdHTMLAttributes<HTMLTableCellElement>, "align"> {
  align?: CellAlign;
  component?: "td" | "th";
  variant?: "head" | "body" | "footer";
  padding?: "normal" | "none" | "checkbox";
  sortDirection?: unknown;
  sx?: SxInput;
}
export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(function TableCell(
  { align, component, variant, padding, sortDirection: _sd, sx, style, children, ...rest },
  ref,
) {
  const Component = (component || (variant === "head" ? "th" : "td")) as React.ElementType;
  return (
    <Component
      ref={ref}
      style={{
        textAlign: align && align !== "inherit" ? (align as React.CSSProperties["textAlign"]) : undefined,
        padding: padding === "none" ? 0 : undefined,
        ...sxToStyle(sx),
        ...style,
      }}
      {...rest}
    >
      {children}
    </Component>
  );
});

export interface TableSortLabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  active?: boolean;
  direction?: "asc" | "desc";
  sx?: SxInput;
}
export function TableSortLabel({ active, direction = "asc", sx, style, children, ...rest }: TableSortLabelProps) {
  return (
    <span
      role="button"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", color: active ? "var(--color-ink)" : "inherit", ...sxToStyle(sx), ...style }}
      {...rest}
    >
      {children}
      <span style={{ fontSize: 10, opacity: active ? 1 : 0.4 }}>{direction === "asc" ? "▲" : "▼"}</span>
    </span>
  );
}
