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

export const REPORT_FONTS: Record<ReportFont, { family: string; stack: string; label: string }> = {
  david: { family: "David Libre", stack: "'David Libre', 'David', 'Times New Roman', serif", label: "דוד (מסמך רשמי)" },
  rubik: { family: "Rubik", stack: "'Rubik', Arial, sans-serif", label: "רוביק" },
};

export const DEFAULT_FONT: ReportFont = "david";

export function fontOf(v: unknown): ReportFont {
  return v === "rubik" ? "rubik" : DEFAULT_FONT;
}

const HEBREW = "U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F";
const LATIN =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

export interface FontFile {
  font: ReportFont;
  /** Path under public/ ("fonts/…"). */
  file: string;
  format: "woff2" | "truetype";
  weight: string;
  style: "normal" | "italic";
  range?: string;
}

export const FONT_FILES: FontFile[] = [
  { font: "david", file: "fonts/david-libre/david-libre-hebrew-400-normal.woff2", format: "woff2", weight: "400", style: "normal", range: HEBREW },
  { font: "david", file: "fonts/david-libre/david-libre-hebrew-700-normal.woff2", format: "woff2", weight: "700", style: "normal", range: HEBREW },
  { font: "david", file: "fonts/david-libre/david-libre-latin-400-normal.woff2", format: "woff2", weight: "400", style: "normal", range: LATIN },
  { font: "david", file: "fonts/david-libre/david-libre-latin-700-normal.woff2", format: "woff2", weight: "700", style: "normal", range: LATIN },
  { font: "rubik", file: "fonts/Rubik-VariableFont_wght.ttf", format: "truetype", weight: "300 900", style: "normal" },
  { font: "rubik", file: "fonts/Rubik-Italic-VariableFont_wght.ttf", format: "truetype", weight: "300 900", style: "italic" },
];

/** @font-face rules; `src` maps a font file to its URL (data: on the server, /fonts in the editor). */
export function fontFaceRules(files: readonly FontFile[], src: (f: FontFile) => string): string {
  return files
    .map(
      (f) =>
        `@font-face{font-family:'${REPORT_FONTS[f.font].family}';font-style:${f.style};font-weight:${f.weight};font-display:block;` +
        `src:url(${src(f)}) format('${f.format}')${f.range ? `;unicode-range:${f.range}` : ""}}`,
    )
    .join("\n");
}
