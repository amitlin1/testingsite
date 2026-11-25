"use client";
import React, { forwardRef } from "react";
import { sxToStyle, type SxInput } from "./sx";

export function ListItemIcon({ children, style, sx, ...rest }: React.HTMLAttributes<HTMLSpanElement> & { sx?: SxInput }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", minWidth: 32, color: "var(--color-ink-muted-48)", ...sxToStyle(sx), ...style }} {...rest}>
      {children}
    </span>
  );
}
/* ------------------------------------------------------------- Collapse -- */
export interface CollapseProps extends React.HTMLAttributes<HTMLDivElement> {
  in?: boolean;
  orientation?: "vertical" | "horizontal";
  unmountOnExit?: boolean;
  sx?: SxInput;
}
export const Collapse = forwardRef<HTMLDivElement, CollapseProps>(function Collapse(
  { in: open = false, orientation = "vertical", unmountOnExit, sx, style, children, ...rest },
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
        transition: "grid-template-rows var(--dur-slow) var(--ease-out), grid-template-columns var(--dur-slow) var(--ease-out)",
        ...sxToStyle(sx),
        ...style,
      }}
      {...rest}
    >
      <div style={{ overflow: "hidden", minHeight: 0, minWidth: 0 }}>{children}</div>
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
    <nav ref={ref} aria-label="נתיב ניווט" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--color-ink-muted-48)", ...sxToStyle(sx), ...style }} {...rest}>
      {items.map((child, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: "var(--color-ink-muted-48)" }}>{separator}</span>}
          {child}
        </React.Fragment>
      ))}
    </nav>
  );
});
