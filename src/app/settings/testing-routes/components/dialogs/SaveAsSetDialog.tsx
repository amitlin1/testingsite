"use client";
import * as React from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@/components/ui";
import type { FieldSetJson } from "@/app/lib/station-fields/admin-types";
import type { Field } from "@/app/lib/station-fields/schema";
import { newFieldId } from "@/app/lib/station-fields/step-uids";
import { cellFieldsForSet } from "../../lib/applySetModel";
import { SAVE_AS_SET_COPY_PENDING } from "../../lib/applySetLabels";
import { createFieldSet } from "../../lib/useLibrary";
import "./apply-set-dialog.css";

/**
 * "שמור כערכה…" — the cell editor's ⋯ (route-fields spec §5.5.1). The dialog is not drawn (spec §10.4),
 * so all of its words are COPY-PENDING (applySetLabels.SAVE_AS_SET_COPY_PENDING): a name, then POST
 * /api/settings/field-sets { name, fields } with the cell's input fields (applySetModel.cellFieldsForSet:
 * no section headers, no from_set, ids of their own). The cell itself does not change and is not
 * linked to the new set. A failed POST keeps the dialog open with the library's pending "היצירה
 * נכשלה". Each opening starts from `defaultName`.
 */

export type SaveAsSetDialogProps = {
  open: boolean;
  /** The name the input starts with. */
  defaultName: string;
  /** The cell's fields (the working copy). */
  fields: readonly Field[];
  onClose: () => void;
  /** The set was created; the dialog has closed. */
  onSaved: (set: FieldSetJson) => void;
};

/** The name column holds 100 characters (libraryModel.copyName). */
const NAME_MAX = 100;

export default function SaveAsSetDialog(props: SaveAsSetDialogProps) {
  const { open } = props;
  const [session, setSession] = React.useState(0);
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((s) => s + 1);
  }
  return session > 0 ? <SaveSession key={session} {...props} /> : null;
}

function SaveSession({ open, defaultName, fields, onClose, onSaved }: SaveAsSetDialogProps) {
  const C = SAVE_AS_SET_COPY_PENDING;
  const [name, setName] = React.useState(defaultName.slice(0, NAME_MAX));
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const helpId = React.useId();
  const trimmed = name.trim();

  const save = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    setFailed(false);
    const r = await createFieldSet({ name: trimmed, fields: cellFieldsForSet(fields, () => newFieldId()) });
    setBusy(false);
    if (!r.ok) {
      setFailed(true);
      return;
    }
    onClose();
    onSaved(r.data);
  };

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth draggable={false} disableEscapeKeyDown={busy}>
      <DialogTitle onClose={close}>{C.title}</DialogTitle>
      <DialogContent>
        <form
          id={helpId + "-form"}
          className="rf-save-set"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextField
            autoFocus
            fullWidth
            label={C.nameLabel}
            value={name}
            maxLength={NAME_MAX}
            aria-describedby={helpId}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
          <p id={helpId} className="rf-save-set__help">{C.help}</p>
          {failed && <Alert severity="error">{C.failed}</Alert>}
        </form>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={close} disabled={busy}>{C.cancel}</Button>
        <Button type="submit" form={helpId + "-form"} loading={busy} disabled={!trimmed}>{C.confirm}</Button>
      </DialogActions>
    </Dialog>
  );
}
