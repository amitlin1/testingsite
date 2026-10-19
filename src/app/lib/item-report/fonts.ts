/**
 * The report fonts. Pure — the editor and the server share these names, so the
 * canvas and the PDF use the same face.
 *
 *   david  David Libre (SIL OFL, public/fonts/david-libre) — the David face of
 *          official Israeli documents. The default.
 *   rubik  Rubik (public/fonts) — the app's own font.
 *
 * The server inlines the files as data: URLs (html.ts — Chromium needs no
 * network); the editor page loads the same files from /fonts.
 */

export type ReportFont = "david" | "rubik";

export const REPORT_FONT_OPTIONS: { label: string; value: ReportFont }[] = [
  { label: "דוד (מסמך רשמי)", value: "david" },
  { label: "רוביק", value: "rubik" },
];

export const FONT_STACK: Record<ReportFont, string> = {
  david: "'David Libre', 'David', 'Times New Roman', serif",
  rubik: "'Rubik', Arial, sans-serif",
};

export function fontOf(v: unknown): ReportFont {
  return v === "rubik" ? "rubik" : "david";
}

const HEBREW = "U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F";
const LATIN =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

export interface FontFile {
  family: string;
  /** Path under public/ ("fonts/…"). */
  file: string;
  format: "woff2" | "truetype";
  weight: string;
  style: "normal" | "italic";
  range?: string;
}

export const FONT_FILES: FontFile[] = [
  { family: "David Libre", file: "fonts/david-libre/david-libre-hebrew-400-normal.woff2", format: "woff2", weight: "400", style: "normal", range: HEBREW },
  { family: "David Libre", file: "fonts/david-libre/david-libre-hebrew-700-normal.woff2", format: "woff2", weight: "700", style: "normal", range: HEBREW },
  { family: "David Libre", file: "fonts/david-libre/david-libre-latin-400-normal.woff2", format: "woff2", weight: "400", style: "normal", range: LATIN },
  { family: "David Libre", file: "fonts/david-libre/david-libre-latin-700-normal.woff2", format: "woff2", weight: "700", style: "normal", range: LATIN },
  { family: "Rubik", file: "fonts/Rubik-VariableFont_wght.ttf", format: "truetype", weight: "300 900", style: "normal" },
  { family: "Rubik", file: "fonts/Rubik-Italic-VariableFont_wght.ttf", format: "truetype", weight: "300 900", style: "italic" },
];

/** @font-face rules; `src` maps a font file to its URL (data: on the server, /fonts in the editor). */
export function fontFaceRules(files: readonly FontFile[], src: (f: FontFile) => string): string {
  return files
    .map(
      (f) =>
        `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:block;` +
        `src:url(${src(f)}) format('${f.format}')${f.range ? `;unicode-range:${f.range}` : ""}}`,
    )
    .join("\n");
}
