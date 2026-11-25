// Puck configuration — the item-report document components.
//
// Ported from ticketflow (src/lib/pdf/puck-config.tsx). SINGLE source of truth
// for how a report template prints: the server renderer (render-react, a
// custom tree walk) and the editor canvas (ReportCanvas) both call these
// renders. Every component is isomorphic (renders under renderToStaticMarkup,
// no browser APIs) and styled with the shared classes in `pdf-styles`, so the
// editor canvas matches the PDF. What the editor lets the author set — the
// fields, their options and summaries — is the editor's
// (components/item-report/editorConfig.tsx).
//
// LAYOUT — "drag into the same row": every block carries a `width` (absolute
// mm fraction of the A4 content width). The drop zone is a flex-wrap row, so
// two half-width blocks dropped next to each other sit on one row.
//
// DATA BINDING — text accepts variables (rich-text chips, or legacy
// `{{name}}` tokens) replaced at render by `metadata.values[name]`: the item's
// own details (item.*), each station step the item passed (step.<uid>.*) and
// each field the worker filled there (field.<uid>.<fieldId>). See
// variables.ts. Testingsite additions over ticketflow: the results table, a
// step's fields table and a step's photos — blocks that print whatever the
// item actually went through, without placing every field by hand.

import * as React from "react";
import type { Config } from "@measured/puck";
import { FillValue, renderRichModel, isRichValue, type RichValue } from "./rich";
import type { ReportRenderMeta, ReportSignerInfo, ReportStepResult, ReportTone, SignCell } from "./types";
import { CLOSING_SIGNATURE_BIND, FINAL_SIGNATURE_BIND, REPORT_TONE_WORD, signCellsOf } from "./types";
import { PASS_FAIL_WORD } from "@/app/lib/station-fields/labels";
import { REPORT_FONTS, fontOf } from "./fonts";
import { DEFAULT_ROOT_PROPS, WIDTH_MM, logoUrl, type HeaderSettings, type RootProps } from "./document";

/** The page's font, as the --pdf-font the stylesheet reads. */
export function pageFontStyle(font: unknown): React.CSSProperties {
  return { ["--pdf-font" as string]: REPORT_FONTS[fontOf(font)].stack } as React.CSSProperties;
}

const DEFAULT_META: ReportRenderMeta = {
  mode: "edit",
  vars: [],
  steps: [],
  values: {},
  results: [],
  photos: {},
  signatures: {},
  signerMeta: {},
  logos: {},
};

function readMeta(puck: { metadata?: Record<string, unknown> } | undefined): ReportRenderMeta {
  return { ...DEFAULT_META, ...((puck?.metadata as Partial<ReportRenderMeta>) ?? {}) };
}

const TOKEN_RE = /\{\{\s*([\w.\- ]+?)\s*\}\}/g;
// inline markdown: **bold**, __underline__, *italic*
const INLINE_RE = /(\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*)/;

function parseInline(text: string, kb: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(rest)) !== null) {
    if (m.index > 0) out.push(rest.slice(0, m.index));
    if (m[2] != null) out.push(<strong key={`${kb}b${k++}`}>{m[2]}</strong>);
    else if (m[3] != null) out.push(<u key={`${kb}u${k++}`}>{m[3]}</u>);
    else if (m[4] != null) out.push(<em key={`${kb}i${k++}`}>{m[4]}</em>);
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Render text with {{name}} tokens AND inline markdown. A present value
 * renders in <bdi> (numbers/Latin keep direction); an absent one renders a
 * blank underline — the fill-in-the-blank look.
 */
function renderRich(text: string, values: Record<string, string>): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) {
      out.push(...parseInline(text.slice(last, m.index), `t${key}`));
    }
    out.push(<FillValue key={`f${key++}`} value={values[m[1] ?? ""]} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...parseInline(text.slice(last), `t${key}`));
  return out;
}

/** A text value: a rich model (from the WYSIWYG editor) or a plain string (markdown + {{tokens}}). */
function renderText(
  content: string | RichValue | undefined,
  values: Record<string, string>,
): React.ReactNode {
  return isRichValue(content)
    ? renderRichModel(content, values)
    : renderRich(String(content ?? ""), values);
}

function VerdictChip({ verdict }: { verdict: "pass" | "fail" | null }) {
  if (!verdict) return <span className="pdf-chip pdf-chip--none">—</span>;
  return (
    <span className={`pdf-chip pdf-chip--${verdict}`}>
      {verdict === "pass" ? "✓" : "✕"} {PASS_FAIL_WORD[verdict]}
    </span>
  );
}

function ToneMark({ tone }: { tone: ReportTone | null }) {
  if (!tone || tone === "neutral") return null;
  return <span className={`pdf-chip pdf-chip--${tone}`}>{tone === "pass" ? "✓" : tone === "fail" ? "✕" : "!"} {REPORT_TONE_WORD[tone]}</span>;
}

/** The signer's identity fields a Signature cell can print (types.ts SignCell). */
export const SIGNER_ATTRS: { suffix: keyof ReportSignerInfo; label: string }[] = [
  { suffix: "fullName", label: "שם מלא" },
  { suffix: "number", label: "מספר עובד" },
  { suffix: "date", label: "תאריך" },
  { suffix: "station", label: "עמדה" },
  // The closing signer's role ("בודק" / "מנהל"), kept when they signed.
  { suffix: "role", label: "תפקיד החותם" },
];

export const ATTR_LABELS: Record<string, string> = Object.fromEntries(
  SIGNER_ATTRS.map((a) => [a.suffix, a.label]),
);

function signerAttr(info: ReportSignerInfo | undefined, suffix: string): string {
  if (!info) return "";
  return (info as unknown as Record<string, string | undefined>)[suffix] ?? "";
}

// Human-readable "who signs here" for the editor canvas.
function signerLabel(bind: string, meta: ReportRenderMeta): string {
  if (bind === FINAL_SIGNATURE_BIND) return "חתימת מאשר הדוח (סופית)";
  if (bind === CLOSING_SIGNATURE_BIND) return "חתימת החותם בסגירת המארז";
  const step = /^step:(.+)$/.exec(bind);
  if (step) {
    const s = meta.steps.find((x) => x.uid === step[1]);
    return s ? `העובד · ${s.label}` : "העובד בעמדה";
  }
  return "בחר/י חותם במאפיינים";
}

function Block({
  width,
  className,
  style,
  children,
}: {
  width?: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`pdf-block ${className ?? ""}`}
      style={{ width: WIDTH_MM[width ?? "full"] ?? WIDTH_MM.full, boxSizing: "border-box", ...style }}
    >
      {children}
    </div>
  );
}

// Document-level header band (NOT a draggable block — rendered by the root
// from the document settings). Exported so the editor's multi-sheet canvas can
// render the same header on page 1.
export function HeaderBand({
  h,
  meta,
}: {
  h: Partial<HeaderSettings>;
  meta: ReportRenderMeta;
}) {
  // In print every logo is a data URL (meta.logos); in the editor, its URL.
  const logo = (key: string | undefined) => (key ? meta.logos[key] || logoUrl(key) : null);
  const right = logo(h.rightLogo);
  const left = logo(h.leftLogo);
  // Header texts are plain strings ({{tokens}}) or rich values (the editor's chips).
  const has = (v: string | RichValue | undefined): v is string | RichValue =>
    Array.isArray(v) ? v.length > 0 : !!v;
  const cR = h.cornerRight;
  const cC = h.cornerCenter;
  const cL = h.cornerLeft;
  // The official letterhead (מסמך רשמי): emblems either side of the issuing
  // body's lines, a double rule, the document's particulars on the left
  // (מספר / תאריך / סימוכין), then the title — bold, centred, underlined.
  return (
    <div className="pdf-headerband">
      {has(cR) || has(cC) || has(cL) ? (
        <div className="pdf-corner">
          <div className="pdf-corner__cell pdf-corner__cell--right">{has(cR) ? <bdi>{renderText(cR, meta.values)}</bdi> : null}</div>
          <div className="pdf-corner__cell pdf-corner__cell--center">{has(cC) ? <bdi>{renderText(cC, meta.values)}</bdi> : null}</div>
          <div className="pdf-corner__cell pdf-corner__cell--left">{has(cL) ? <bdi>{renderText(cL, meta.values)}</bdi> : null}</div>
        </div>
      ) : null}
      <div className="pdf-header">
        <div className="pdf-header__side pdf-header__side--right">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {right ? <img className="pdf-header__logo" src={right} alt="" /> : null}
        </div>
        <div className="pdf-header__center">
          {has(h.org) ? <div className="pdf-org">{renderText(h.org, meta.values)}</div> : null}
        </div>
        <div className="pdf-header__side pdf-header__side--left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {left ? <img className="pdf-header__logo" src={left} alt="" /> : null}
        </div>
      </div>
      <div className="pdf-rule" aria-hidden="true" />
      {has(h.meta) ? <div className="pdf-docmeta">{renderText(h.meta, meta.values)}</div> : null}
      {has(h.title) ? <div className="pdf-title">{renderText(h.title, meta.values)}</div> : null}
      {has(h.subtitle) ? <div className="pdf-subtitle">{renderText(h.subtitle, meta.values)}</div> : null}
    </div>
  );
}

/** The results to print for a step-bound block: the real ones in print; in the
 *  editor a placeholder per configured step, so the layout is visible; in the
 *  preview without an item, sample stations (the general template's canvas). */
function resultsFor(meta: ReportRenderMeta, uid: string): ReportStepResult[] {
  const all = meta.mode === "edit" ? sampleResults(meta) : meta.sample && meta.results.length === 0 ? GENERAL_SAMPLE : meta.results;
  return uid ? all.filter((r) => r.uid === uid) : all;
}

function sampleResults(meta: ReportRenderMeta): ReportStepResult[] {
  return meta.steps.map((s, i) => ({
    uid: s.uid,
    position: i + 1,
    stationType: s.label,
    station: "עמדה",
    worker: "שם העובד",
    workerNumber: "",
    date: "dd.mm.yyyy",
    time: "hh:mm",
    verdict: null,
    result: null,
    comments: "",
    fields: s.fields
      .filter((f) => f.type !== "section")
      .map((f) => ({ id: f.id, label: f.label, value: "ערך", tone: null, photos: f.type === "photo" ? [] : undefined })),
  }));
}

/** The general template's editor has no route, so no steps to sample: two stations that show
 *  what the detail prints (a popup's component, a route field, a photo). */
const GENERAL_SAMPLE: ReportStepResult[] = [
  { label: "עמדה ראשונה", fields: [["מק״ט שנסרק", "ערך"], ["שדה של המסלול", "ערך"]] },
  { label: "עמדה שנייה", fields: [["מק״ט שנסרק", "ערך"], ["משקל", "ערך"]] },
].map((s, i) => ({
  uid: `sample-${i + 1}`, position: i + 1, stationType: s.label, station: "עמדה", worker: "שם העובד", workerNumber: "",
  date: "dd.mm.yyyy", time: "hh:mm", verdict: null, result: null, comments: "",
  fields: [
    ...s.fields.map(([label, value], j) => ({ id: `sample-${i}-${j}`, label, value, tone: null })),
    { id: `sample-${i}-photo`, label: "תמונה מהעמדה", value: "", tone: null, photos: [] },
  ],
}));

/** Photos per row and photo height (mm), as a block's props ask, kept in range. */
const clampPerRow = (v: unknown): number => Math.max(1, Math.min(4, Number(v) || 3));
const clampPhotoHeight = (v: unknown, fallback: number): number => Math.max(20, Math.min(200, Number(v) || fallback));

/** A grid of photos (object keys → meta.photos); an empty key prints the placeholder. */
function PhotoGrid({ shots, perRow, height, captions, meta }: {
  shots: { key: string; caption: string }[];
  perRow: number;
  height: number;
  captions: boolean;
  meta: ReportRenderMeta;
}) {
  return (
    <div className="pdf-photos" style={{ gridTemplateColumns: `repeat(${perRow}, 1fr)` }}>
      {shots.map((s, i) => {
        const src = s.key ? meta.photos[s.key] : undefined;
        return (
          <figure key={i} className="pdf-photo pdf-keep">
            <div className="pdf-photo__frame" style={{ height: `${height}mm` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {src ? <img src={src} alt="" /> : <span className="pdf-sign__placeholder">תמונה</span>}
            </div>
            {captions ? <figcaption>{s.caption}</figcaption> : null}
          </figure>
        );
      })}
    </div>
  );
}

interface WidthProp {
  width?: string;
}
export interface SectionProps extends WidthProp {
  heading: string | RichValue;
  /** numbered = an official document's numbered section (CSS counter). */
  variant: "numbered" | "plain" | "box";
  align: "right" | "center" | "left";
}
export interface TextProps extends WidthProp {
  content: string | RichValue;
  align: "right" | "center" | "left" | "justify";
}
export interface FieldValueProps extends WidthProp {
  field: string;
  caption: string;
}
export interface ListProps extends WidthProp {
  ordered: boolean;
  items: { content: string | RichValue }[];
}
export interface TableProps extends WidthProp {
  columns: { header: string; width: number }[];
  rows: { cells: { content: string | RichValue }[] }[];
  headerBackground: boolean;
}
export interface DetailsTableProps extends WidthProp {
  /** label → value rows; the value takes variables. */
  rows: { label: string; value: string | RichValue }[];
  /** Label/value pairs per table row: 1 = two columns, 2 = four. */
  perRow: number;
}
export interface FieldLineProps extends WidthProp {
  value: string | RichValue;
  caption: string;
}
export interface SignatureProps extends WidthProp {
  /** "final" = the report's signer; "step:<uid>" = the worker of that station. */
  bind: string;
  cells: SignCell[];
}
export interface ResultsTableProps extends WidthProp {
  /** Print each step's fields under its row. */
  showFields: boolean;
  showWorker: boolean;
  showDate: boolean;
  showStation: boolean;
  showComments: boolean;
}
export interface StepFieldsProps extends WidthProp {
  /** The step uid. */
  step: string;
  /** Print "עמדה · עובד · תאריך" above the table. */
  showHeader: boolean;
  showNotes: boolean;
}
export interface StepDetailsProps extends WidthProp {
  /** Print each station's photos under its fields. */
  showPhotos: boolean;
  perRow: number;
  /** Height of each photo (mm). */
  height: number;
  showComments: boolean;
}
export interface PhotosProps extends WidthProp {
  /** The step uid; "" = every step. */
  step: string;
  /** A photo field id of that step; "" = every photo field. */
  field: string;
  perRow: number;
  /** Height of each photo (mm). */
  height: number;
  captions: boolean;
}
export interface SpacerProps {
  height: number;
}
/** Blocks with no settings of their own. */
export type DividerProps = Record<string, never>;
export type PageBreakProps = Record<string, never>;

export interface PdfComponentProps {
  Section: SectionProps;
  Text: TextProps;
  FieldValue: FieldValueProps;
  List: ListProps;
  Table: TableProps;
  FieldLine: FieldLineProps;
  DetailsTable: DetailsTableProps;
  ResultsTable: ResultsTableProps;
  StepFields: StepFieldsProps;
  StepDetails: StepDetailsProps;
  Photos: PhotosProps;
  Signature: SignatureProps;
  Spacer: SpacerProps;
  Divider: DividerProps;
  PageBreak: PageBreakProps;
}

export const puckConfig: Config<PdfComponentProps, RootProps> = {
  root: {
    label: "המסמך",
    defaultProps: DEFAULT_ROOT_PROPS,
    render: ({ header, border, font, children, puck }) => {
      const meta = readMeta(puck);
      const h = header ?? ({} as HeaderSettings);
      // The footer is drawn per printed page by Chromium (render.ts), and per
      // sheet in the editor by PageCanvas — NOT here.
      return (
        <div className="pdf-page" style={pageFontStyle(font)}>
          {border && border !== "none" ? (
            <div className={`pdf-frame pdf-frame--${border}`} aria-hidden="true" />
          ) : null}
          {meta.draft ? <div className="pdf-draftmark" aria-hidden="true">טיוטה</div> : null}
          {h.show !== false ? <HeaderBand h={h} meta={meta} /> : null}
          {children}
        </div>
      );
    },
  },
  components: {
    Section: {
      label: "כותרת",
      defaultProps: { heading: [{ text: "כותרת", b: true }], variant: "numbered", align: "right", width: "full" },
      render: ({ heading, variant, align, width, puck }) => {
        const meta = readMeta(puck);
        const cls = ["pdf-section", variant === "box" ? "pdf-section--box" : variant === "numbered" ? "pdf-section--num" : ""]
          .filter(Boolean)
          .join(" ");
        return (
          <Block width={width}>
            <div className={cls} style={{ textAlign: (align as "right" | "center" | "left") || "right" }}>
              {renderText(heading, meta.values)}
            </div>
          </Block>
        );
      },
    },

    Text: {
      label: "טקסט",
      defaultProps: { content: "טקסט חופשי", align: "right", width: "full" },
      render: ({ content, align, width, puck }) => {
        const meta = readMeta(puck);
        return (
          <Block width={width}>
            <div className="pdf-text" style={{ textAlign: align, direction: align === "left" ? "ltr" : undefined }}>
              {renderText(content, meta.values)}
            </div>
          </Block>
        );
      },
    },

    FieldValue: {
      label: "ערך ממשתנה",
      defaultProps: { field: "", caption: "", width: "full" },
      render: ({ field, caption, width, puck }) => {
        const meta = readMeta(puck);
        return (
          <Block width={width}>
            <div className="pdf-text">
              {caption ? <span style={{ color: "var(--pdf-soft)" }}>{caption} </span> : null}
              <FillValue value={meta.values[field]} />
            </div>
          </Block>
        );
      },
    },

    List: {
      label: "רשימה",
      defaultProps: { ordered: true, items: [{ content: "סעיף ראשון" }], width: "full" },
      render: ({ ordered, items, width, puck }) => {
        const meta = readMeta(puck);
        const Tag = (ordered ? "ol" : "ul") as "ol" | "ul";
        return (
          <Block width={width}>
            <Tag className="pdf-list">
              {(items ?? []).map((it, i) => (
                <li key={i}>{renderText(it.content, meta.values)}</li>
              ))}
            </Tag>
          </Block>
        );
      },
    },

    Table: {
      label: "טבלה",
      defaultProps: {
        headerBackground: true,
        columns: [
          { header: "עמודה א", width: 1 },
          { header: "עמודה ב", width: 1 },
        ],
        rows: [{ cells: [{ content: "" }, { content: "" }] }],
        width: "full",
      },
      render: ({ columns, rows, headerBackground, width, puck }) => {
        const meta = readMeta(puck);
        const cols = columns ?? [];
        const totalW = cols.reduce((s, c) => s + (c.width || 1), 0) || 1;
        return (
          <Block width={width}>
            <table className={`pdf-table ${headerBackground ? "" : "pdf-table--noheadbg"}`}>
              {cols.length > 0 ? (
                <thead>
                  <tr>
                    {cols.map((c, i) => (
                      <th key={i} style={{ width: `${((c.width || 1) / totalW) * 100}%` }}>
                        {renderText(c.header ?? "", meta.values)}
                      </th>
                    ))}
                  </tr>
                </thead>
              ) : null}
              <tbody>
                {(rows ?? []).map((r, ri) => (
                  <tr key={ri}>
                    {cols.map((_c, ci) => (
                      <td key={ci}>{renderText(r.cells?.[ci]?.content ?? "", meta.values)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
        );
      },
    },

    // An official document's particulars table: a grey label cell next to
    // each value, one or two pairs per row.
    DetailsTable: {
      label: "טבלת פרטים",
      defaultProps: {
        perRow: 2,
        rows: [
          { label: "מספר פריט", value: [{ v: "item.item_id" }] },
          { label: "מספר סידורי", value: [{ v: "item.serial_no" }] },
          { label: "סוג פריט", value: [{ v: "item.item_type" }] },
          { label: "מק\"ט", value: [{ v: "item.makat" }] },
        ],
        width: "full",
      },
      render: ({ rows, perRow, width, puck }) => {
        const meta = readMeta(puck);
        const n = Number(perRow) === 1 ? 1 : 2;
        const list = rows ?? [];
        const lines: (typeof list)[] = [];
        for (let i = 0; i < list.length; i += n) lines.push(list.slice(i, i + n));
        return (
          <Block width={width}>
            <table className="pdf-table pdf-details">
              <tbody>
                {lines.map((line, li) => (
                  <tr key={li}>
                    {Array.from({ length: n }, (_, ci) => {
                      const r = line[ci];
                      return (
                        <React.Fragment key={ci}>
                          <th scope="row" style={{ width: n === 1 ? "32%" : "18%" }}>{r?.label ?? ""}</th>
                          <td>{r ? renderText(r.value, meta.values) : null}</td>
                        </React.Fragment>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
        );
      },
    },

    FieldLine: {
      label: "שורת ערך (קו + תווית)",
      defaultProps: { value: "", caption: "תווית", width: "full" },
      render: ({ value, caption, width, puck }) => {
        const meta = readMeta(puck);
        return (
          <Block width={width}>
            <div className="pdf-sign">
              <div className="pdf-sign__box" style={{ alignItems: "flex-end" }}>
                <span>{renderText(value, meta.values)}</span>
              </div>
              <div className="pdf-sign__label">{caption}</div>
            </div>
          </Block>
        );
      },
    },

    // Every station step the item passed, in route order — one row each, with
    // the worker, date and verdict; optionally its fields underneath.
    ResultsTable: {
      label: "טבלת תוצאות (כל העמדות)",
      defaultProps: { showFields: true, showStation: true, showWorker: true, showDate: true, showComments: true, width: "full" },
      render: ({ showFields, showStation, showWorker, showDate, showComments, width, puck }) => {
        const meta = readMeta(puck);
        const rows = resultsFor(meta, "");
        const span = 3 + (showStation ? 1 : 0) + (showWorker ? 1 : 0) + (showDate ? 1 : 0) + (showComments ? 1 : 0);
        return (
          <Block width={width}>
            <table className="pdf-table pdf-results">
              <thead>
                <tr>
                  <th style={{ width: "6%" }}>#</th>
                  <th>שלב</th>
                  {showStation ? <th>עמדה</th> : null}
                  {showWorker ? <th>עובד</th> : null}
                  {showDate ? <th>תאריך</th> : null}
                  <th style={{ width: "15%" }}>תוצאה</th>
                  {showComments ? <th>הערות</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={span} className="pdf-results__empty">
                      {meta.mode === "edit" ? "תוצאות העמדות של הפריט יופיעו כאן" : "לא נרשמו תוצאות"}
                    </td>
                  </tr>
                ) : null}
                {rows.map((r) => (
                  <React.Fragment key={r.uid + r.position}>
                    <tr className="pdf-keep">
                      <td><bdi>{r.position}</bdi></td>
                      <td className="pdf-results__step">{r.stationType}</td>
                      {showStation ? <td>{r.station}</td> : null}
                      {showWorker ? <td>{r.worker}</td> : null}
                      {showDate ? <td><bdi>{r.date}{r.time ? ` ${r.time}` : ""}</bdi></td> : null}
                      <td><VerdictChip verdict={r.verdict} /></td>
                      {showComments ? <td className="pdf-results__note">{r.comments}</td> : null}
                    </tr>
                    {showFields && r.fields.filter((f) => !f.photos).length > 0 ? (
                      <tr className="pdf-results__fieldsrow">
                        <td />
                        <td colSpan={span - 1}>
                          <div className="pdf-results__fields">
                            {r.fields
                              .filter((f) => !f.photos)
                              .map((f) => (
                                <div key={f.id} className="pdf-results__field">
                                  <span className="pdf-results__flabel">{f.label}:</span>{" "}
                                  <bdi>{f.value}</bdi> <ToneMark tone={f.tone} />
                                  {f.note ? <span className="pdf-results__fnote"> ({f.note})</span> : null}
                                </div>
                              ))}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </Block>
        );
      },
    },

    // The fields one station step filled, as a label / value / verdict table.
    StepFields: {
      label: "שדות של עמדה",
      defaultProps: { step: "", showHeader: true, showNotes: true, width: "full" },
      render: ({ step, showHeader, showNotes, width, puck }) => {
        const meta = readMeta(puck);
        if (!step) {
          return (
            <Block width={width}>
              <div className="pdf-placeholder">{meta.mode === "edit" ? "בחר/י עמדה במאפיינים" : ""}</div>
            </Block>
          );
        }
        const r = resultsFor(meta, step).at(-1);
        const stepRef = meta.steps.find((s) => s.uid === step);
        const fields = (r?.fields ?? []).filter((f) => !f.photos);
        return (
          <Block width={width}>
            {showHeader ? (
              <div className="pdf-stephead">
                <strong>{r?.stationType ?? stepRef?.label ?? ""}</strong>
                {r ? (
                  <span>
                    {" · "}{r.station}{" · "}{r.worker}{" · "}<bdi>{r.date}</bdi>{" "}
                    <VerdictChip verdict={r.verdict} />
                  </span>
                ) : null}
              </div>
            ) : null}
            <table className="pdf-table pdf-stepfields">
              <thead>
                <tr>
                  <th style={{ width: "38%" }}>שדה</th>
                  <th>ערך</th>
                  <th style={{ width: "16%" }}>סטטוס</th>
                  {showNotes ? <th>הערה</th> : null}
                </tr>
              </thead>
              <tbody>
                {fields.length === 0 ? (
                  <tr>
                    <td colSpan={showNotes ? 4 : 3} className="pdf-results__empty">
                      {r ? "לא מולאו שדות" : meta.mode === "edit" ? "" : "הפריט לא עבר בעמדה זו"}
                    </td>
                  </tr>
                ) : null}
                {fields.map((f) => (
                  <tr key={f.id} className="pdf-keep">
                    <td className="pdf-stepfields__label">{f.label}</td>
                    <td><bdi>{f.value}</bdi></td>
                    <td><ToneMark tone={f.tone} /></td>
                    {showNotes ? <td className="pdf-results__note">{f.note ?? ""}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
        );
      },
    },

    // Every station the item passed, in route order, each as its own part: a head (station ·
    // worker · date · verdict), what it saved (the popup's components and the route's fields),
    // the comments, and its photos. Binds no step, so the general template can use it on any
    // route (docs/ITEM_REPORTS.md).
    StepDetails: {
      label: "פירוט לפי עמדה (כל העמדות)",
      defaultProps: { showPhotos: true, perRow: 3, height: 45, showComments: true, width: "full" },
      render: ({ showPhotos, perRow, height, showComments, width, puck }) => {
        const meta = readMeta(puck);
        // The general template's editor (no steps to sample) shows the sample stations, as its
        // preview does; the other step blocks stay empty there.
        const rows = meta.mode === "edit" && meta.steps.length === 0 ? GENERAL_SAMPLE : resultsFor(meta, "");
        if (rows.length === 0) {
          return <Block width={width}><div className="pdf-stepdetail__empty">{meta.mode === "edit" ? "העמדות של הפריט יופיעו כאן" : "לא נרשמו תוצאות"}</div></Block>;
        }
        return (
          <Block width={width}>
            {rows.map((r) => {
              const fields = r.fields.filter((f) => !f.photos);
              const shots = r.fields.flatMap((f) => (f.photos ?? []).map((key) => ({ key, caption: f.label })));
              if (meta.mode === "edit" || meta.sample) for (const f of r.fields) if (f.photos && f.photos.length === 0) shots.push({ key: "", caption: f.label });
              return (
                <div key={r.uid + r.position} className="pdf-stepdetail">
                  <div className="pdf-stepdetail__head">
                    <strong><bdi>{r.position}</bdi>. {r.stationType}</strong>
                    <span className="pdf-stepdetail__meta">
                      {[r.station, r.worker].filter(Boolean).join(" · ")}{" · "}<bdi>{r.date}{r.time ? ` ${r.time}` : ""}</bdi>{" · "}
                      <VerdictChip verdict={r.verdict} />
                    </span>
                  </div>
                  {fields.length > 0 ? (
                    <table className="pdf-table pdf-stepfields">
                      <tbody>
                        {fields.map((f) => (
                          <tr key={f.id} className="pdf-keep">
                            <td className="pdf-stepfields__label" style={{ width: "38%" }}>{f.label}</td>
                            <td><bdi>{f.value}</bdi> <ToneMark tone={f.tone} /></td>
                            <td className="pdf-results__note" style={{ width: "28%" }}>{f.note ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                  {showComments && r.comments ? <div className="pdf-stepdetail__note">הערות: {r.comments}</div> : null}
                  {showPhotos && shots.length > 0 ? (
                    <PhotoGrid shots={shots} perRow={clampPerRow(perRow)} height={clampPhotoHeight(height, 45)} captions meta={meta} />
                  ) : null}
                  {fields.length === 0 && shots.length === 0 && !(showComments && r.comments) ? (
                    <div className="pdf-stepdetail__empty">לא נשמרו נתונים בעמדה זו</div>
                  ) : null}
                </div>
              );
            })}
          </Block>
        );
      },
    },

    // Photos captured in photo fields — one step's, or every step's.
    Photos: {
      label: "תמונות מעמדה",
      defaultProps: { step: "", field: "", perRow: 3, height: 50, captions: true, width: "full" },
      render: ({ step, field, perRow, height, captions, width, puck }) => {
        const meta = readMeta(puck);
        const n = clampPerRow(perRow);
        const shots: { key: string; caption: string }[] = [];
        if (meta.mode === "edit") {
          for (let i = 0; i < n; i++) shots.push({ key: "", caption: "תמונה" });
        } else {
          for (const r of resultsFor(meta, step)) {
            for (const f of r.fields) {
              if (!f.photos || (field && f.id !== field)) continue;
              for (const k of f.photos) shots.push({ key: k, caption: step ? f.label : `${r.stationType} · ${f.label}` });
            }
          }
        }
        if (shots.length === 0) return <Block width={width}><span /></Block>;
        return (
          <Block width={width}>
            <PhotoGrid shots={shots} perRow={n} height={clampPhotoHeight(height, 50)} captions={captions} meta={meta} />
          </Block>
        );
      },
    },

    Signature: {
      label: "בלוק חתימה",
      defaultProps: {
        bind: FINAL_SIGNATURE_BIND,
        cells: [
          { kind: "fullName", label: "שם ושם משפחה", text: "", weight: 1 },
          { kind: "number", label: "מספר עובד", text: "", weight: 1 },
          { kind: "date", label: "תאריך", text: "", weight: 1 },
          { kind: "signature", label: "חתימה", text: "", weight: 1 },
        ],
        width: "full",
      },
      render: ({ bind, cells, width, puck }) => {
        const meta = readMeta(puck);
        const sig = meta.signatures[bind];
        const info = meta.signerMeta[bind];
        return (
          <Block width={width}>
            <div className="pdf-sigrow pdf-keep">
              {signCellsOf(cells).map((c, i) => {
                const weight = c.weight && c.weight > 0 ? c.weight : 1;
                const isSig = c.kind === "signature";
                const highlight = isSig && !sig && meta.highlightBind === bind && bind !== "";
                let inner: React.ReactNode = null;
                if (isSig) {
                  inner = sig ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sig} alt="" />
                  ) : (
                    <span className="pdf-sign__placeholder">
                      {highlight ? "חתום/י כאן ✍" : meta.mode === "edit" ? signerLabel(bind, meta) : ""}
                    </span>
                  );
                } else if (c.kind === "text") {
                  inner = <span>{renderRich(c.text ?? "", meta.values)}</span>;
                } else {
                  // A role cell of a given signature that kept no role (signed before roles were
                  // kept, or a step's worker) prints the cell's own text, as plain text.
                  const val = signerAttr(info, c.kind) || (c.kind === "role" && info ? (c.text ?? "").trim() : "");
                  inner = val ? (
                    <bdi>{val}</bdi>
                  ) : meta.mode === "edit" ? (
                    <span className="pdf-sign__placeholder">{ATTR_LABELS[c.kind] ?? ""}</span>
                  ) : null;
                }
                return (
                  <div key={i} className="pdf-sigrow__cell" style={{ flexGrow: weight, flexBasis: 0 }}>
                    <div
                      className={`pdf-sigrow__box${isSig ? " pdf-sigrow__box--sig" : ""}${highlight ? " pdf-sign__box--highlight" : ""}`}
                    >
                      {inner}
                    </div>
                    {c.label ? <div className="pdf-sign__label">{c.label}</div> : null}
                  </div>
                );
              })}
            </div>
          </Block>
        );
      },
    },

    Spacer: {
      label: "רווח",
      defaultProps: { height: 8 },
      render: ({ height }) => (
        <Block width="full">
          <div className="pdf-spacer" style={{ height: `${height}mm` }} />
        </Block>
      ),
    },

    Divider: {
      label: "קו מפריד",
      defaultProps: {},
      render: () => (
        <Block width="full">
          <hr className="pdf-divider" />
        </Block>
      ),
    },

    // Not in the palette — pages are added/removed via the +/- page controls.
    PageBreak: {
      label: "מעבר עמוד",
      defaultProps: {},
      render: ({ puck }) => {
        const meta = readMeta(puck);
        if (meta.mode !== "edit") return <div className="pdf-pagebreak" />;
        return (
          <div className="pdf-pagebreak pdf-pagebreak--edit">
            <span className="pdf-pagebreak__marker">תחילת עמוד חדש</span>
          </div>
        );
      },
    },
  },
};
