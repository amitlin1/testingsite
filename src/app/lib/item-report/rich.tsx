// Ported verbatim from ticketflow (src/lib/pdf/rich.tsx).
// Rich-text model — a SAFE structured representation of styled inline text.
//
// We deliberately do NOT store editor HTML (which would be an injection risk
// when Chromium renders it). Instead the editor serializes its contenteditable
// DOM into this model: a flat list of runs, each either a styled text run or a
// variable reference. Rendering builds plain React from it — no dangerouslySet
// HTML, no sanitization needed.
//
// `renderRichModel` is server-safe. `runsToHtml`/`htmlToRuns` touch the DOM and
// must only run in the browser (the RichTextField editor).

import * as React from "react";

export type TextRun = {
  text: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  /** Literal CSS font-size for this run, e.g. "14px". */
  size?: string;
};
export type VarRun = { v: string }; // form field name
export type RichRun = TextRun | VarRun;
export type RichValue = RichRun[];

export function isVarRun(r: RichRun): r is VarRun {
  return (r as VarRun).v !== undefined;
}
export function isRichValue(v: unknown): v is RichValue {
  return Array.isArray(v);
}

/** Render a rich model to React (server-safe). Variable runs resolve against
 *  `values`; an absent value renders a blank underline. */
export function renderRichModel(
  runs: RichValue,
  values: Record<string, string>,
): React.ReactNode[] {
  return runs.map((r, i) => {
    if (isVarRun(r)) {
      // A variable always renders as a fill-in field (value on an underline).
      const val = values[r.v];
      return (
        <span key={i} className="pdf-fill">
          {val != null && val !== "" ? <bdi>{val}</bdi> : null}
        </span>
      );
    }
    const style: React.CSSProperties = {
      fontWeight: r.b ? 700 : undefined,
      fontStyle: r.i ? "italic" : undefined,
      textDecoration: r.u ? "underline" : undefined,
      fontSize: r.size || undefined,
    };
    const hasStyle = r.b || r.i || r.u || r.size;
    return hasStyle ? (
      <span key={i} style={style}>
        {r.text}
      </span>
    ) : (
      <React.Fragment key={i}>{r.text}</React.Fragment>
    );
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Model → HTML, to initialize the contenteditable. `labels` maps a field
 *  name to the chip caption shown in the editor. */
export function runsToHtml(runs: RichValue, labels: Record<string, string>): string {
  if (!Array.isArray(runs)) return "";
  return runs
    .map((r) => {
      if (isVarRun(r)) {
        const cap = labels[r.v] ?? r.v;
        return `<span data-var="${esc(r.v)}" contenteditable="false" class="rte-chip">${esc(cap)}</span>`;
      }
      let t = esc(r.text).replace(/\n/g, "<br>");
      if (r.size) t = `<span style="font-size:${r.size}">${t}</span>`;
      if (r.u) t = `<u>${t}</u>`;
      if (r.i) t = `<em>${t}</em>`;
      if (r.b) t = `<strong>${t}</strong>`;
      return t;
    })
    .join("");
}

/** Plain string → a single-run model (for migrating legacy textarea content). */
export function stringToRuns(s: string): RichValue {
  return s ? [{ text: s }] : [];
}

interface Marks {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  size?: string;
}

/** contenteditable DOM → model. Browser-only. */
export function htmlToRuns(root: HTMLElement): RichValue {
  const runs: RichValue = [];
  const walk = (node: Node, marks: Marks): void => {
    node.childNodes.forEach((ch) => {
      if (ch.nodeType === Node.TEXT_NODE) {
        const text = ch.nodeValue ?? "";
        if (text) runs.push({ text, ...marks });
        return;
      }
      if (ch.nodeType !== Node.ELEMENT_NODE) return;
      const el = ch as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const varName = el.getAttribute("data-var");
      if (varName) {
        runs.push({ v: varName });
        return;
      }
      if (tag === "br") {
        runs.push({ text: "\n", ...marks });
        return;
      }
      const m: Marks = { ...marks };
      // Marks from tags…
      if (tag === "strong" || tag === "b") m.b = true;
      if (tag === "em" || tag === "i") m.i = true;
      if (tag === "u") m.u = true;
      // …and from inline styles (execCommand with styleWithCSS, or pasted
      // content, applies these as CSS rather than tags).
      const st = el.style;
      if (st) {
        const fw = st.fontWeight;
        if (fw === "bold" || fw === "bolder" || Number(fw) >= 600) m.b = true;
        if (st.fontStyle === "italic" || st.fontStyle === "oblique") m.i = true;
        const dec = `${st.textDecoration || ""} ${st.textDecorationLine || ""}`;
        if (dec.includes("underline")) m.u = true;
        if (st.fontSize) m.size = st.fontSize; // literal px (e.g. "14px")
      }
      walk(el, m);
      if (tag === "div" || tag === "p") runs.push({ text: "\n", ...marks });
    });
  };
  walk(root, {});
  // Trim a single trailing newline introduced by the last block element.
  const last = runs[runs.length - 1];
  if (last && !isVarRun(last) && last.text === "\n") runs.pop();
  return runs.filter((r) => isVarRun(r) || r.text !== "");
}
