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
  return (
    <Dialog
      open={open}
      // ui/Dialog calls onClose once per close (Escape or a press outside; an
      // open combobox list keeps its Escape). Mid-save nothing closes it.
      onClose={() => { if (busy) return; onClose(); }}
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
