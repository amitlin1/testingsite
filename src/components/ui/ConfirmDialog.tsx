"use client";
import React, { useId, useState } from "react";
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from "./Dialog";
import { Button } from "./Button";
import { TextField } from "./TextField";
import FieldLabel from "./FieldLabel";
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
  /** Moved by its title like other dialogs. Default: a destructive question stays put, any other moves. */
  draggable?: boolean;
  /** Type-to-confirm: the confirm button stays disabled until this text is typed
   *  (spaces around it and letter case aside) — for an action that cannot be undone. */
  confirmPhrase?: string;
  /** What the type-to-confirm field asks for. Default: type the phrase. */
  confirmPhraseLabel?: React.ReactNode;
}

const samePhrase = (typed: string, phrase: string) => typed.trim().toLowerCase() === phrase.trim().toLowerCase();

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
  draggable = !destructive,
  confirmPhrase,
  confirmPhraseLabel,
}: ConfirmDialogProps) {
  const Icon = destructive ? Warning : Info;
  const phraseId = useId();
  // Every opening starts with the field empty.
  const [typed, setTyped] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setTyped("");
  }
  const confirmed = confirmPhrase == null || samePhrase(typed, confirmPhrase);
  return (
    <Dialog open={open} onClose={() => { if (!busy) onCancel(); }} maxWidth="xs" fullWidth draggable={draggable}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.5, justifyContent: "flex-start" }}>
        <Icon color={destructive ? "error" : "primary"} />
        <span style={{ flex: 1, minWidth: 0 }}>{title}</span>
      </DialogTitle>
      {((message != null && message !== "") || confirmPhrase != null) && (
        <DialogContent>
          {message != null && message !== "" && <DialogContentText>{message}</DialogContentText>}
          {confirmPhrase != null && (
            <div style={{ marginTop: message ? "var(--space-md)" : 0 }}>
              <FieldLabel htmlFor={phraseId}>
                {confirmPhraseLabel ?? <>להמשך יש להקליד <strong>{confirmPhrase}</strong></>}
              </FieldLabel>
              <TextField
                id={phraseId}
                fullWidth
                size="small"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && confirmed && !busy) onConfirm(); }}
                placeholder={confirmPhrase}
                autoComplete="off"
                // A code reads left to right; aligned with the Hebrew around it.
                inputProps={{ dir: "ltr", style: { textAlign: "right" } }}
              />
            </div>
          )}
        </DialogContent>
      )}
      {/* Cancel first, the action last (DialogActions). A destructive
          question starts on Cancel, so Enter never deletes by reflex. */}
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onCancel} disabled={busy} autoFocus={destructive}>
          {cancelText}
        </Button>
        <Button
          variant="contained"
          color={destructive ? "error" : "primary"}
          onClick={onConfirm}
          disabled={!confirmed}
          loading={busy}
          autoFocus={!destructive}
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ConfirmDialog;
