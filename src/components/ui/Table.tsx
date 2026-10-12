"use client";
import React, { forwardRef } from "react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

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

/** Lets TableCell know which section it's in, so header cells render <th>. */
const TableSectionCtx = React.createContext<"head" | "body" | "foot">("body");

export const TableHead = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement> & { sx?: SxInput }>(
  function TableHead({ sx, style, children, ...rest }, ref) {
    return (
      <TableSectionCtx.Provider value="head">
        <thead ref={ref} style={{ ...sxToStyle(sx), ...style }} {...rest}>{children}</thead>
      </TableSectionCtx.Provider>
    );
  },
);

export const TableBody = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement> & { sx?: SxInput }>(
  function TableBody({ sx, style, children, ...rest }, ref) {
    return (
      <TableSectionCtx.Provider value="body">
        <tbody ref={ref} style={{ ...sxToStyle(sx), ...style }} {...rest}>{children}</tbody>
      </TableSectionCtx.Provider>
    );
  },
);

export const TableFooter = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement> & { sx?: SxInput }>(
  function TableFooter({ sx, style, children, ...rest }, ref) {
    return (
      <TableSectionCtx.Provider value="foot">
        <tfoot ref={ref} style={{ ...sxToStyle(sx), ...style }} {...rest}>{children}</tfoot>
      </TableSectionCtx.Provider>
    );
  },
);

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  hover?: boolean;
  selected?: boolean;
  sx?: SxInput;
}
export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow(
  { hover: _hover, selected, sx, style, className, children, ...rest },
  ref,
) {
  return (
    <tr
      ref={ref}
      className={className}
      // Every body row hovers (ui.css); selected rows get the blue tint there.
      aria-selected={selected || undefined}
      style={{ ...sxToStyle(sx), ...style }}
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
  { align, component, variant, padding, sortDirection, sx, style, children, ...rest },
  ref,
) {
  const section = React.useContext(TableSectionCtx);
  const Component = (component || (variant === "head" || section === "head" ? "th" : "td")) as React.ElementType;
  return (
    <Component
      ref={ref}
      aria-sort={sortDirection === "asc" ? "ascending" : sortDirection === "desc" ? "descending" : undefined}
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

export interface TableSortLabelProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  direction?: "asc" | "desc";
  sx?: SxInput;
}
/** A real button (keyboard + focus), with a drawn chevron. Put the direction on
 *  the header cell too (`<TableCell sortDirection>` → aria-sort). */
export function TableSortLabel({ active, direction = "asc", sx, style, children, ...rest }: TableSortLabelProps) {
  const Icon = !active ? ChevronsUpDown : direction === "asc" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      className="sh-sort-label"
      data-active={active || undefined}
      style={{ ...sxToStyle(sx), ...style }}
      {...rest}
    >
      {children}
      <Icon size={13} strokeWidth={2} aria-hidden style={{ opacity: active ? 1 : 0.45, flexShrink: 0 }} />
    </button>
  );
}
