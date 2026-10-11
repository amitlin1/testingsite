"use client";
import React from "react";
import { X } from "lucide-react";
import { Dialog, DialogTitle, cn } from "@/components/ui";
import "@/app/packages/packages.css";

/**
 * The frame every package dialog and station wizard sits in: ui/Dialog
 * (Radix — role="dialog" labelled by its title, focus trapped and given back,
 * Escape / backdrop close only the TOP dialog, a press that starts inside and
 * ends on the scrim closes nothing) dressed as the artboards' dialog
 * (--shadow-modal, radius 18, the sizes each caller passes).
 *
 * Stacking is Radix's: a dialog opened from another one is mounted later and
 * sits above it, so the old DIALOG_Z ladder is gone.
 */
export function PackageDialog({
  open, onClose, busy, width, height, maxHeight = "92vh", fullScreenBelow760, draggable = true, className, children,
}: {
  open: boolean;
  onClose: () => void;
  /** Mid-save: Escape and the backdrop leave the dialog open. */
  busy?: boolean;
  width: string;
  height?: string;
  maxHeight?: string;
  /** Rail dialogs (intake, wizards) fill the screen at ≤760px, per the artboard. */
  fullScreenBelow760?: boolean;
  /** Moved by any `data-drag-handle` inside. Confirmations pass false. */
  draggable?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  // An open combobox list owns Escape (it closes only the list). Radix closes
  // the top dialog from a document-level capture listener — before the
  // field's own handler — so mark the key as handled one level up first.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.getAttribute("role") === "combobox" && el.getAttribute("aria-expanded") === "true") e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <Dialog
      open={open}
      // ui/Dialog reports a backdrop press twice (pointer-down-outside, then
      // the close itself); act on the close only, so a handler that commits
      // or releases something (the wizard releases the box) runs once.
      onClose={(_e, reason) => { if (reason === "backdropClick" || busy) return; onClose(); }}
      maxWidth={false}
      draggable={draggable}
      slotProps={{
        paper: {
          className: cn("pkg-dlg", fullScreenBelow760 && "pkg-dlg--full", className),
          style: { width, maxWidth: "none", height, maxHeight },
        },
      }}
    >
      {children}
    </Dialog>
  );
}

/** Title (the one DialogTitle) + optional line under it + the round × at the
 *  inline end — the header of every artboard dialog. Moves the dialog. */
export function PackageDialogHeader({ title, subtitle, onClose }: { title: React.ReactNode; subtitle?: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="pkg-dlg-head" data-drag-handle="">
      <div style={{ minWidth: 0 }}>
        <DialogTitle style={{ padding: 0, display: "block" }}>{title}</DialogTitle>
        {subtitle}
      </div>
      {onClose && (
        <button type="button" className="pkg-dlg-x" aria-label="סגירה" onClick={onClose}>
          <X size={18} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </div>
  );
}
