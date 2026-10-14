"use client";
import * as React from "react";
import { Check, ChevronUp, Copy, Info, Library, Pencil, Trash2 } from "lucide-react";
import { Alert, Button, ConfirmDialog, IconButton, Tag } from "@/components/ui";
import { TONE_WORD } from "@/app/lib/station-fields/schema";
import type { FieldSetJson, OptionListJson } from "@/app/lib/station-fields/admin-types";
import { optionKey } from "../../lib/optionsModel";
import { OPTION_LIST_TEXT, optionKeyTitle } from "../../lib/labels";
import { failCount, setsUsingList, toneRows } from "../../lib/libraryModel";
import { withLibrary } from "../../lib/routeQuery";
import type { RouteQuery } from "../../lib/routeQuery";
import {
  LIBRARY_UNDRAWN_TEXT, LIBRARY_TEXT, LIST_DETAIL_TEXT, listAlertText, listDetailLabel, listMetaText,
  listOptionLabel, listOptionsTitle, listSummaryText, setUsesListText,
} from "../../lib/libraryLabels";
import { deleteOptionList, saveOptionList } from "../../lib/useLibrary";
import { RenameInput } from "./FieldSetEditor";

/**
 * "פרטי רשימה" — a shared option list in the library (artboard 8, spec §5.9 OptionListDetail):
 *   head      h2 with Pencil ("שינוי שם הרשימה": the name in place; a new name is a new version, PUT),
 *             Tag "רשימה משותפת"; "בשימוש ב-{N} שדות · {M} אפשרויות"; ghost "שכפל", red ghost "מחק"
 *             (confirm and 409 IN_USE: undrawn), outlined "עריכת האפשרויות" (artboard 4)
 *   options   "אפשרויות · {n}" + "המספר הוא מקש הבחירה המהירה בחלון העובד"; 36px chips: the mono key
 *             box ("1"–"4", then "–" as artboard 4), dot, label, tone word; "{n} אפשרויות · אחת נחשבת
 *             'כשל'"
 *   verdict   "איך כל אפשרות נספרת בפסק הדין": the four tones, each with its labels or "—", and the note
 *   worker    "כך העובד יראה את הרשימה": a static picture of the worker's list ("בחר…", the options with
 *             their key hints) — aria-hidden
 *   in sets   "בערכות שדות" + "לחיצה פותחת את הערכה": a chip per set with fields linked to the list;
 *             none: "אף ערכת שדות לא משתמשת ברשימה הזו. היא מקושרת ישירות לשדות במסלולים."
 *   note      role="note" "שינוי ברשימה המשותפת יחול על {N} שדות לאחר פרסום. …", and the footnote.
 */

export type OptionListDetailProps = {
  list: OptionListJson;
  sets: readonly FieldSetJson[];
  query: RouteQuery;
  onNavigate: (q: RouteQuery) => void;
  /** "עריכת האפשרויות": FieldLibrary opens artboard 4 against this button. */
  editRef: React.RefObject<HTMLButtonElement | null>;
  onEdit: () => void;
  editOpen: boolean;
  onDuplicate: () => Promise<void>;
  duplicating: boolean;
  reloadLists: () => Promise<boolean>;
};

type Notice = { text: string; reload: boolean };

export function OptionListDetail({
  list, sets, query, onNavigate, editRef, onEdit, editOpen, onDuplicate, duplicating, reloadLists,
}: OptionListDetailProps) {
  const [renaming, setRenaming] = React.useState(false);
  const [busy, setBusy] = React.useState<"rename" | "delete" | null>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const renameRef = React.useRef<HTMLButtonElement>(null);

  const fails = failCount(list.options);
  const inSets = setsUsingList(sets, list.id);

  const rename = async (next: string) => {
    setBusy("rename");
    setNotice(null);
    const r = await saveOptionList(list.id, { name: next, options: list.options, base_version: list.version });
    setBusy(null);
    if (r.ok) await reloadLists();
    else setNotice({ text: r.error.kind === "conflict" ? LIBRARY_UNDRAWN_TEXT.listConflict : LIBRARY_UNDRAWN_TEXT.saveFailed, reload: r.error.kind === "conflict" });
  };

  const remove = async () => {
    setConfirmDelete(false);
    setBusy("delete");
    setNotice(null);
    const r = await deleteOptionList(list.id);
    setBusy(null);
    if (r.ok) {
      await reloadLists();
      onNavigate(withLibrary(query, "lists", null));
    } else {
      setNotice({ text: r.error.kind === "in_use" ? LIBRARY_UNDRAWN_TEXT.listInUse : LIBRARY_UNDRAWN_TEXT.deleteFailed, reload: false });
    }
  };

  return (
    <section aria-label={listDetailLabel(list.name)} className="settings-card rf-lib-editor">
      <div className="rf-lib-head">
        <div className="rf-lib-head__titles">
          <div className="rf-lib-head__title-row">
            {renaming ? (
              <RenameInput
                label={LIBRARY_TEXT.renameList}
                value={list.name}
                onDone={(next) => {
                  setRenaming(false);
                  const name = next?.trim() ?? "";
                  if (name !== "" && name !== list.name) void rename(name);
                }}
                restoreFocus={() => renameRef.current?.focus()}
              />
            ) : (
              <>
                <h2 className="rf-lib-head__title">{list.name}</h2>
                <IconButton
                  ref={renameRef}
                  size="small"
                  className="rf-lib-head__rename"
                  aria-label={LIBRARY_TEXT.renameList}
                  onClick={() => setRenaming(true)}
                >
                  <Pencil size={16} strokeWidth={1.75} aria-hidden />
                </IconButton>
              </>
            )}
            <Tag tone="primary" size="md">{LIST_DETAIL_TEXT.sharedTag}</Tag>
          </div>
          <span className="rf-lib-head__meta">{listMetaText(list.usage.fields, list.options.length)}</span>
        </div>
        <div className="rf-lib-head__actions">
          <Button
            variant="text"
            className="rf-lib-ghost"
            loading={duplicating}
            startIcon={<Copy size={16} strokeWidth={1.75} aria-hidden />}
            onClick={() => void onDuplicate()}
          >
            {LIBRARY_TEXT.duplicate}
          </Button>
          <Button
            variant="text"
            color="error"
            className="rf-lib-ghost"
            loading={busy === "delete"}
            startIcon={<Trash2 size={16} strokeWidth={1.75} aria-hidden />}
            onClick={() => setConfirmDelete(true)}
          >
            {LIBRARY_TEXT.remove}
          </Button>
          <Button
            ref={editRef}
            variant="outlined"
            className="rf-lib-edit-options"
            aria-haspopup="dialog"
            aria-expanded={editOpen}
            startIcon={<Pencil size={16} strokeWidth={1.75} aria-hidden />}
            onClick={onEdit}
          >
            {LIST_DETAIL_TEXT.editOptions}
          </Button>
        </div>
      </div>

      {notice && (
        <Alert
          severity="error"
          action={notice.reload ? (
            <Button variant="text" size="small" color="inherit" onClick={() => { setNotice(null); void reloadLists(); }}>
              {LIBRARY_UNDRAWN_TEXT.conflictReload}
            </Button>
          ) : undefined}
        >
          {notice.text}
        </Alert>
      )}

      {/* the options and their keys */}
      <div className="rf-lib-fields">
        <div className="rf-lib-fields__head">
          <h3 className="rf-lib-fields__title">{listOptionsTitle(list.options.length)}</h3>
          <span className="rf-lib-fields__note">{LIST_DETAIL_TEXT.keysNote}</span>
        </div>
        <div role="list" aria-label={LIST_DETAIL_TEXT.optionsLabel} className="rf-lib-opts">
          {list.options.map((o, i) => {
            const key = optionKey(i) ?? OPTION_LIST_TEXT.noKey;
            return (
              <span key={o.id} role="listitem" title={TONE_WORD[o.tone]} aria-label={listOptionLabel(key, o.label, o.tone)} className="rf-lib-opt">
                <span className="rf-lib-opt__key" dir="ltr" title={optionKeyTitle(i)}>{key}</span>
                <span className="rf-tone-dot" data-tone={o.tone} />
                <span>{o.label}</span>
                <span className="rf-lib-opt__word">{TONE_WORD[o.tone]}</span>
              </span>
            );
          })}
        </div>
        <span className="rf-lib-summary">
          <Check size={14} strokeWidth={1.75} aria-hidden />
          {listSummaryText(list.options.length, fails)}
        </span>
      </div>

      <div className="rf-lib-cols">
        {/* how each option counts */}
        <div className="rf-lib-cols__verdict">
          <h3 className="rf-lib-fields__title">{LIST_DETAIL_TEXT.verdictTitle}</h3>
          <div className="rf-lib-tones">
            {toneRows(list.options).map((t) => (
              <div key={t.tone} className="rf-lib-tones__row">
                <span className="rf-lib-tones__word">
                  <span className="rf-tone-dot" data-tone={t.tone} />
                  {TONE_WORD[t.tone]}
                </span>
                <span className="rf-lib-tones__labels" data-empty={t.labels.length === 0 || undefined}>
                  {t.labels.length ? t.labels.join(" · ") : LIST_DETAIL_TEXT.noLabels}
                </span>
              </div>
            ))}
          </div>
          <span className="rf-lib-cols__note">{LIST_DETAIL_TEXT.verdictNote}</span>
        </div>

        {/* what the worker sees: a picture, not a control */}
        <div className="rf-lib-cols__worker">
          <h3 className="rf-lib-fields__title">{LIST_DETAIL_TEXT.workerTitle}</h3>
          <div className="rf-lib-mock" aria-hidden="true">
            <div className="rf-lib-mock__box">
              <span className="rf-lib-mock__ph">{LIST_DETAIL_TEXT.workerPlaceholder}</span>
              <ChevronUp size={16} strokeWidth={1.75} className="rf-lib-mock__chev" />
            </div>
            <div className="rf-lib-mock__list">
              {list.options.map((o, i) => {
                const key = optionKey(i);
                return (
                  <div key={o.id} className="rf-lib-mock__row" data-first={i === 0 || undefined}>
                    <span className="rf-tone-dot" data-tone={o.tone} />
                    <span className="rf-lib-mock__label">{o.label}</span>
                    {key && <span className="rf-lib-mock__key" dir="ltr">{key}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* in field sets */}
      <div className="rf-lib-block">
        <div className="rf-lib-block__head">
          <Library size={16} strokeWidth={1.75} className="rf-lib-block__icon" aria-hidden />
          <span className="rf-lib-block__title">{LIST_DETAIL_TEXT.inSetsTitle}</span>
          <span className="rf-lib-block__hint">{LIST_DETAIL_TEXT.inSetsHint}</span>
        </div>
        {inSets.length > 0 ? (
          <div className="rf-lib-chips">
            {inSets.map((s) => (
              <button key={s.id} type="button" className="rf-lib-chip rf-lib-chip--set" onClick={() => onNavigate(withLibrary(query, "sets", s.id))}>
                <span className="rf-lib-chip__name">{s.name}</span>
                <span className="rf-lib-chip__line">{setUsesListText(s.count)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="rf-lib-block__para">{LIST_DETAIL_TEXT.inSetsNone}</p>
        )}
      </div>

      <div role="note" className="rf-lib-note">
        <Info size={18} strokeWidth={1.75} className="rf-lib-note__icon" aria-hidden />
        <span>{listAlertText(list.usage.fields)}</span>
      </div>

      <div className="rf-lib-foot">{LIST_DETAIL_TEXT.footnote}</div>

      <ConfirmDialog
        open={confirmDelete}
        title={LIBRARY_UNDRAWN_TEXT.deleteListTitle}
        message={LIBRARY_UNDRAWN_TEXT.deleteListMessage}
        confirmText={LIBRARY_TEXT.remove}
        destructive
        draggable={false}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
    </section>
  );
}

export default OptionListDetail;
