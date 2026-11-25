"use client";
import * as React from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from "@/components/ui";
import { BULK_UNDRAWN_TEXT } from "../../lib/bulkLabels";

export type PasteTextDialogProps = {
  open: boolean;
  /** The dialog's title: the button that opened it ("הדבק מאקסל"), else undrawn "הדבקה". */
  title?: string;
  onCancel: () => void;
  /** The pasted (or typed) text. */
  onPaste: (text: string) => void;
};

/**
 * Where to paste when the page may not read the clipboard (spec §5.14 fallback — undrawn; no
 * artboard draws it): a box that takes Ctrl V — the paste event carries the text even on plain
 * http — and applies it at once; text typed into it goes with "הדבק".
 */
export function PasteTextDialog({ open, title, onCancel, onPaste }: PasteTextDialogProps) {
  const C = BULK_UNDRAWN_TEXT;
  const [text, setText] = React.useState("");
  const helpId = React.useId();
  const done = (t: string | null) => {
    setText("");
    if (t == null) onCancel();
    else onPaste(t);
  };
  return (
    <Dialog open={open} onClose={() => done(null)} maxWidth="sm" fullWidth draggable={false}>
      <DialogTitle onClose={() => done(null)}>{title ?? C.pasteBoxTitle}</DialogTitle>
      <DialogContent>
        <DialogContentText id={helpId}>{C.pasteBoxHelp}</DialogContentText>
        <TextField
          multiline
          rows={6}
          fullWidth
          autoFocus
          label={C.pasteBoxLabel}
          value={text}
          aria-describedby={helpId}
          containerClassName="rf-paste-box"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text/plain");
            if (!pasted) return;
            e.preventDefault();
            done(pasted);
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={() => done(null)}>{C.pasteBoxCancel}</Button>
        <Button onClick={() => done(text)} disabled={!text.trim()}>{C.pasteBoxConfirm}</Button>
      </DialogActions>
    </Dialog>
  );
}
