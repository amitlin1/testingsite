"use client";
import React, { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";

export interface MenuProps {
  anchorEl?: HTMLElement | null;
  open: boolean;
  onClose?: (event: unknown, reason?: "backdropClick" | "escapeKeyDown" | "tabKeyDown") => void;
  children?: React.ReactNode;
  anchorOrigin?: { vertical: "top" | "center" | "bottom"; horizontal: "left" | "center" | "right" };
  transformOrigin?: { vertical: "top" | "center" | "bottom"; horizontal: "left" | "center" | "right" };
  keepMounted?: boolean;
  marginThreshold?: number;
  disableScrollLock?: boolean;
  sx?: SxInput;
  MenuListProps?: React.HTMLAttributes<HTMLUListElement>;
  PaperProps?: { sx?: SxInput; style?: React.CSSProperties };
  slotProps?: { paper?: { sx?: SxInput; style?: React.CSSProperties } };
}

export function Menu({ anchorEl, open, onClose, children, anchorOrigin, sx, MenuListProps, PaperProps }: MenuProps) {
  const [pos, setPos] = useState<{ top: number; insetInlineEnd?: number; insetInlineStart?: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const vertical = anchorOrigin?.vertical ?? "bottom";
    const top = vertical === "top" ? r.top : vertical === "center" ? r.top + r.height / 2 : r.bottom + 4;
    // Right-align the menu to the anchor (natural for RTL).
    setPos({ top, insetInlineEnd: window.innerWidth - r.right });
  }, [open, anchorEl, anchorOrigin]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        onClick={(e) => { e.stopPropagation(); onClose?.(e, "backdropClick"); }}
        style={{ position: "fixed", inset: 0, zIndex: 1400 }}
      />
      <ul
        role="menu"
        {...MenuListProps}
        className={cn("sh-menu-content", MenuListProps?.className)}
        style={{
          position: "fixed",
          top: pos?.top ?? 0,
          insetInlineEnd: pos?.insetInlineEnd,
          zIndex: 1401,
          listStyle: "none",
          margin: 0,
          ...sxToStyle(sx),
          ...sxToStyle(PaperProps?.sx),
          ...PaperProps?.style,
        }}
        onKeyDown={(e) => { if (e.key === "Escape") onClose?.(e, "escapeKeyDown"); }}
      >
        {children}
      </ul>
    </>,
    document.body,
  );
}
