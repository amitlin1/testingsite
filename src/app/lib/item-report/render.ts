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

export interface RenderPdfOptions {
  /** When set, every page gets a footer built from these lines (top to bottom),
   *  each with its own alignment. `{page}` / `{pages}` tokens are replaced by
   *  the live page number / total. Rendered RTL in Rubik. */
  footerLines?: { text: string; align: "right" | "center" | "left" }[];
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

export async function renderPdf(
  html: string,
  opts: RenderPdfOptions = {},
): Promise<Buffer> {
  const page = await newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });

    if (opts.footerLines && opts.footerLines.length > 0) {
      // Chromium's footer renders in its own context WITHOUT the page's
      // @font-face, so inline Rubik here too (otherwise Hebrew page numbers
      // fall back to a non-Hebrew system font). {page}/{pages} → live spans.
      // Each line is its own <div> with its own alignment (text line, then the
      // page-number line beneath it).
      const linesHtml = opts.footerLines
        .map((l) => {
          const inner = l.text
            .replace(/\{page\}/g, '<span class="pageNumber"></span>')
            .replace(/\{pages\}/g, '<span class="totalPages"></span>');
          return `<div style="width:100%;text-align:${l.align};">${inner}</div>`;
        })
        .join("");
      const footerTemplate =
        `<style>${getFontFaceCss()}</style>` +
        `<div style="width:100%;font-family:'Rubik',Arial,sans-serif;font-size:9px;` +
        `line-height:1.4;direction:rtl;color:#444;padding:0 16mm;">${linesHtml}</div>`;
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate,
        margin: { top: "14mm", right: "16mm", bottom: "18mm", left: "16mm" },
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
