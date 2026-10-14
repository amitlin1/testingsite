"use client";
import * as React from "react";
import { ClipboardPaste, Library, X } from "lucide-react";
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from "@/components/ui";
import { currentConfigs } from "../../lib/draftModel";
import { useDraftStore } from "../../lib/draftStore";
import { DEFAULT_IDS } from "../../lib/editorModel";
import { applyAdditions, clearCells, copyCells, pasteSource, planInternalPaste, planTsvPaste } from "../../lib/bulkModel";
import type { BulkClipboard, PasteCounts, RouteEdit } from "../../lib/bulkModel";
import type { FieldsMapModel, MapCell } from "../../lib/mapModel";
import { useOptionLists } from "../../lib/useLibrary";
import { BULK_TEXT, selectedCellsText } from "../../lib/labels";
import { BULK_COPY_PENDING, PASTE_TSV_TEXT } from "../../lib/bulkLabels";

/**
 * The selection bar of the fields map (route-fields spec §5.4.4, §5.14; artboard 1), drawn under the
 * toolbar while at least one cell is selected: <div role="toolbar" aria-label="פעולות על התאים
 * שנבחרו">, min-height 48, tint, primary-border, radius 11, padding 6px 14px. In order:
 *   "תא אחד נבחר" / "{n} תאים נבחרו" (14/600)
 *   ghost "החל ערכת שדות…" (Library) — artboard 9's dialog; drawn only when the host gives
 *     `onApplySet`
 *   ghost "הדבק" (ClipboardPaste) with the "Ctrl V" hint (11px, LTR, hairline)
 *   ghost "העתק"
 *   ghost red "נקה"
 *   at the end, ghost "בטל בחירה" (X)
 * Artboard 1's outlined "עריכה משותפת" (PencilLine) is NOT drawn: spec §5.14 has no final artboard
 * for the shared editor ("ב-k/n" is spec-only, לא אומת), so it waits for one.
 * The arrows move between the bar's buttons (the toolbar pattern); Tab still reaches each one.
 *
 * Also here, shared with the editor's "הדבק מאקסל" (AddFieldBar): the system clipboard helpers, the
 * paste box for a clipboard the page may not read, and the map's actions on the drafts.
 */

export type FieldsMapBulkBarProps = {
  /** Selected cells. */
  count: number;
  /** "החל ערכת שדות…" (artboard 9's dialog, which the page hosts). Without it the button is not
   *  drawn. */
  onApplySet?: () => void;
  onPaste: () => void;
  onCopy: () => void;
  onClear: () => void;
  onDeselect: () => void;
};

/** Arrow keys between the toolbar's buttons, by the bar's direction; Home / End to the ends. */
function moveInToolbar(e: React.KeyboardEvent<HTMLDivElement>): void {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0 || buttons.length === 0) return;
  const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
  const forward = e.key === (rtl ? "ArrowLeft" : "ArrowRight");
  const to = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (at + (forward ? 1 : -1) + buttons.length) % buttons.length;
  e.preventDefault();
  buttons[to].focus();
}

export default function FieldsMapBulkBar({ count, onApplySet, onPaste, onCopy, onClear, onDeselect }: FieldsMapBulkBarProps) {
  return (
    <div role="toolbar" aria-label={BULK_TEXT.toolbarLabel} className="rf-bulk" onKeyDown={moveInToolbar}>
      <span className="rf-bulk__count">{selectedCellsText(count)}</span>
      {onApplySet && (
        <Button variant="text" size="small" className="rf-bulk__btn" startIcon={<Library size={16} strokeWidth={1.75} aria-hidden />} onClick={onApplySet}>
          {BULK_TEXT.applySet}
        </Button>
      )}
      <Button
        variant="text"
        size="small"
        className="rf-bulk__btn"
        aria-keyshortcuts="Control+V Meta+V"
        startIcon={<ClipboardPaste size={16} strokeWidth={1.75} aria-hidden />}
        onClick={onPaste}
      >
        {BULK_TEXT.paste}
        <span className="rf-bulk__key" dir="ltr" aria-hidden="true">{PASTE_TSV_TEXT.pasteKeys}</span>
      </Button>
      <Button variant="text" size="small" className="rf-bulk__btn" aria-keyshortcuts="Control+C Meta+C" onClick={onCopy}>
        {BULK_TEXT.copy}
      </Button>
      <Button variant="text" size="small" color="error" className="rf-bulk__btn" onClick={onClear}>
        {BULK_TEXT.clear}
      </Button>
      <Button
        variant="text"
        size="small"
        className="rf-bulk__btn rf-bulk__deselect"
        aria-keyshortcuts="Escape"
        startIcon={<X size={16} strokeWidth={1.75} aria-hidden />}
        onClick={onDeselect}
      >
        {BULK_TEXT.deselect}
      </Button>
    </div>
  );
}

// ---- the system clipboard ---------------------------------------------------------------------------
/** The system clipboard's text, or null when the page may not read it: no permission, or a page
 *  served over plain http — an insecure context, where the browser has no navigator.clipboard. */
export async function readClipboardText(): Promise<string | null> {
  try {
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clip || typeof clip.readText !== "function") return null;
    return await clip.readText();
  } catch {
    return null;
  }
}

/** The copy command with our text in it — the way to write the clipboard on plain http, inside a
 *  click (the page's own copy handlers see the event already handled). */
function copyCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  let done = false;
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
    done = true;
  };
  document.addEventListener("copy", onCopy, true);
  try {
    document.execCommand("copy");
  } catch {
    done = false;
  } finally {
    document.removeEventListener("copy", onCopy, true);
  }
  return done;
}

/** Writes text to the system clipboard; false when the browser refused it. */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clip && typeof clip.writeText === "function") {
      await clip.writeText(text);
      return true;
    }
  } catch {
    // Refused (no permission, the page lost focus): try the copy command.
  }
  return copyCommand(text);
}

// ---- the paste box (the clipboard cannot be read) -----------------------------------------------------
export type PasteTextDialogProps = {
  open: boolean;
  /** The dialog's title: the button that opened it ("הדבק מאקסל"), else COPY-PENDING "הדבקה". */
  title?: string;
  onCancel: () => void;
  /** The pasted (or typed) text. */
  onPaste: (text: string) => void;
};

/**
 * Where to paste when the page may not read the clipboard (spec §5.14 fallback — COPY-PENDING; no
 * artboard draws it): a box that takes Ctrl V — the paste event carries the text even on plain
 * http — and applies it at once; text typed into it goes with "הדבק".
 */
export function PasteTextDialog({ open, title, onCancel, onPaste }: PasteTextDialogProps) {
  const C = BULK_COPY_PENDING;
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

// ---- the internal clipboard ---------------------------------------------------------------------------
/** The last copy of the page (module level: it outlives the map while the editor is open). */
type ClipEntry = { clip: BulkClipboard; onSystem: boolean };
let clipEntry: ClipEntry | null = null;

/** The internal clipboard (tests reset it with null). */
export function getBulkClipboard(): ClipEntry | null {
  return clipEntry;
}
export function setBulkClipboard(next: ClipEntry | null): void {
  clipEntry = next;
}

// ---- the actions ------------------------------------------------------------------------------------------
export type BulkActions = {
  /** Keeps the cells' fields in the internal clipboard; null for no cells. */
  copy: (cells: readonly MapCell[]) => BulkClipboard | null;
  /** The clipboard's TSV reached the system clipboard. */
  markOnSystem: (clip: BulkClipboard) => void;
  /** Pastes into the cells (bulkModel.pasteSource picks the source); null when there is nothing to
   *  paste. `systemText` null = the system clipboard could not be read. */
  paste: (cells: readonly MapCell[], systemText: string | null) => PasteCounts | null;
  /** "נקה": the cells that had fields. */
  clear: (cells: readonly MapCell[]) => number;
};

/** The map's copy / paste / clear on the draft store — one store.edit per route touched. */
export function useBulkActions(model: FieldsMapModel): BulkActions {
  const store = useDraftStore();
  const lists = useOptionLists().data;
  return React.useMemo((): BulkActions => {
    const edit: RouteEdit = (routeId, mutate) => store.edit(routeId, mutate);
    return {
      copy(cells) {
        if (cells.length === 0) return null;
        const clip = copyCells(model, currentConfigs(store.getSnapshot().model), cells);
        setBulkClipboard({ clip, onSystem: false });
        return clip;
      },
      markOnSystem(clip) {
        if (clipEntry?.clip === clip) clipEntry = { clip, onSystem: true };
      },
      paste(cells, systemText) {
        if (cells.length === 0) return null;
        const src = pasteSource(clipEntry?.clip ?? null, systemText, clipEntry?.onSystem ?? false);
        if (src.kind === "empty") return null;
        if (src.kind === "internal") {
          const plan = planInternalPaste(model, src.clip, cells);
          return applyAdditions(edit, plan.additions, DEFAULT_IDS, plan.outside);
        }
        return applyAdditions(edit, planTsvPaste(src.rows, cells, lists));
      },
      clear(cells) {
        return clearCells(edit, cells);
      },
    };
  }, [store, model, lists]);
}
