/**
 * An item's report as print HTML and as a PDF: the template rendered with the
 * item's values, its results, its photos, its signatures and the header
 * logos — every image inlined as a data URL, so Chromium makes no network
 * call (the system is air-gapped). Server-only.
 */
import type { Data } from "@measured/puck";
import { readDataUrl, toDataUrl } from "@/lib/storage";
import { docDateParts, formatDocDate } from "@/app/lib/datetime";
import { buildHtml } from "./html";
import { renderPdf } from "./render";
import { reportPhotoDataUrls } from "./photos";
import { fontOf, type ReportFont } from "./fonts";
import { renderTemplateBody } from "./render-react";
import { isBundledLogo, pageChrome, rootPropsOf, type PageLine } from "./document";
import { headerLogos, requiresClosingSignature, templateUsesPhotos } from "./template-utils";
import { buildStepResults, buildValues, sampleValues, type GivenSignature } from "./variables";
import { CLOSING_SIGNATURE_BIND, FINAL_SIGNATURE_BIND } from "./types";
import type { ReportRenderMeta, ReportSignerInfo, ReportStepResult, ReportVar } from "./types";
import type { ReportSource } from "./source";

/** A given signature: its drawing in MinIO, who signed (name, number), when, and — a closing one — the
 *  signer's "בודק" / "מנהל" ("" when not kept: the final one, or a closing signature from before roles
 *  were kept). */
export type Signature = (GivenSignature & { key: string; number: string }) | null;

type BuiltReport = {
  html: string;
  font: ReportFont;
  headerLines?: PageLine[];
  footerLines?: PageLine[];
  filename: string;
};

/** An object as a data URL, or null (logged) when it cannot be read — it then renders blank. */
async function objectDataUrl(key: string): Promise<string | null> {
  try {
    return await readDataUrl(key);
  } catch (e) {
    console.error(`[item-report] object ${key} could not be read — it renders blank`, e);
    return null;
  }
}

/** A bundled emblem (public/report-logos) as a data URL, or null (logged) when it is not there. */
async function emblemDataUrl(publicPath: string): Promise<string | null> {
  const { readFile } = await import("fs/promises");
  const path = await import("path");
  const rel = publicPath.replace(/^\/+/, "");
  if (rel.includes("..")) return null;
  try {
    return toDataUrl(await readFile(path.join(process.cwd(), "public", rel)), rel);
  } catch (e) {
    console.error(`[item-report] emblem ${publicPath} not found in public/ — the header prints without it`, e);
    return null;
  }
}

/** The header's logos as data URLs: uploaded ones from MinIO, the bundled emblems from public/. */
async function logosOf(template: Data): Promise<Record<string, string>> {
  const logos: Record<string, string> = {};
  for (const v of headerLogos(template)) {
    const url = isBundledLogo(v) ? await emblemDataUrl(v) : await objectDataUrl(v);
    if (url) logos[v] = url;
  }
  return logos;
}

/** Step results of the source (the kit's package-level rows included). */
function stepResultsOf(src: ReportSource): ReportStepResult[] {
  if (!src.route) return [];
  return buildStepResults(src.rows, src.route, docDateParts, src.fieldOrder);
}

/**
 * The print HTML of an item's report. `signature` is the valid final signature
 * and `closingSignature` the valid closing one (or null); `draft` prints the
 * "טיוטה" mark and highlights the spot that waits for a signature. `values`
 * replaces the item's (the editor's preview without an item).
 */
export async function buildReportHtml(
  src: ReportSource,
  opts: { draft: boolean; signature: Signature; closingSignature?: Signature; values?: Record<string, string> },
): Promise<BuiltReport> {
  const template = src.template!;
  const results = stepResultsOf(src);
  const sig = opts.signature;
  const closingSig = opts.closingSignature ?? null;
  const values = opts.values ?? buildValues(
    { item: src.item, results, finished: src.item.finished_at != null },
    { generatedAt: new Date(), signature: sig, closingSignature: closingSig },
  );

  // Photos: only when the template prints them, each made small for the PDF (photos.ts).
  const photos: Record<string, string> = templateUsesPhotos(template)
    ? await reportPhotoDataUrls([...new Set(results.flatMap((r) => r.fields.flatMap((f) => f.photos ?? [])))])
    : {};

  const logos = await logosOf(template);

  const signatures: Record<string, string> = {};
  const signerMeta: Record<string, ReportSignerInfo> = {};
  for (const [bind, s] of [[FINAL_SIGNATURE_BIND, sig], [CLOSING_SIGNATURE_BIND, closingSig]] as const) {
    if (!s) continue;
    const url = await objectDataUrl(s.key);
    if (url) signatures[bind] = url;
    signerMeta[bind] = { fullName: s.name, number: s.number, date: formatDocDate(s.at), role: s.role ?? "" };
  }
  // The spot a draft waits for: the closing's while the item is still on its route (the closing
  // signs it), else the final one.
  const highlightBind = !opts.draft
    ? undefined
    : src.item.finished_at == null && !closingSig && requiresClosingSignature(template)
      ? CLOSING_SIGNATURE_BIND
      : !sig ? FINAL_SIGNATURE_BIND : undefined;
  for (const r of results) {
    signerMeta[`step:${r.uid}`] = { fullName: r.worker, number: r.workerNumber, date: r.date, station: r.station };
  }

  const meta: ReportRenderMeta = {
    mode: "print",
    vars: [],
    steps: [],
    values,
    results,
    photos,
    signatures,
    signerMeta,
    logos,
    draft: opts.draft,
    highlightBind,
    sample: opts.values != null,
  };

  const body = await renderTemplateBody(template, meta);
  const root = rootPropsOf(template);
  // A frame is drawn by the page itself (pdf-styles), so the @page margins go.
  const marginMm = root.border && root.border !== "none" ? { top: 0, right: 0, bottom: 0, left: 0 } : undefined;
  const title = `דוח פריט ${src.item.item_id}${opts.draft ? " (טיוטה)" : ""}`;
  const font = fontOf(root.font);
  const html = buildHtml(body, { marginMm, title, font });
  const { header, footer } = pageChrome(root);
  return {
    html,
    font,
    headerLines: header.length ? header : undefined,
    footerLines: footer.length ? footer : undefined,
    filename: `item-${src.item.item_id}${opts.draft ? "-draft" : ""}.pdf`,
  };
}

/** The report as a PDF (built, then rendered by Chromium). */
export async function renderReportPdf(
  src: ReportSource,
  opts: Parameters<typeof buildReportHtml>[1],
): Promise<{ bytes: Buffer; filename: string }> {
  const built = await buildReportHtml(src, opts);
  const bytes = await renderPdf(built.html, { headerLines: built.headerLines, footerLines: built.footerLines, font: built.font });
  return { bytes, filename: built.filename };
}

/**
 * A preview PDF of an UNSAVED template: with the source of a real item (any
 * item — the editor offers the items of the route), else with every variable
 * showing its own label. Never stored.
 */
export async function previewTemplatePdf(
  template: Data,
  opts: { src: ReportSource | null; vars: readonly ReportVar[] },
): Promise<Buffer> {
  if (opts.src) return (await renderReportPdf({ ...opts.src, template }, { draft: true, signature: null })).bytes;
  const src: ReportSource = {
    item: {
      item_id: BigInt(0), serial_no: null, makat: "", model: "", manufacturer_name: "", manufacturer_no: "",
      package_id: null, package_seq: null, item_type_id: 0, item_type: null, customer: null, shipment_code: null,
      package_type: null, route_number: 0, created_at: new Date(), finished_at: null, status: null,
    },
    route: null,
    template,
    rows: [],
  };
  return (await renderReportPdf(src, { draft: true, signature: null, values: sampleValues(opts.vars) })).bytes;
}
