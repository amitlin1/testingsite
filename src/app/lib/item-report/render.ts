// Headless-Chromium PDF renderer.
//
// Takes the print HTML (from `html.ts`) and produces an A4 PDF via
// puppeteer-core. A single browser instance is stashed on `globalThis` and
// reused across renders (Next.js hot-reload + repeated requests) to avoid the
// per-render launch cost.
//
// Chromium binary: `PUPPETEER_EXECUTABLE_PATH` (dev → local Chrome; prod →
// /usr/bin/chromium installed in the Dockerfile runner stage). Server-only.

import puppeteer, { type Browser } from "puppeteer-core";
import { getFontFaceCss } from "./html";
import { FONT_STACK, type ReportFont } from "./fonts";

export type PageLine = { text: string; align: "right" | "center" | "left"; bold?: boolean };

export interface RenderPdfOptions {
  /** Lines printed at the top of EVERY page (the classification marking). */
  headerLines?: PageLine[];
  /** Lines printed at the bottom of every page, top to bottom, each with its
   *  own alignment. `{page}` / `{pages}` become the live page number / total. */
  footerLines?: PageLine[];
  /** The document font — Chromium's header/footer render in their own context,
   *  without the page's @font-face, so the font is inlined there too. */
  font?: ReportFont;
}

const globalForPdf = globalThis as unknown as {
  __pdfBrowser?: Promise<Browser>;
};

function executablePath(): string {
  const p = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!p) {
    throw new Error(
      "PUPPETEER_EXECUTABLE_PATH is not set — point it at a Chrome/Chromium binary.",
    );
  }
  return p;
}

async function getBrowser(): Promise<Browser> {
  if (!globalForPdf.__pdfBrowser) {
    globalForPdf.__pdfBrowser = puppeteer
      .launch({
        executablePath: executablePath(),
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--font-render-hinting=none",
        ],
      })
      .catch((e) => {
        globalForPdf.__pdfBrowser = undefined;
        throw e;
      });
  }
  const browser = await globalForPdf.__pdfBrowser;
  // If a prior browser died, relaunch.
  if (!browser.connected) {
    globalForPdf.__pdfBrowser = undefined;
    return getBrowser();
  }
  return browser;
}

// Open a page, retrying once if the pooled browser turned out to be dead
// ("Connection closed" / "Target closed") — hardens against a stale singleton.
async function newPage() {
  try {
    return await (await getBrowser()).newPage();
  } catch {
    globalForPdf.__pdfBrowser = undefined;
    return await (await getBrowser()).newPage();
  }
}

function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function renderPdf(
  html: string,
  opts: RenderPdfOptions = {},
): Promise<Buffer> {
  const page = await newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });

    const header = opts.headerLines ?? [];
    const footer = opts.footerLines ?? [];
    if (header.length > 0 || footer.length > 0) {
      // Chromium's header/footer render in their own context WITHOUT the
      // page's @font-face, so the font is inlined here too (otherwise Hebrew
      // falls back to a system font). {page}/{pages} → live spans.
      const lines = (ls: PageLine[]) =>
        ls
          .map((l) => {
            const inner = escapeHtml(l.text)
              .replace(/\{page\}/g, '<span class="pageNumber"></span>')
              .replace(/\{pages\}/g, '<span class="totalPages"></span>');
            return `<div style="width:100%;text-align:${l.align};${l.bold ? "font-weight:700;font-size:11px;letter-spacing:.5px;color:#000;" : ""}">${inner}</div>`;
          })
          .join("");
      const font = opts.font ?? "david";
      const box = (inner: string) =>
        `<style>${getFontFaceCss(font)}</style>` +
        `<div style="width:100%;font-family:${FONT_STACK[font].replace(/"/g, "'")};font-size:9px;` +
        `line-height:1.4;direction:rtl;color:#333;padding:0 16mm;">${inner}</div>`;
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: header.length > 0 ? box(lines(header)) : "<div></div>",
        footerTemplate: footer.length > 0 ? box(lines(footer)) : "<div></div>",
        margin: { top: header.length > 0 ? "16mm" : "14mm", right: "16mm", bottom: "18mm", left: "16mm" },
      });
      return Buffer.from(pdf);
    }

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true, // honor the @page rule in html.ts
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Optional: full-page PNG screenshot of the rendered HTML (used for visual
 *  verification of fidelity; not used in the production PDF path). */
export async function renderScreenshot(
  html: string,
  widthPx = 794, // ~A4 width at 96dpi
): Promise<Buffer> {
  const page = await newPage();
  try {
    await page.setViewport({ width: widthPx, height: 1123, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load" });
    const shot = await page.screenshot({ fullPage: true, type: "png" });
    return Buffer.from(shot);
  } finally {
    await page.close().catch(() => {});
  }
}
