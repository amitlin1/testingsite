/**
 * The report document: the A4 page, the document-level settings (header,
 * footer, frame, font, classification) and what prints on every page. Pure —
 * the print renderer, the stylesheet and the template editor read the same
 * values, so the canvas matches the PDF.
 */
import type { Data } from "@measured/puck";
import { withBasePath } from "@/lib/base-path";
import { DEFAULT_FONT, type ReportFont } from "./fonts";
import type { RichValue } from "./rich";

/** A4 portrait, in mm. */
export const PAGE = {
  widthMm: 210,
  heightMm: 297,
  /** The page margins of the plain document. */
  marginMm: { top: 14, side: 16, bottom: 14 },
  /** With Chromium's header/footer lines: room above for the classification, below for the footer. */
  linesMarginMm: { top: 16, bottom: 18 },
  /** 210 − 2 × 16. */
  contentWidthMm: 178,
} as const;

/** A block's row width. The fractions are kept slightly under budget so N-per-row always wraps cleanly. */
export const WIDTH_MM: Record<string, string> = {
  full: `${PAGE.contentWidthMm}mm`,
  "three-quarters": "132mm",
  "two-thirds": "117mm",
  half: "87mm",
  third: "57mm",
  quarter: "43mm",
};

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
  font: ReportFont;
  /** The classification marking, top and bottom of every page; "" = none. */
  classification: string;
}

/** The emblems bundled in public/report-logos; a header logo is one of these paths or an uploaded object key. */
export const REPORT_EMBLEMS = {
  navy: { path: "/report-logos/emblem-navy.png", label: "סמל כחול" },
  red: { path: "/report-logos/emblem-red.png", label: "סמל אדום" },
  atom: { path: "/report-logos/emblem-atom.jpg", label: "סמל אטום" },
  chain: { path: "/report-logos/emblem-chain.png", label: "סמל שרשרת" },
} as const;

export const isBundledLogo = (value: string): boolean => value.startsWith("/");

/** Where the browser loads a header logo from: a bundled emblem, or an uploaded one through the logo route. */
export function logoUrl(value: string): string {
  if (!value) return "";
  return isBundledLogo(value)
    ? withBasePath(value)
    : withBasePath(`/api/item-reports/logo?key=${encodeURIComponent(value)}`);
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
    rightLogo: REPORT_EMBLEMS.navy.path,
    leftLogo: REPORT_EMBLEMS.atom.path,
  },
  footer: { show: true, text: "", textAlign: "center", pageNumbers: true, pageNumberStyle: "of", pageNumberAlign: "center" },
  border: "none",
  font: DEFAULT_FONT,
  classification: "",
};

/** A template's document settings, the defaults filling what it does not set. */
export function rootPropsOf(template: Data): RootProps {
  return { ...DEFAULT_ROOT_PROPS, ...((template.root?.props ?? {}) as object) } as RootProps;
}

/** The page-number preset → a template string with {page}/{pages} tokens. */
export function pageNumberTemplate(style: string | undefined): string {
  if (style === "plain") return "עמוד {page}";
  if (style === "slash") return "{page} / {pages}";
  return "עמוד {page} מתוך {pages}"; // "of" (default)
}

/** The classification marking (בלמ"ס / שמור / …). */
export const CLASSIFICATION_OPTIONS = [
  { label: "ללא סימון", value: "" },
  { label: "בלמ\"ס", value: "בלמ\"ס" },
  { label: "שמור", value: "שמור" },
  { label: "סודי", value: "סודי" },
  { label: "סודי ביותר", value: "סודי ביותר" },
];

/** A line Chromium prints on every page; `{page}` / `{pages}` become the live page number / total. */
export type PageLine = { text: string; align: "right" | "center" | "left"; bold?: boolean };

/**
 * What prints on every page of the PDF, through Chromium's header and footer:
 * the classification at the top; at the bottom the footer text, the page
 * number, then the classification again.
 */
export function pageChrome(root: RootProps): { header: PageLine[]; footer: PageLine[] } {
  const classification = (root.classification || "").trim();
  const mark: PageLine[] = classification ? [{ text: classification, align: "center", bold: true }] : [];
  const f = root.footer ?? DEFAULT_ROOT_PROPS.footer;
  const footer: PageLine[] = [];
  if (f.show !== false) {
    const text = (f.text || "").trim();
    if (text) footer.push({ text, align: f.textAlign || "center" });
    if (f.pageNumbers) footer.push({ text: pageNumberTemplate(f.pageNumberStyle), align: f.pageNumberAlign || "center" });
  }
  return { header: mark, footer: [...footer, ...mark] };
}
