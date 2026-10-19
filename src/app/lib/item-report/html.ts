// Print HTML shell (ported from ticketflow lib/pdf/html.ts).
//
// Wraps the Puck-rendered body in a full `<html dir="rtl">` document with:
//   - the bundled Rubik font INLINED as base64 @font-face (read off disk at
//     runtime) so Chromium needs zero network access — the system is air-gapped.
//   - the shared report stylesheet (pdf-styles).
//   - an @page rule that owns A4 size + margins.
//
// Server-only (uses `fs`).

import fs from "fs";
import path from "path";
import { PDF_CSS } from "./pdf-styles";

// The variable font carries every weight in one file (300–900). Read from
// public/fonts — the copy of src/app/fonts that the standalone image keeps
// (src/ is not in it). If a file is missing the report silently drops to
// Arial, so a missing font is logged.
const FONT_FILES = [
  { file: "Rubik-VariableFont_wght.ttf", style: "normal" },
  { file: "Rubik-Italic-VariableFont_wght.ttf", style: "italic" },
];

let cachedFontCss: string | null = null;

export function getFontFaceCss(): string {
  if (cachedFontCss !== null) return cachedFontCss;
  const dir = path.join(process.cwd(), "public", "fonts");
  const parts: string[] = [];
  for (const f of FONT_FILES) {
    try {
      const bytes = fs.readFileSync(path.join(dir, f.file));
      parts.push(
        `@font-face{font-family:'Rubik';font-style:${f.style};font-weight:300 900;` +
          `src:url(data:font/ttf;base64,${bytes.toString("base64")}) format('truetype')}`,
      );
    } catch (e) {
      console.error(`[item-report] font ${f.file} not found in public/fonts — reports fall back to Arial`, e);
    }
  }
  cachedFontCss = parts.join("");
  return cachedFontCss;
}

export interface BuildHtmlOptions {
  /** Page margins (mm). */
  marginMm?: { top: number; right: number; bottom: number; left: number };
  /** Embedded as the PDF's /Title (the browser tab title of the opened PDF). */
  title?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildHtml(bodyHtml: string, opts: BuildHtmlOptions = {}): string {
  const m = opts.marginMm ?? { top: 14, right: 16, bottom: 14, left: 16 };
  const titleTag = opts.title ? `<title>${escapeHtml(opts.title)}</title>` : "";
  return (
    `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"/>${titleTag}` +
    `<style>${getFontFaceCss()}\n` +
    `@page{size:A4;margin:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;}\n` +
    `html,body{margin:0;padding:0;background:#fff;}\n` +
    `${PDF_CSS}</style></head><body>${bodyHtml}</body></html>`
  );
}
