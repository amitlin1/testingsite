"use client";
import React from "react";
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from "./Dialog";
import { Button } from "./Button";
import { Warning, Info } from "./icons";

export interface ConfirmDialogProps {
  open: boolean;
  title: React.ReactNode;
  /** Body copy. Optional — a title alone is enough for simple questions. */
  message?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Paints the confirm button red and swaps in the warning glyph. */
  destructive?: boolean;
  /** Disables both buttons while the confirmed action is in flight. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * In-app replacement for window.confirm(). Same question, same two answers,
 * but rendered with the app's own dialog so it reads as part of the system
 * and works inside another dialog (Radix stacks the layers).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "אישור",
  cancelText = "ביטול",
  destructive,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const Icon = destructive ? Warning : Info;
  return (
    <Dialog open={open} onClose={() => { if (!busy) onCancel(); }} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.5, justifyContent: "flex-start" }}>
        <Icon color={destructive ? "error" : "primary"} />
        <span style={{ flex: 1, minWidth: 0 }}>{title}</span>
      </DialogTitle>
      {message != null && message !== "" && (
        <DialogContent>
          <DialogContentText>{message}</DialogContentText>
        </DialogContent>
      )}
      <DialogActions sx={{ justifyContent: "flex-start" }}>
        <Button
          variant="contained"
          color={destructive ? "error" : "primary"}
          onClick={onConfirm}
          disabled={busy}
          autoFocus
        >
          {confirmText}
        </Button>
        <Button variant="outlined" onClick={onCancel} disabled={busy}>
          {cancelText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ConfirmDialog;
