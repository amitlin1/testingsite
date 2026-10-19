/**
 * Item report — gather an item's details + every station result, render the
 * route's template to PDF via Chromium, and own the FREEZE.
 *
 * Ported from ticketflow's generateTicketPdf (src/lib/pdf/generate.ts), whose
 * README explains why the final document is stored and never re-rendered: it is
 * the record of what the item went through AT THE TIME it finished — worker
 * names, the template, logos can all change later.
 *
 * Lifecycle (docs/ITEM_REPORTS.md):
 *   in route            → every download renders a live DRAFT (not stored)
 *   finished, template
 *     wants a signature → still a draft, the signature spot marked, until
 *                         someone signs (signItemReport)
 *   finished (+ signed) → FINAL: rendered once, stored in MinIO, then served
 *                         byte-for-byte (item_reports.storage_key)
 * The final copy is valid only while item_routes.finished_at equals the
 * finished_at it was frozen against (item_reports.route_finished_at). A
 * reopened or retyped item (finished_at cleared, or a new one) no longer
 * matches, so it is a draft again and its next finish freezes a new copy — no
 * reopen path has to remember to clean up here.
 *
 * Server-only.
 */
import { randomUUID } from "crypto";
import type { Data } from "@measured/puck";
import { prisma } from "@/app/lib/prisma";
import { formatReportDate } from "@/app/components/reports/reportTheme";
import { contentTypeFromName, getObjectBuffer, putObject, removeObject } from "@/lib/storage";
import { registerFileObject, markFileObjectDeleted } from "@/lib/file-registry";
import { buildHtml } from "./html";
import { renderPdf } from "./render";
import { renderTemplateBody } from "./render-react";
import { DEFAULT_ROOT_PROPS, pageNumberTemplate } from "./puck-config";
import { collectLogoKeys, isTemplate, requiresFinalSignature, templateHasContent, templateUsesPhotos } from "./template-utils";
import { buildStepResults, buildValues, fieldOrderOf } from "./variables";
import { parseRouteFieldsConfig } from "@/app/lib/station-fields/validate";
import type { RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import type { ResultRow } from "./variables";
import { FINAL_SIGNATURE_BIND } from "./types";
import type { ReportRenderMeta, ReportSignerInfo, ReportStepResult } from "./types";

// ---------------------------------------------------------------- storage keys

export const ReportKeys = {
  pdf: (itemId: bigint, version: number) => `reports/items/${itemId}/v${version}.pdf`,
  signature: (itemId: bigint) => `reports/items/${itemId}/signature-${randomUUID()}.png`,
  logo: (ext: string) => `reports/logos/${randomUUID()}.${ext}`,
  LOGO_PREFIX: "reports/logos/",
};

// ---------------------------------------------------------------- helpers

const sameInstant = (a: Date | null | undefined, b: Date | null | undefined): boolean =>
  !!a && !!b && a.getTime() === b.getTime();

function splitDate(iso: string): { date: string; time: string } {
  const full = formatReportDate(iso, true); // "dd.mm.yyyy · HH:mm"
  const [date = "", time = ""] = full.split(" · ");
  return { date, time };
}

async function dataUrlOf(key: string): Promise<string | null> {
  try {
    const buf = await getObjectBuffer(key);
    const type = key.toLowerCase().endsWith(".svg") ? "image/svg+xml" : contentTypeFromName(key);
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch (e) {
    console.error(`[item-report] object ${key} could not be read — it renders blank`, e);
    return null;
  }
}

const trimOrEmpty = (v: unknown): string => (v == null ? "" : String(v).trim());

// ---------------------------------------------------------------- loading

type ItemFacts = {
  item_id: bigint;
  serial_no: string | null;
  makat: string;
  model: string;
  manufacturer_name: string;
  manufacturer_no: string;
  package_id: bigint | null;
  package_seq: number | null;
  item_type_id: number;
  item_type: string | null;
  customer: string | null;
  shipment_code: string | null;
  package_type: string | null;
  route_number: number;
  created_at: Date;
  finished_at: Date | null;
  status: string | null;
};

export type ReportSource = {
  item: ItemFacts;
  route: { test_route_id: number; route_number: number; route_steps: number[]; step_uids: string[] } | null;
  template: Data | null;
  rows: ResultRow[];
  /** step uid → field ids in the order of the field config the rows were saved with. */
  fieldOrder?: Map<string, string[]>;
};

async function loadItem(itemId: bigint): Promise<ItemFacts | null> {
  const rows = await prisma.$queryRaw<ItemFacts[]>`
    SELECT i.item_id, i.serial_no, i.makat, TRIM(i.model) AS model,
           TRIM(i.manufacturer_name) AS manufacturer_name, i.manufacturer_no,
           i.package_id, i.package_seq::int AS package_seq,
           ir.item_type_id, TRIM(t.item_type_desc) AS item_type,
           TRIM(c.name) AS customer, s.shipment_code,
           TRIM(pt.item_type_desc) AS package_type,
           ir.route_number, ir.created_at, ir.finished_at,
           TRIM(st.item_status_desc) AS status
      FROM items i
      JOIN item_routes ir ON ir.item_id = i.item_id
      LEFT JOIN item_types t ON t.item_type_id = ir.item_type_id
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN shipments s ON s.id = i.shipment_id
      LEFT JOIN items p ON p.item_id = i.package_id
      LEFT JOIN item_types pt ON pt.item_type_id = p.item_type_id
      LEFT JOIN item_status st ON st.item_status_id = ir.current_status
     WHERE i.item_id = ${itemId}`;
  return rows[0] ?? null;
}

async function loadRows(itemId: bigint): Promise<ResultRow[]> {
  const rows = await prisma.$queryRaw<(Omit<ResultRow, "created_at"> & { created_at: Date })[]>`
    SELECT tr.test_result_id, tr.route_number, tr.route_step,
           COALESCE(TRIM(ts.test_station_desc), '') AS station,
           COALESCE(TRIM(tst.test_type_desc), '') AS station_type,
           COALESCE(ts.is_research, false) AS station_is_research,
           tr.worker_id, e.worker_name, tr.passed, tr.result, tr.comments, tr.details, tr.created_at
      FROM test_results tr
      LEFT JOIN test_stations ts ON ts.test_station_id = tr.test_station_id
      LEFT JOIN test_stations_type tst ON tst.test_station_type_id = tr.test_station_type_id
      LEFT JOIN item_state_event e ON e.event_id = tr.state_event_id
     WHERE tr.item_id = ${itemId}
     ORDER BY tr.created_at, tr.test_result_id`;
  const out = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  // The ledger keeps the worker's name as it was; rows written without one
  // fall back to today's directory (best-effort — a deleted user stays "#id").
  if (out.some((r) => !r.worker_name && r.worker_id != null)) {
    try {
      const { getWorkersDirectory } = await import("@/lib/keycloak-admin");
      const names = new Map((await getWorkersDirectory()).map((w) => [w.worker_id, w.worker_name]));
      for (const r of out) if (!r.worker_name && r.worker_id != null) r.worker_name = names.get(r.worker_id) ?? null;
    } catch (e) {
      console.error("[item-report] workers directory unavailable — worker ids print as #id", e);
    }
  }
  return out;
}

/** The route an item runs, and that route's report template. */
async function loadRouteAndTemplate(item: ItemFacts) {
  const route = await prisma.testing_routes.findFirst({
    where: { item_type_id: item.item_type_id, route_number: item.route_number },
    orderBy: { test_route_id: "asc" },
    select: { test_route_id: true, route_number: true, route_steps: true, step_uids: true, report_template: { select: { template: true } } },
  });
  const raw = route?.report_template?.template;
  return {
    route: route ? { test_route_id: route.test_route_id, route_number: route.route_number, route_steps: route.route_steps, step_uids: route.step_uids } : null,
    template: isTemplate(raw) ? (raw as unknown as Data) : null,
  };
}

/** `rows: false` skips the results (status checks need only the item + template). */
export async function loadReportSource(itemId: bigint, opts: { rows?: boolean } = {}): Promise<ReportSource | null> {
  const item = await loadItem(itemId);
  if (!item) return null;
  if (opts.rows === false) return { item, ...(await loadRouteAndTemplate(item)), rows: [] };
  const [{ route, template }, rows] = await Promise.all([loadRouteAndTemplate(item), loadRows(itemId)]);
  return { item, route, template, rows, fieldOrder: await loadFieldOrder(rows) };
}

/** The field configs the rows were saved against (details.schema {route_id, v}). */
async function loadFieldOrder(rows: readonly ResultRow[]): Promise<Map<string, string[]>> {
  const refs = new Map<string, { route_id: number; v: number }>();
  for (const r of rows) {
    const sc = (r.details as { schema?: { route_id?: unknown; v?: unknown } } | null)?.schema;
    if (typeof sc?.route_id === "number" && typeof sc.v === "number") refs.set(`${sc.route_id}:${sc.v}`, { route_id: sc.route_id, v: sc.v });
  }
  if (refs.size === 0) return new Map();
  const versions = await prisma.route_field_versions.findMany({
    where: { OR: [...refs.values()].map((x) => ({ test_route_id: x.route_id, version: x.v })) },
    select: { config: true },
    orderBy: { version: "desc" },
  });
  const configs: RouteFieldsConfig[] = [];
  for (const v of versions) {
    try {
      configs.push(parseRouteFieldsConfig(v.config));
    } catch {
      /* an unreadable config → that step keeps the saved order */
    }
  }
  return fieldOrderOf(configs);
}

// ---------------------------------------------------------------- html

export function itemValues(item: ItemFacts): Record<string, string> {
  return {
    item_id: String(item.item_id),
    serial_no: trimOrEmpty(item.serial_no),
    makat: trimOrEmpty(item.makat),
    model: trimOrEmpty(item.model),
    manufacturer_name: trimOrEmpty(item.manufacturer_name),
    manufacturer_no: trimOrEmpty(item.manufacturer_no),
    item_type: trimOrEmpty(item.item_type),
    customer: trimOrEmpty(item.customer),
    shipment_code: trimOrEmpty(item.shipment_code),
    package_id: item.package_id != null ? String(item.package_id) : "",
    package_type: trimOrEmpty(item.package_type),
    package_seq: item.package_seq != null ? String(item.package_seq).padStart(2, "0") : "",
    route_number: String(item.route_number),
    status: trimOrEmpty(item.status),
    created_at: formatReportDate(item.created_at),
    finished_at: item.finished_at ? formatReportDate(item.finished_at) : "",
  };
}

/** Step results of the source (the kit's package-level rows included). */
export function stepResultsOf(src: ReportSource): ReportStepResult[] {
  if (!src.route) return [];
  const kitUids = new Set<string>();
  for (const r of src.rows) {
    const d = r.details as { schema?: { step_uid?: unknown; target?: unknown } } | null;
    if (d?.schema?.target === "kit_item" && typeof d.schema.step_uid === "string") kitUids.add(d.schema.step_uid);
  }
  return buildStepResults(src.rows, src.route, splitDate, kitUids, src.fieldOrder);
}

type Signature = { key: string; name: string; number: string; at: Date } | null;

export interface BuiltReport {
  html: string;
  footerLines?: { text: string; align: "right" | "center" | "left" }[];
  filename: string;
}

/**
 * The print HTML of an item's report. `signature` is the valid final signature
 * (or null); `draft` prints the "טיוטה" mark and highlights the unsigned spot.
 */
export async function buildReportHtml(
  src: ReportSource,
  opts: { draft: boolean; signature: Signature; values?: Record<string, string> },
): Promise<BuiltReport> {
  const template = src.template!;
  const results = stepResultsOf(src);
  const sig = opts.signature;
  const values = opts.values ?? buildValues(itemValues(src.item), results, {
    generated_at: formatReportDate(new Date()),
    signer: sig?.name ?? "",
    signed_at: sig ? formatReportDate(sig.at) : "",
  });

  // Photos: only when the template prints them.
  const photos: Record<string, string> = {};
  if (templateUsesPhotos(template)) {
    const keys = [...new Set(results.flatMap((r) => r.fields.flatMap((f) => f.photos ?? [])))];
    await Promise.all(keys.map(async (k) => {
      const url = await dataUrlOf(k);
      if (url) photos[k] = url;
    }));
  }

  const logos = await logosOf(template);

  const signatures: Record<string, string> = {};
  const signerMeta: Record<string, ReportSignerInfo> = {};
  if (sig) {
    const url = await dataUrlOf(sig.key);
    if (url) signatures[FINAL_SIGNATURE_BIND] = url;
    signerMeta[FINAL_SIGNATURE_BIND] = { fullName: sig.name, number: sig.number, date: formatReportDate(sig.at) };
  }
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
    highlightBind: opts.draft && !sig ? FINAL_SIGNATURE_BIND : undefined,
  };

  const body = await renderTemplateBody(template, meta);
  const root = { ...DEFAULT_ROOT_PROPS, ...((template.root?.props ?? {}) as object) } as typeof DEFAULT_ROOT_PROPS;
  const border = root.border;
  const marginMm = border && border !== "none" ? { top: 0, right: 0, bottom: 0, left: 0 } : undefined;
  const title = `דוח פריט ${src.item.item_id}${opts.draft ? " (טיוטה)" : ""}`;
  const html = buildHtml(body, { marginMm, title });

  const f = root.footer ?? DEFAULT_ROOT_PROPS.footer;
  const footerLines: { text: string; align: "right" | "center" | "left" }[] = [];
  if (f.show !== false) {
    const txt = (f.text || "").trim();
    if (txt) footerLines.push({ text: txt, align: f.textAlign || "center" });
    if (f.pageNumbers) footerLines.push({ text: pageNumberTemplate(f.pageNumberStyle), align: f.pageNumberAlign || "center" });
  }
  return {
    html,
    footerLines: footerLines.length ? footerLines : undefined,
    filename: `item-${src.item.item_id}${opts.draft ? "-draft" : ""}.pdf`,
  };
}

async function bundledLogo(publicPath: string): Promise<string | null> {
  const { readFile } = await import("fs/promises");
  const path = await import("path");
  const rel = publicPath.replace(/^\/+/, "");
  if (rel.includes("..")) return null;
  try {
    const buf = await readFile(path.join(process.cwd(), "public", rel));
    return `data:${contentTypeFromName(rel)};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- status

export type ReportState =
  | "no_template"   // the item's route has no report template
  | "in_progress"   // a live draft
  | "awaiting_signature" // finished, the template wants a signature, not signed yet
  | "final";        // finished (+ signed): the stored document

export interface ReportStatus {
  state: ReportState;
  finished: boolean;
  needsSignature: boolean;
  signedBy: string | null;
  signedAt: string | null;
  version: number;
}

async function loadReportRow(itemId: bigint) {
  return prisma.item_reports.findUnique({ where: { item_id: itemId } });
}

type ReportRow = NonNullable<Awaited<ReturnType<typeof loadReportRow>>>;

function validSignature(row: ReportRow | null, finishedAt: Date | null): Signature {
  if (!row?.signature_key || !row.signed_at || !sameInstant(row.signed_finished_at, finishedAt)) return null;
  return { key: row.signature_key, name: row.signed_by_name ?? row.signed_by ?? "", number: row.signed_by_number ?? "", at: row.signed_at };
}

function stateOf(src: ReportSource, row: ReportRow | null): ReportStatus {
  const finished = src.item.finished_at != null;
  const hasTemplate = !!src.template && templateHasContent(src.template);
  const needsSignature = hasTemplate && requiresFinalSignature(src.template);
  const sig = validSignature(row, src.item.finished_at);
  const state: ReportState = !hasTemplate
    ? "no_template"
    : !finished
      ? "in_progress"
      : needsSignature && !sig
        ? "awaiting_signature"
        : "final";
  const frozen = row?.storage_key && sameInstant(row.route_finished_at, src.item.finished_at);
  return {
    state,
    finished,
    needsSignature,
    signedBy: sig?.name ?? null,
    signedAt: sig ? sig.at.toISOString() : null,
    version: frozen ? row!.version : 0,
  };
}

export async function getReportStatus(itemId: bigint): Promise<ReportStatus | null> {
  const src = await loadReportSource(itemId, { rows: false });
  if (!src) return null;
  return stateOf(src, await loadReportRow(itemId));
}

// ---------------------------------------------------------------- the document

export type ReportDocument =
  | { kind: "not_found" }
  | { kind: "no_template" }
  | { kind: "pdf"; bytes: Buffer; final: boolean; version: number; filename: string };

/** Render, store and point at the final copy. */
async function freeze(src: ReportSource, row: ReportRow | null, sig: Signature): Promise<{ bytes: Buffer; version: number }> {
  const built = await buildReportHtml(src, { draft: false, signature: sig });
  const bytes = await renderPdf(built.html, { footerLines: built.footerLines });
  const itemId = src.item.item_id;
  const version = (row?.version ?? 0) + 1;
  const key = ReportKeys.pdf(itemId, version);
  const stored = await putObject(key, bytes, "application/pdf");
  await prisma.item_reports.upsert({
    where: { item_id: itemId },
    create: { item_id: itemId, storage_key: key, size_bytes: BigInt(stored.size), version, generated_at: new Date(), route_finished_at: src.item.finished_at },
    update: { storage_key: key, size_bytes: BigInt(stored.size), version, generated_at: new Date(), route_finished_at: src.item.finished_at },
  });
  void registerFileObject({
    objectKey: key, fileName: built.filename, contentType: "application/pdf", sizeBytes: stored.size,
    checksum: stored.checksum, entityType: "item_report", entityId: String(itemId),
  });
  // Only the latest version is pointed at — drop the previous blob (the
  // bucket is versioned, so it is still recoverable from MinIO).
  if (row?.storage_key && row.storage_key !== key) {
    await removeObject(row.storage_key).catch(() => {});
    void markFileObjectDeleted(row.storage_key);
  }
  return { bytes, version };
}

/**
 * The report of an item: the stored final copy when there is a valid one, a
 * fresh final copy when the item has just become final, else a live draft.
 * `force` re-renders the final copy (lost-blob recovery only).
 */
export async function getItemReport(itemId: bigint, opts: { force?: boolean } = {}): Promise<ReportDocument> {
  // The results are read only when something is rendered — a frozen copy
  // needs the item and its template alone.
  const head = await loadReportSource(itemId, { rows: false });
  if (!head) return { kind: "not_found" };
  if (!head.template || !templateHasContent(head.template)) return { kind: "no_template" };
  const row = await loadReportRow(itemId);
  const status = stateOf(head, row);
  const sig = validSignature(row, head.item.finished_at);
  const full = async (): Promise<ReportSource> => (await loadReportSource(itemId)) ?? head;

  if (status.state === "final") {
    const frozen = row?.storage_key && sameInstant(row.route_finished_at, head.item.finished_at);
    if (frozen && !opts.force) {
      try {
        const bytes = await getObjectBuffer(row!.storage_key!);
        return { kind: "pdf", bytes, final: true, version: row!.version, filename: `item-${itemId}.pdf` };
      } catch (e) {
        // The stored blob is gone: rebuild once from current data rather
        // than 404 forever — the only path that re-renders a final report.
        console.error(`[item-report] stored report of item ${itemId} is missing — rebuilding`, e);
      }
    }
    const { bytes, version } = await freeze(await full(), row, sig);
    return { kind: "pdf", bytes, final: true, version, filename: `item-${itemId}.pdf` };
  }

  const built = await buildReportHtml(await full(), { draft: true, signature: sig });
  const bytes = await renderPdf(built.html, { footerLines: built.footerLines });
  return { kind: "pdf", bytes, final: false, version: 0, filename: built.filename };
}

/** The live HTML of the report (the signing dialog's preview). */
export async function getItemReportHtml(itemId: bigint): Promise<string | null> {
  const src = await loadReportSource(itemId);
  if (!src?.template || !templateHasContent(src.template)) return null;
  const row = await loadReportRow(itemId);
  const status = stateOf(src, row);
  const built = await buildReportHtml(src, { draft: status.state !== "final", signature: validSignature(row, src.item.finished_at) });
  return built.html;
}

/**
 * Freeze the report the moment the item finishes its route (called after the
 * last result is saved). Best-effort: a failure here never blocks the result —
 * the first download produces the final copy instead.
 */
export async function freezeReportIfFinal(itemId: bigint): Promise<void> {
  try {
    // Cheap gate first — this runs after EVERY result submit.
    const route = await prisma.item_routes.findUnique({ where: { item_id: itemId }, select: { finished_at: true } });
    if (!route?.finished_at) return;
    const row = await loadReportRow(itemId);
    if (row?.storage_key && sameInstant(row.route_finished_at, route.finished_at)) return;
    const src = await loadReportSource(itemId);
    if (!src?.template || !templateHasContent(src.template)) return;
    if (stateOf(src, row).state !== "final") return;
    if (row?.storage_key && sameInstant(row.route_finished_at, src.item.finished_at)) return;
    await freeze(src, row, validSignature(row, src.item.finished_at));
  } catch (e) {
    console.error(`[item-report] freezing the report of item ${itemId} failed — it will be built on first download`, e);
  }
}

export class ReportSignError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/**
 * Sign a finished item's report: store the drawn signature and freeze the
 * document with it. Only once per finish — a reopened item that finishes again
 * needs a new signature.
 */
export async function signItemReport(
  itemId: bigint,
  png: Buffer,
  signer: { username: string; name: string; number: string },
): Promise<{ version: number }> {
  const src = await loadReportSource(itemId);
  if (!src) throw new ReportSignError(404, "NOT_FOUND", "Item not found");
  const row = await loadReportRow(itemId);
  const status = stateOf(src, row);
  if (status.state === "no_template") throw new ReportSignError(409, "NO_TEMPLATE", "The item's route has no report template");
  if (!status.finished) throw new ReportSignError(409, "NOT_FINISHED", "The item has not finished its route");
  if (!status.needsSignature) throw new ReportSignError(409, "NO_SIGNATURE_BLOCK", "The template has no signature to sign");
  if (status.signedBy) throw new ReportSignError(409, "ALREADY_SIGNED", "The report is already signed");

  const key = ReportKeys.signature(itemId);
  const stored = await putObject(key, png, "image/png");
  void registerFileObject({
    objectKey: key, fileName: `signature-${itemId}.png`, contentType: "image/png", sizeBytes: stored.size,
    checksum: stored.checksum, entityType: "item_report_signature", entityId: String(itemId), createdBy: signer.username,
  });
  const at = new Date();
  const fields = {
    signature_key: key, signed_by: signer.username, signed_by_name: signer.name, signed_by_number: signer.number,
    signed_at: at, signed_finished_at: src.item.finished_at,
  };
  const next = await prisma.item_reports.upsert({
    where: { item_id: itemId },
    create: { item_id: itemId, ...fields },
    update: fields,
  });
  const { version } = await freeze(src, next, { key, name: signer.name || signer.username, number: signer.number, at });
  return { version };
}

// ---------------------------------------------------------------- editor preview

/**
 * A preview PDF of an UNSAVED template: with a real item's data when `itemId`
 * is given (any item — the editor offers the items of the route), else with
 * every variable showing its own label. Never stored.
 */
export async function previewTemplatePdf(
  template: Data,
  opts: { itemId?: bigint | null; sample: { vars: { name: string; label: string }[] } },
): Promise<Buffer | null> {
  if (opts.itemId != null) {
    const src = await loadReportSource(opts.itemId);
    if (!src) return null;
    const built = await buildReportHtml({ ...src, template }, { draft: true, signature: null });
    return renderPdf(built.html, { footerLines: built.footerLines });
  }
  const values = Object.fromEntries(opts.sample.vars.map((v) => [v.name, v.label]));
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
  const built = await buildReportHtml(src, { draft: true, signature: null, values });
  return renderPdf(built.html, { footerLines: built.footerLines });
}

async function logosOf(template: Data): Promise<Record<string, string>> {
  const logos: Record<string, string> = {};
  for (const key of collectLogoKeys(template)) {
    const url = await dataUrlOf(key);
    if (url) logos[key] = url;
  }
  const header = ((template.root as { props?: { header?: Record<string, unknown> } } | undefined)?.props?.header ?? {}) as Record<string, unknown>;
  for (const v of [header.rightLogo, header.leftLogo]) {
    if (typeof v === "string" && v.startsWith("/report-logos/")) {
      const url = await bundledLogo(v);
      if (url) logos[v] = url;
    }
  }
  return logos;
}
