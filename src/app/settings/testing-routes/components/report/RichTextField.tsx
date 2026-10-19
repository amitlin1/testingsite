"use client";

// Ported from ticketflow (src/components/form/RichTextField.tsx); variables come
// grouped (פרטי הפריט / each route's steps) instead of form fields.
//
// Inline WYSIWYG editor for a PDF text field. Select text → Bold / Italic /
// Underline / Size from the toolbar; insert a form variable from the dropdown
// (shown as a chip, not raw {{name}}). Serializes to the safe RichValue model
// on every change — no HTML is stored.

import * as React from "react";
import {
  htmlToRuns,
  runsToHtml,
  stringToRuns,
  isRichValue,
  type RichValue,
} from "@/app/lib/item-report/rich";
import type { ReportVar } from "@/app/lib/item-report/types";

// Font sizes in px (the editor applies the literal px to the selected text).
const PX_CHOICES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48];

export function RichTextField({
  value,
  onChange,
  variables,
  minHeight = 64,
}: {
  value: RichValue | string | undefined;
  onChange: (v: RichValue) => void;
  variables: ReportVar[];
  minHeight?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState({ b: false, i: false, u: false });
  const labels = React.useMemo(
    () =>
      Object.fromEntries(
        variables.map((f) => [f.name, f.label]),
      ),
    [variables],
  );

  // Sync the contenteditable from the incoming value — on mount AND whenever
  // the value changes while the editor is NOT focused (i.e. the user selected a
  // different block, so we must load THAT block's content). While focused we
  // never overwrite (would reset the caret mid-typing).
  const html = React.useMemo(() => {
    const runs = isRichValue(value) ? value : stringToRuns(String(value ?? ""));
    return runsToHtml(runs, labels);
  }, [value, labels]);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return; // typing — don't clobber
    if (el.innerHTML !== html) el.innerHTML = html;
  }, [html]);

  // Reflect the current selection's formatting on the B/I/U buttons.
  const refreshActive = React.useCallback(() => {
    const el = ref.current;
    if (!el || document.activeElement !== el) return;
    try {
      setActive({
        b: document.queryCommandState("bold"),
        i: document.queryCommandState("italic"),
        u: document.queryCommandState("underline"),
      });
    } catch {
      /* no-op */
    }
  }, []);
  React.useEffect(() => {
    document.addEventListener("selectionchange", refreshActive);
    return () => document.removeEventListener("selectionchange", refreshActive);
  }, [refreshActive]);

  const groups = React.useMemo(() => {
    const m = new Map<string, ReportVar[]>();
    for (const v of variables) {
      const g = m.get(v.group);
      if (g) g.push(v);
      else m.set(v.group, [v]);
    }
    return [...m.entries()];
  }, [variables]);

  const commit = React.useCallback(() => {
    if (ref.current) onChange(htmlToRuns(ref.current));
  }, [onChange]);

  function focusEditor() {
    ref.current?.focus();
  }

  function exec(cmd: "bold" | "italic" | "underline") {
    focusEditor();
    try {
      // Produce <b>/<i>/<u> tags (not CSS spans) so the serializer captures
      // them reliably; the serializer also reads inline styles as a fallback.
      document.execCommand("styleWithCSS", false, "false");
      document.execCommand(cmd);
    } catch {
      /* no-op */
    }
    commit();
    refreshActive();
  }

  function applySize(px: string) {
    focusEditor();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement("span");
    span.style.fontSize = px ? `${px}px` : "";
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      // re-select the styled content
      sel.removeAllRanges();
      const r2 = document.createRange();
      r2.selectNodeContents(span);
      sel.addRange(r2);
    } catch {
      /* selection crossed incompatible boundaries — ignore */
    }
    commit();
  }

  function insertVariable(name: string) {
    if (!name) return;
    focusEditor();
    const chip = document.createElement("span");
    chip.setAttribute("data-var", name);
    chip.contentEditable = "false";
    chip.className = "rte-chip";
    chip.textContent = labels[name] ?? name;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(chip);
      // caret after the chip (+ a space so typing continues normally)
      const space = document.createTextNode(" ");
      chip.after(space);
      range.setStartAfter(space);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      ref.current?.appendChild(chip);
    }
    commit();
  }

  return (
    <div className="rte">
      <div className="rte-toolbar">
        <button type="button" className={`rte-btn${active.b ? " is-on" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")} title="מודגש"><b>B</b></button>
        <button type="button" className={`rte-btn${active.i ? " is-on" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")} title="נטוי"><i>I</i></button>
        <button type="button" className={`rte-btn${active.u ? " is-on" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("underline")} title="קו תחתון"><u>U</u></button>
        <select
          className="rte-select"
          defaultValue=""
          title="גודל הטקסט המסומן (px)"
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            if (e.target.value) applySize(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">גודל (px)…</option>
          {PX_CHOICES.map((px) => (
            <option key={px} value={px}>{px}px</option>
          ))}
        </select>
        <select
          className="rte-select rte-select--var"
          defaultValue=""
          title="הוספת משתנה"
          disabled={variables.length === 0}
          onChange={(e) => {
            insertVariable(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">+ הוסף משתנה</option>
          {groups.map(([group, vars]) => (
            <optgroup key={group} label={group}>
              {vars.map((f) => (
                <option key={f.name} value={f.name}>{f.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div
        ref={ref}
        className="rte-area"
        contentEditable
        suppressContentEditableWarning
        dir="rtl"
        style={{ minHeight }}
        onInput={commit}
        onBlur={commit}
      />
    </div>
  );
}
