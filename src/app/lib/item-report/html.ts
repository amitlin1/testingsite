// Print HTML shell (ported from ticketflow lib/pdf/html.ts).
//
// Wraps the Puck-rendered body in a full `<html dir="rtl">` document with:
//   - the report fonts INLINED as base64 @font-face (fonts.ts, read off
//     public/fonts at runtime) so Chromium needs zero network access — the
//     system is air-gapped.
//   - the shared report stylesheet (pdf-styles).
//   - an @page rule that owns A4 size + margins.
//
// Server-only (uses `fs`).

import fs from "fs";
import path from "path";
import { PDF_CSS } from "./pdf-styles";
import { FONT_FILES, fontFaceRules, type FontFile, type ReportFont } from "./fonts";

const cache = new Map<string, string>();

/** The @font-face rules of one font (or all), with the files inlined. Logged,
 *  not thrown, when a file is missing — the report then falls back to the
 *  next family of the stack. */
export function getFontFaceCss(font?: ReportFont): string {
  const key = font ?? "all";
  const hit = cache.get(key);
  if (hit != null) return hit;
  const family = font === "rubik" ? "Rubik" : font === "david" ? "David Libre" : null;
  const files = FONT_FILES.filter((f) => family == null || f.family === family);
  const present: FontFile[] = [];
  const data = new Map<FontFile, string>();
  for (const f of files) {
    try {
      data.set(f, fs.readFileSync(path.join(process.cwd(), "public", f.file)).toString("base64"));
      present.push(f);
    } catch (e) {
      console.error(`[item-report] font ${f.file} not found in public/ — reports fall back to the next font`, e);
    }
  }
  const css = fontFaceRules(present, (f) => `data:font/${f.format === "woff2" ? "woff2" : "ttf"};base64,${data.get(f)}`);
  cache.set(key, css);
  return css;
}

export interface BuildHtmlOptions {
  /** Page margins (mm). */
  marginMm?: { top: number; right: number; bottom: number; left: number };
  /** Embedded as the PDF's /Title (the browser tab title of the opened PDF). */
  title?: string;
  font?: ReportFont;
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
    `<style>${getFontFaceCss(opts.font)}\n` +
    `@page{size:A4;margin:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;}\n` +
    `html,body{margin:0;padding:0;background:#fff;}\n` +
    `${PDF_CSS}</style></head><body>${bodyHtml}</body></html>`
  );
}
