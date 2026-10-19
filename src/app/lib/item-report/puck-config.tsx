// Puck configuration — the item-report document components.
//
// Ported from ticketflow (src/lib/pdf/puck-config.tsx). SINGLE source of truth
// for the report template: imported by BOTH the editor (ReportTemplateEditor via
// <Puck>) and the server renderer (render-react via a custom tree walk). Every
// component is isomorphic (renders under renderToStaticMarkup, no browser APIs)
// and styled with the shared classes in `pdf-styles`, so the editor canvas
// matches the PDF.
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
import { withBasePath } from "@/lib/base-path";
import { renderRichModel, isRichValue, type RichValue } from "./rich";
import type {
  ReportRenderMeta as PdfRenderMeta,
  ReportSignerInfo,
  ReportStepResult,
  ReportTone,
} from "./types";
import { FINAL_SIGNATURE_BIND } from "./types";
import { FONT_STACK, REPORT_FONT_OPTIONS, fontOf, type ReportFont } from "./fonts";

/** The page's font, as the --pdf-font the stylesheet reads. */
export function pageFontStyle(font: unknown): React.CSSProperties {
  return { ["--pdf-font" as string]: FONT_STACK[fontOf(font)] } as React.CSSProperties;
}

// ---------------------------------------------------------------- widths

// A4 portrait content width = 210mm − 2×16mm margin = 178mm. Fractions are
// kept slightly under budget so N-per-row always wraps cleanly.
export const WIDTH_MM: Record<string, string> = {
  full: "178mm",
  "three-quarters": "132mm",
  "two-thirds": "117mm",
  half: "87mm",
  third: "57mm",
  quarter: "43mm",
};

const BOOL_OPTIONS = [
  { label: "כן", value: true },
  { label: "לא", value: false },
];

const BORDER_OPTIONS = [
  { label: "ללא מסגרת", value: "none" },
  { label: "מסגרת מלאה", value: "solid" },
  { label: "מסגרת מקווקוות", value: "dashed" },
];
const PAGENUM_OPTIONS = [
  { label: "עמוד N", value: "plain" },
  { label: "עמוד N מתוך M", value: "of" },
  { label: "N / M", value: "slash" },
];
const ALIGN3_OPTIONS = [
  { label: "ימין", value: "right" },
  { label: "מרכז", value: "center" },
  { label: "שמאל", value: "left" },
];

/** The page-number preset → a template string with {page}/{pages} tokens.
 *  Shared by the editor footer preview and the server PDF footer. */
export function pageNumberTemplate(style: string | undefined): string {
  if (style === "plain") return "עמוד {page}";
  if (style === "slash") return "{page} / {pages}";
  return "עמוד {page} מתוך {pages}"; // "of" (default)
}

// ---------------------------------------------------------------- metadata

const DEFAULT_META: PdfRenderMeta = {
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

function readMeta(puck: { metadata?: Record<string, unknown> } | undefined): PdfRenderMeta {
  return { ...DEFAULT_META, ...((puck?.metadata as Partial<PdfRenderMeta>) ?? {}) };
}

// ---------------------------------------------------------------- rich text + tokens

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
    const name = m[1] ?? "";
    const val = values[name];
    out.push(
      <span key={`f${key++}`} className="pdf-fill">
        {val != null && val !== "" ? <bdi>{val}</bdi> : null}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...parseInline(text.slice(last), `t${key}`));
  return out;
}

// Render a text value that may be either a rich model (from the WYSIWYG
// editor) or a plain string (markdown + {{tokens}}).
function renderText(
  content: string | RichValue | undefined,
  values: Record<string, string>,
): React.ReactNode {
  return isRichValue(content)
    ? renderRichModel(content, values)
    : renderRich(String(content ?? ""), values);
}

// ---------------------------------------------------------------- verdict chips

const TONE_WORD: Record<ReportTone, string> = {
  pass: "תקין",
  warn: "אזהרה",
  fail: "לא תקין",
  neutral: "—",
};

function VerdictChip({ verdict }: { verdict: "pass" | "fail" | null }) {
  if (!verdict) return <span className="pdf-chip pdf-chip--none">—</span>;
  return (
    <span className={`pdf-chip pdf-chip--${verdict}`}>
      {verdict === "pass" ? "✓ תקין" : "✕ לא תקין"}
    </span>
  );
}

function ToneMark({ tone }: { tone: ReportTone | null }) {
  if (!tone || tone === "neutral") return null;
  return <span className={`pdf-chip pdf-chip--${tone}`}>{tone === "pass" ? "✓" : tone === "fail" ? "✕" : "!"} {TONE_WORD[tone]}</span>;
}

// ---------------------------------------------------------------- signature cells

// A signature block is a single row of cells the author orders freely: the
// drawn signature, any of the signer's auto-filled identity fields, or free
// text. The signer is whoever the block's `bind` points at: "final" = the
// person who signs the finished report; "step:<uid>" = the worker who ran that
// station (no drawn signature — workers don't draw one at the station).
export interface SignCell {
  /** "signature" | "text" | a signer attribute (fullName / number / date / station). */
  kind: string;
  /** Caption under the cell (e.g. "(תאריך)"). */
  label?: string;
  /** Text for kind==="text" — supports {{name}} tokens + inline markdown. */
  text?: string;
  /** Relative width within the row (flex-grow). Default 1 = equal cells. */
  weight?: number;
}

export const SIGNER_ATTRS: { suffix: keyof ReportSignerInfo; label: string }[] = [
  { suffix: "fullName", label: "שם מלא" },
  { suffix: "number", label: "מספר עובד" },
  { suffix: "date", label: "תאריך" },
  { suffix: "station", label: "עמדה" },
];

const ATTR_LABELS: Record<string, string> = Object.fromEntries(
  SIGNER_ATTRS.map((a) => [a.suffix, a.label]),
);

export const SIGN_CELL_KINDS = [
  { label: "✍ חתימה", value: "signature" },
  ...SIGNER_ATTRS.map((a) => ({ label: a.label, value: a.suffix })),
  { label: "טקסט חופשי", value: "text" },
];

function signerAttr(info: ReportSignerInfo | undefined, suffix: string): string {
  if (!info) return "";
  return (info as unknown as Record<string, string | undefined>)[suffix] ?? "";
}

// Readable summary for the array-field item chips in the editor.
export function signCellSummary(c: SignCell): string {
  const base =
    c.kind === "signature"
      ? "✍ חתימה"
      : c.kind === "text"
        ? `טקסט: ${c.text || "—"}`
        : ATTR_LABELS[c.kind] ?? c.kind;
  return c.label ? `${base}  ·  ${c.label}` : base;
}

// Human-readable "who signs here" for the editor canvas.
function signerLabel(bind: string, meta: PdfRenderMeta): string {
  if (bind === FINAL_SIGNATURE_BIND) return "חתימת מאשר הדוח";
  const step = /^step:(.+)$/.exec(bind);
  if (step) {
    const s = meta.steps.find((x) => x.uid === step[1]);
    return s ? `העובד · ${s.label}` : "העובד בעמדה";
  }
  return "בחר/י חותם במאפיינים";
}

function logoSrc(meta: PdfRenderMeta, key: string | undefined | null): string | null {
  if (!key) return null;
  if (meta.logos[key]) return meta.logos[key];
  // Bundled emblems (public/report-logos) are referenced by path.
  if (key.startsWith("/")) return withBasePath(key);
  return withBasePath(`/api/item-reports/logo?key=${encodeURIComponent(key)}`);
}

// Outer wrapper that carries the block's row-width.
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
  h: Partial<HeaderSettings> & { rightLogo?: string; leftLogo?: string };
  meta: PdfRenderMeta;
}) {
  const right = logoSrc(meta, h.rightLogo);
  const left = logoSrc(meta, h.leftLogo);
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

/** The classification marking (בלמ"ס / שמור / …) — printed on every page by
 *  Chromium's header/footer; drawn at the top and bottom of each sheet in the editor. */
export const CLASSIFICATION_OPTIONS = [
  { label: "ללא סימון", value: "" },
  { label: "בלמ\"ס", value: "בלמ\"ס" },
  { label: "שמור", value: "שמור" },
  { label: "סודי", value: "סודי" },
  { label: "סודי ביותר", value: "סודי ביותר" },
];

// ---------------------------------------------------------------- step-bound helpers

/** The results to print for a step-bound block: the real ones in print; in the
 *  editor a placeholder per configured step, so the layout is visible. */
function resultsFor(meta: PdfRenderMeta, uid: string): ReportStepResult[] {
  const all = meta.mode === "edit" ? sampleResults(meta) : meta.results;
  return uid ? all.filter((r) => r.uid === uid) : all;
}

function sampleResults(meta: PdfRenderMeta): ReportStepResult[] {
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

// ---------------------------------------------------------------- prop types

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
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DividerProps {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PageBreakProps {}

export interface HeaderSettings {
  show: boolean;
  /** The issuing body, one per line ("מדינת ישראל / משרד … / מעבדת הבדיקות"). */
  org: string | RichValue;
  /** The document's particulars, top-left ("מספר: … / תאריך: … / סימוכין: …"). */
  meta: string | RichValue;
  title: string | RichValue;
  subtitle: string | RichValue;
  /** @deprecated superseded by org / meta; still printed when set. */
  cornerRight?: string | RichValue;
  cornerCenter?: string | RichValue;
  cornerLeft?: string | RichValue;
  rightLogo: string;
  leftLogo: string;
}
export interface FooterSettings {
  show: boolean;
  text: string;
  textAlign: "right" | "center" | "left";
  pageNumbers: boolean;
  pageNumberStyle: "plain" | "of" | "slash";
  pageNumberAlign: "right" | "center" | "left";
}
export interface RootProps {
  header: HeaderSettings;
  footer: FooterSettings;
  /** A frame drawn on EVERY page. */
  border: "none" | "solid" | "dashed";
  /** The document font (fonts.ts). */
  font: ReportFont;
  /** The classification marking, top and bottom of every page; "" = none. */
  classification: string;
}

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
  Photos: PhotosProps;
  Signature: SignatureProps;
  Spacer: SpacerProps;
  Divider: DividerProps;
  PageBreak: PageBreakProps;
}

export const DEFAULT_ROOT_PROPS: RootProps = {
  header: {
    show: true,
    org: [{ text: "מדינת ישראל", b: true }, { text: "\nשם היחידה\nמעבדת הבדיקות" }],
    meta: [
      { text: "מספר: " }, { v: "item.item_id" },
      { text: "\nתאריך: " }, { v: "report.generated_at" },
      { text: "\nסימוכין: " }, { v: "item.shipment_code" },
    ],
    title: [{ text: "דוח בדיקה", b: true, u: true }],
    subtitle: [{ v: "item.item_type" }, { text: " · מק\"ט " }, { v: "item.makat" }],
    rightLogo: "/report-logos/emblem-navy.png",
    leftLogo: "/report-logos/emblem-atom.jpg",
  },
  footer: { show: true, text: "", textAlign: "center", pageNumbers: true, pageNumberStyle: "of", pageNumberAlign: "center" },
  border: "none",
  font: "david",
  classification: "",
};

// ---------------------------------------------------------------- config

export const puckConfig: Config<PdfComponentProps, RootProps> = {
  root: {
    label: "המסמך",
    fields: {
      header: {
        type: "object",
        label: "כותרת עליונה",
        objectFields: {
          show: { type: "radio", label: "להציג כותרת עליונה", options: BOOL_OPTIONS },
          org: { type: "textarea", label: "הגוף המוציא (שורה לכל רמה)" },
          meta: { type: "textarea", label: "פרטי המסמך (מספר, תאריך, סימוכין)" },
          title: { type: "text", label: "כותרת המסמך" },
          subtitle: { type: "text", label: "כותרת משנה" },
          rightLogo: { type: "text", label: "סמל ימין" },
          leftLogo: { type: "text", label: "סמל שמאל" },
        },
      },
      footer: {
        type: "object",
        label: "כותרת תחתונה",
        objectFields: {
          show: { type: "radio", label: "להציג כותרת תחתונה", options: BOOL_OPTIONS },
          text: { type: "text", label: "טקסט קבוע בתחתית" },
          textAlign: { type: "radio", label: "מיקום הטקסט", options: ALIGN3_OPTIONS },
          pageNumbers: { type: "radio", label: "מספור עמודים", options: BOOL_OPTIONS },
          pageNumberStyle: { type: "select", label: "תבנית מספור", options: PAGENUM_OPTIONS },
          pageNumberAlign: { type: "radio", label: "מיקום המספור (שורה נפרדת)", options: ALIGN3_OPTIONS },
        },
      },
      classification: { type: "select", label: "סיווג (בראש ובתחתית כל עמוד)", options: CLASSIFICATION_OPTIONS },
      font: { type: "select", label: "גופן", options: REPORT_FONT_OPTIONS },
      border: { type: "select", label: "מסגרת לכל העמודים", options: BORDER_OPTIONS },
    },
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
  categories: {
    "תוכן": { title: "תוכן", components: ["Section", "Text", "DetailsTable", "FieldValue", "List", "Table"] },
    "תוצאות": { title: "תוצאות הבדיקות", components: ["ResultsTable", "StepFields", "Photos"] },
    "חתימות": { title: "חתימות וערכים", components: ["Signature", "FieldLine"] },
    "עיצוב": { title: "מרווחים ומפרידים", components: ["Spacer", "Divider"] },
    other: { visible: false },
  },
  components: {
    Section: {
      label: "כותרת",
      fields: {
        heading: { type: "text", label: "טקסט הכותרת" },
        variant: {
          type: "select",
          label: "סגנון",
          options: [
            { label: "סעיף ממוספר (1. 2. 3.)", value: "numbered" },
            { label: "רגיל", value: "plain" },
            { label: "מסגרת", value: "box" },
          ],
        },
        align: { type: "radio", label: "יישור", options: ALIGN3_OPTIONS },
      },
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
      fields: {
        content: { type: "textarea", label: "תוכן" },
        align: {
          type: "select",
          label: "יישור",
          options: [
            { label: "ימין", value: "right" },
            { label: "מרכז", value: "center" },
            { label: "שמאל", value: "left" },
            { label: "מיושר לשני הצדדים", value: "justify" },
          ],
        },
      },
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
      fields: {
        field: { type: "text", label: "משתנה" },
        caption: { type: "text", label: "תווית לפני הערך (לא חובה)" },
      },
      defaultProps: { field: "", caption: "", width: "full" },
      render: ({ field, caption, width, puck }) => {
        const meta = readMeta(puck);
        const val = meta.values[field];
        return (
          <Block width={width}>
            <div className="pdf-text">
              {caption ? <span style={{ color: "var(--pdf-soft)" }}>{caption} </span> : null}
              <span className="pdf-fill">{val != null && val !== "" ? <bdi>{val}</bdi> : null}</span>
            </div>
          </Block>
        );
      },
    },

    List: {
      label: "רשימה",
      fields: {
        ordered: { type: "radio", label: "ממוספרת", options: BOOL_OPTIONS },
        items: {
          type: "array",
          label: "פריטים",
          arrayFields: { content: { type: "textarea", label: "טקסט" } },
          defaultItemProps: { content: "פריט" },
          getItemSummary: (item: { content: string | RichValue }) =>
            typeof item.content === "string" ? item.content || "פריט" : "פריט",
        },
      },
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
      fields: {
        headerBackground: { type: "radio", label: "רקע לכותרות", options: BOOL_OPTIONS },
        columns: {
          type: "array",
          label: "עמודות (כותרות)",
          arrayFields: {
            header: { type: "text", label: "כותרת" },
            width: { type: "number", label: "משקל רוחב" },
          },
          defaultItemProps: { header: "עמודה", width: 1 },
          getItemSummary: (item: { header: string }) => item.header || "עמודה",
        },
        rows: {
          type: "array",
          label: "שורות",
          arrayFields: {
            cells: {
              type: "array",
              label: "תאים",
              arrayFields: { content: { type: "textarea", label: "תוכן" } },
              defaultItemProps: { content: "" },
              getItemSummary: (item: { content: string | RichValue }) =>
                typeof item.content === "string" ? item.content || "תא" : "תא",
            },
          },
          defaultItemProps: { cells: [{ content: "" }] },
          getItemSummary: (_i: unknown, i?: number) => `שורה ${(i ?? 0) + 1}`,
        },
      },
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
      fields: {
        perRow: {
          type: "radio",
          label: "זוגות בשורה",
          options: [
            { label: "1", value: 1 },
            { label: "2", value: 2 },
          ],
        },
        rows: {
          type: "array",
          label: "שורות",
          arrayFields: {
            label: { type: "text", label: "תווית" },
            value: { type: "text", label: "ערך" },
          },
          defaultItemProps: { label: "תווית", value: "" },
          getItemSummary: (item: { label: string }) => item.label || "שורה",
        },
      },
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
      fields: {
        value: { type: "text", label: "ערך" },
        caption: { type: "text", label: "תווית מתחת" },
      },
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
      fields: {
        showFields: { type: "radio", label: "להציג את השדות של כל עמדה", options: BOOL_OPTIONS },
        showStation: { type: "radio", label: "עמודת עמדה", options: BOOL_OPTIONS },
        showWorker: { type: "radio", label: "עמודת עובד", options: BOOL_OPTIONS },
        showDate: { type: "radio", label: "עמודת תאריך", options: BOOL_OPTIONS },
        showComments: { type: "radio", label: "עמודת הערות", options: BOOL_OPTIONS },
      },
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
      fields: {
        step: { type: "text", label: "עמדה" },
        showHeader: { type: "radio", label: "שורת עמדה · עובד · תאריך", options: BOOL_OPTIONS },
        showNotes: { type: "radio", label: "עמודת הערות", options: BOOL_OPTIONS },
      },
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

    // Photos captured in photo fields — one step's, or every step's.
    Photos: {
      label: "תמונות מעמדה",
      fields: {
        step: { type: "text", label: "עמדה" },
        field: { type: "text", label: "שדה צילום" },
        perRow: {
          type: "select",
          label: "תמונות בשורה",
          options: [
            { label: "1", value: 1 },
            { label: "2", value: 2 },
            { label: "3", value: 3 },
            { label: "4", value: 4 },
          ],
        },
        height: { type: "number", label: "גובה תמונה (מ\"מ)", min: 20, max: 200 },
        captions: { type: "radio", label: "כיתוב מתחת לתמונה", options: BOOL_OPTIONS },
      },
      defaultProps: { step: "", field: "", perRow: 3, height: 50, captions: true, width: "full" },
      render: ({ step, field, perRow, height, captions, width, puck }) => {
        const meta = readMeta(puck);
        const n = Math.max(1, Math.min(4, Number(perRow) || 3));
        const h = Math.max(20, Math.min(200, Number(height) || 50));
        type Shot = { key: string; caption: string };
        const shots: Shot[] = [];
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
            <div className="pdf-photos" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
              {shots.map((s, i) => {
                const src = s.key ? meta.photos[s.key] : undefined;
                return (
                  <figure key={i} className="pdf-photo pdf-keep">
                    <div className="pdf-photo__frame" style={{ height: `${h}mm` }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {src ? <img src={src} alt="" /> : <span className="pdf-sign__placeholder">תמונה</span>}
                    </div>
                    {captions ? <figcaption>{s.caption}</figcaption> : null}
                  </figure>
                );
              })}
            </div>
          </Block>
        );
      },
    },

    Signature: {
      label: "בלוק חתימה",
      fields: {
        bind: { type: "text", label: "חותם" },
        cells: {
          type: "array",
          label: "תאים בשורה (בחר/י סוג וסדר)",
          arrayFields: {
            kind: { type: "select", label: "סוג התא", options: SIGN_CELL_KINDS },
            label: { type: "text", label: "כיתוב מתחת (לא חובה)" },
            text: { type: "text", label: 'טקסט (רק ל"טקסט חופשי")' },
            weight: { type: "number", label: "רוחב יחסי", min: 1 },
          },
          defaultItemProps: { kind: "signature", label: "", text: "", weight: 1 },
          getItemSummary: (item: SignCell) => signCellSummary(item),
        },
      },
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
        const list: SignCell[] = Array.isArray(cells) && cells.length > 0 ? cells : [{ kind: "signature", label: "חתימה" }];
        return (
          <Block width={width}>
            <div className="pdf-sigrow pdf-keep">
              {list.map((c, i) => {
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
                  const val = signerAttr(info, c.kind);
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
      fields: { height: { type: "number", label: "גובה (מ\"מ)" } },
      defaultProps: { height: 8 },
      render: ({ height }) => (
        <Block width="full">
          <div className="pdf-spacer" style={{ height: `${height}mm` }} />
        </Block>
      ),
    },

    Divider: {
      label: "קו מפריד",
      fields: {},
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
      fields: {},
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

export type PdfPuckConfig = typeof puckConfig;
