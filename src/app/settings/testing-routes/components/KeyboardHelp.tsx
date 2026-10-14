"use client";
import * as React from "react";
import { CircleHelp } from "lucide-react";
import { AnchoredPopover, IconButton } from "@/components/ui";
import { CONTEXT_CARD_TEXT, MAP_HINT_TEXT } from "../lib/labels";

/**
 * The context card's "?" (aria-label "קיצורי מקלדת", artboards 1, 2, 11) and the popover it opens:
 * the screen's keyboard shortcuts (route-fields spec §5.16), each in the wording the artboards
 * print it. A shortcut no artboard words (space / Escape on the map, Escape in a popover) is left
 * out rather than given invented text.
 */

/** Spec §5.16, in the artboards' own words. */
const SHORTCUTS: readonly string[] = [
  // Artboard 1, the map footer: "חיצים לניווט · Shift לבחירת טווח · Enter לעריכה · Ctrl C / Ctrl V".
  ...MAP_HINT_TEXT.keys.split(" · "),
  // Artboard 2, the editor card's footer (`footLabel`).
  "גרירה או Alt+חיצים לשינוי סדר",
  // Artboard 3, the editor's tip ("טיפ: Enter בשם השדה האחרון מוסיף שורת בדיקה חדשה").
  "Enter בשם השדה האחרון מוסיף שורת בדיקה חדשה",
  // Artboard 4, the option list: the add field's placeholder and the quick-pick hint.
  "הוסף אפשרות (Enter)",
  "מקשים 1–4 לבחירה מהירה בעמדה",
];

/** A key name or a key range inside a Hebrew line: "Shift", "Ctrl C / Ctrl V", "Alt+", "1–4". */
const KEY_RUN = /[A-Za-z][A-Za-z0-9 /]*[A-Za-z]\+?|[A-Za-z]\+?|[0-9]+–[0-9]+/g;

/** The line with each key run isolated left-to-right as a key cap. */
function lineWithKeys(line: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(KEY_RUN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(line.slice(last, at));
    out.push(<kbd key={at} className="rf-kbd" dir="ltr">{m[0]}</kbd>);
    last = at + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export default function KeyboardHelp() {
  const [open, setOpen] = React.useState(false);
  const titleId = React.useId();
  return (
    <AnchoredPopover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      aria-labelledby={titleId}
      className="rf-kbd-popover"
      trigger={
        <IconButton aria-label={CONTEXT_CARD_TEXT.shortcuts} className="rf-help-btn">
          <CircleHelp size={20} strokeWidth={1.75} aria-hidden />
        </IconButton>
      }
    >
      <div dir="rtl">
        <h2 id={titleId} className="rf-kbd-popover__title">{CONTEXT_CARD_TEXT.shortcuts}</h2>
        <ul className="rf-kbd-popover__list">
          {SHORTCUTS.map((line) => (
            <li key={line}>{lineWithKeys(line)}</li>
          ))}
        </ul>
      </div>
    </AnchoredPopover>
  );
}
