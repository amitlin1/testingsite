"use client";
import React from "react";
import { X } from "lucide-react";
import { Dialog, DialogTitle } from "./Dialog";
import { cn } from "./utils";
import "./controls.css";

/**
 * The artboards' dialog frame (package dialogs, station wizards): ui/Dialog
 * (Radix — role="dialog" labelled by its title, focus trapped and given back,
 * Escape / backdrop close only the TOP dialog, a press that starts inside and
 * ends on the scrim closes nothing) dressed as the artboards' dialog
 * (--shadow-modal, radius 18, the sizes each caller passes).
 *
 * Stacking is Radix's: a dialog opened from another one is mounted later and
 * sits above it.
 */
export function ArtboardDialog({
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
      // An open combobox list keeps its Escape.
      onClose={() => { if (busy) return; onClose(); }}
      maxWidth={false}
      draggable={draggable}
      PaperProps={{
        className: cn("pkg-dlg", fullScreenBelow760 && "pkg-dlg--full", className),
        style: { width, maxWidth: "none", height, maxHeight },
      }}
    >
      {children}
    </Dialog>
  );
}

/** The header of every artboard dialog: its title, an optional line under it,
 *  the round × at the inline end. Moves the dialog. */
export function ArtboardDialogHeader({ title, subtitle, onClose }: { title: React.ReactNode; subtitle?: React.ReactNode; onClose?: () => void }) {
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
