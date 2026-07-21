"use client";
import React, { useLayoutEffect, useRef, useState } from "react";
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

const MARGIN = 12; // keep the menu this far from any viewport edge

export function Menu({ anchorEl, open, onClose, children, anchorOrigin, sx, MenuListProps, PaperProps }: MenuProps) {
  const listRef = useRef<HTMLUListElement>(null);
  // Physical coordinates — NOT logical inset-* — so RTL/LTR both behave.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorEl) return;

    const place = () => {
      const r = anchorEl.getBoundingClientRect();
      const vertical = anchorOrigin?.vertical ?? "bottom";
      const menu = listRef.current;
      const mw = menu?.offsetWidth ?? 200;
      const mh = menu?.offsetHeight ?? 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Center the menu under the anchor (keeps it right next to the icon), then
      // clamp horizontally. `right` is a PHYSICAL offset from the viewport's right
      // edge — NOT a logical inset-* — so RTL and LTR behave identically.
      const anchorCx = r.left + r.width / 2;
      let right = vw - anchorCx - mw / 2;
      right = Math.max(MARGIN, Math.min(right, vw - mw - MARGIN));

      // Open below the anchor; flip above if it would overflow the bottom.
      let top =
        vertical === "top" ? r.top : vertical === "center" ? r.top + r.height / 2 : r.bottom + 4;
      if (mh && top + mh > vh - MARGIN && r.top - 4 - mh > MARGIN) {
        top = r.top - 4 - mh;
      }
      top = Math.max(MARGIN, Math.min(top, vh - mh - MARGIN));

      setPos({ top, right });
    };

    place();
    // Re-measure once the menu has rendered (so width/height are known), and on
    // scroll/resize while it is open.
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorEl, anchorOrigin]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        onClick={(e) => { e.stopPropagation(); onClose?.(e, "backdropClick"); }}
        style={{ position: "fixed", inset: 0, zIndex: 1400 }}
      />
      <ul
        ref={listRef}
        role="menu"
        {...MenuListProps}
        className={cn("sh-menu-content", MenuListProps?.className)}
        style={{
          position: "fixed",
          top: pos?.top ?? -9999,
          right: pos?.right ?? 0,
          // hide until measured so it never flashes at the wrong spot
          visibility: pos ? "visible" : "hidden",
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
