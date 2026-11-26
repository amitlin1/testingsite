/**
 * Item report lifecycle — the state of an item's report, its signatures, and
 * the FREEZE (docs/features/ITEM_REPORTS.md).
 *
 * Ported from ticketflow's generateTicketPdf (src/lib/pdf/generate.ts), whose
 * README explains why the final document is stored and never re-rendered: it is
 * the record of what the item went through AT THE TIME it finished — worker
 * names, the template, logos can all change later.
 *
 *   in route            → every download renders a live DRAFT (not stored)
 *   finished, template
 *     wants the final
 *     signature         → still a draft, the signature spot marked, until the
 *                         approver signs (signItemReport)
 *   finished (+ signed) → FINAL: rendered once, stored in MinIO, then served
 *                         byte-for-byte (item_reports.storage_key)
 * A template may also ask for a signature at the kit's closing
 * (signClosingSignature, with the closing result): it is printed, but never
 * holds the report back and never locks it — only the final one does.
 * The final copy is valid only while item_routes.finished_at equals the
 * finished_at it was frozen against (item_reports.route_finished_at). A
 * reopened or retyped item (finished_at cleared, or a new one) no longer
 * matches, so it is a draft again and its next finish freezes a new copy — no
 * reopen path has to remember to clean up here. A signature, likewise, counts
 * only for the finish it was given for.
 *
 * Server-only.
 */
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { getObjectBuffer, putObject, removeObject } from "@/lib/storage";
import { ReportKeys } from "@/lib/storage/keys";
import { registerFileObject, markFileObjectDeleted } from "@/lib/file-registry";
import { requiresClosingSignature, requiresFinalSignature, templateHasContent } from "./template-utils";
import { buildReportBody, buildReportHtml, renderCombinedPdf, renderReportPdf, type Signature } from "./build";
import { generalTemplateOnce, loadReportSource, templateOfRoute, type ReportSource } from "./source";
import { EXTERNAL_APPROVAL_KEY, failedStepRows, type ResultRow } from "./variables";
import { isRecord } from "@/lib/json-guards";
import { Prisma } from "@prisma/client";
import { closingBlocksExternalApproval, closingMissingAfterExternal, type ReportState, type ReportStatus } from "./contract";

async function loadReportRow(itemId: bigint) {
  return prisma.item_reports.findUnique({ where: { item_id: itemId } });
}

type ReportRow = NonNullable<Awaited<ReturnType<typeof loadReportRow>>>;

const sameInstant = (a: Date | null | undefined, b: Date | null | undefined): boolean =>
  !!a && !!b && a.getTime() === b.getTime();

/** A copy is stored for this finish: it is the final document whatever the template says now. */
const isFrozenFor = (row: ReportRow | null, finishedAt: Date | null): row is ReportRow & { storage_key: string } =>
  !!row?.storage_key && sameInstant(row.route_finished_at, finishedAt);

type SignKind = "final" | "closing";

/** Who signs: their username, display name, number and — kept with a closing signature only — the
 *  role it prints ("בודק" / "מנהל"). */
export type Signer = { username: string; name: string; number: string; role?: string };

/** What tells the two signatures apart: their columns, their status fields, their refusals. */
const SIGNATURES = {
  final: {
    given: (row: ReportRow, finishedAt: Date | null): Signature =>
      !row.signature_key || !row.signed_at || !sameInstant(row.signed_finished_at, finishedAt)
        ? null
        : { key: row.signature_key, name: row.signed_by_name ?? row.signed_by ?? "", number: row.signed_by_number ?? "", at: row.signed_at },
    columns: (key: string, signer: Signer, finishedAt: Date | null) => ({
      signature_key: key, signed_by: signer.username, signed_by_name: signer.name || signer.username, signed_by_number: signer.number,
      signed_at: new Date(), signed_finished_at: finishedAt,
    }),
    // An external approval stands for the final signature.
    signedBy: (s: ReportStatus) => s.signedBy ?? s.externalApprovedBy,
    asked: (s: ReportStatus) => s.needsSignature,
    alreadySigned: "The report is already signed",
    noBlock: "The template has no signature to sign",
  },
  closing: {
    given: (row: ReportRow, finishedAt: Date | null): Signature =>
      !row.closing_signature_key || !row.closing_signed_at || !sameInstant(row.closing_signed_finished_at, finishedAt)
        ? null
        : {
          key: row.closing_signature_key, name: row.closing_signed_by_name ?? row.closing_signed_by ?? "",
          number: row.closing_signed_by_number ?? "", at: row.closing_signed_at, role: row.closing_signed_by_role ?? "",
        },
    columns: (key: string, signer: Signer, finishedAt: Date | null) => ({
      closing_signature_key: key, closing_signed_by: signer.username, closing_signed_by_name: signer.name || signer.username,
      closing_signed_by_number: signer.number, closing_signed_by_role: signer.role || null,
      closing_signed_at: new Date(), closing_signed_finished_at: finishedAt,
    }),
    signedBy: (s: ReportStatus) => s.closingSignedBy,
    asked: (s: ReportStatus) => s.needsClosingSignature,
    alreadySigned: "The report is already signed at the closing",
    noBlock: "The template has no closing signature",
  },
} as const;

/** The external approval of the row, when it was given for this finish: the approver as a signature
 *  (role = their role / body), their reason and the manager who showed them the report. */
function externalSignatureOf(row: ReportRow, finishedAt: Date | null): Signature {
  if (!row.external_signature_key || !row.external_signed_at || !sameInstant(row.external_signed_finished_at, finishedAt)) return null;
  return {
    key: row.external_signature_key, name: row.external_signed_by_name ?? "", number: "", at: row.external_signed_at,
    role: row.external_signed_by_role ?? "", note: row.external_note ?? "",
    presentedBy: row.external_presented_by_name || row.external_presented_by || "",
  };
}

/** Every signature of the row that is valid for the item's current finish. */
function signaturesOf(row: ReportRow | null, finishedAt: Date | null) {
  return {
    signature: row ? SIGNATURES.final.given(row, finishedAt) : null,
    closingSignature: row ? SIGNATURES.closing.given(row, finishedAt) : null,
    externalSignature: row ? externalSignatureOf(row, finishedAt) : null,
  };
}

/** What a report's state is read from: the item's finish and its template. */
type StateSource = { item: { finished_at: Date | null }; template: ReportSource["template"] };

function stateOf(src: StateSource, row: ReportRow | null): ReportStatus {
  const finished = src.item.finished_at != null;
  const hasTemplate = !!src.template && templateHasContent(src.template);
  const needsSignature = hasTemplate && requiresFinalSignature(src.template);
  const needsClosingSignature = hasTemplate && requiresClosingSignature(src.template);
  const { signature: sig, closingSignature: closingSig, externalSignature: externalSig } = signaturesOf(row, src.item.finished_at);
  // A copy frozen for THIS finish is the final document whatever the template
  // says now — edited (a signature block added later) or deleted.
  const frozen = isFrozenFor(row, src.item.finished_at);
  const state: ReportState = frozen
    ? "final"
    : !hasTemplate
      ? "no_template"
      : !finished
        ? "in_progress"
        : needsSignature && !sig && !externalSig
          ? "awaiting_signature"
          : "final";
  return {
    state,
    finished,
    failed: false,
    needsSignature,
    signedBy: sig?.name ?? null,
    signedAt: sig ? sig.at.toISOString() : null,
    needsClosingSignature,
    closingSignedBy: closingSig?.name ?? null,
    closingSignedAt: closingSig ? closingSig.at.toISOString() : null,
    externalApprovedBy: externalSig?.name ?? null,
    externalApprovedRole: externalSig?.role || null,
    externalApprovedAt: externalSig ? externalSig.at.toISOString() : null,
    externalPresentedBy: externalSig?.presentedBy || null,
    version: frozen ? row.version : 0,
  };
}

export async function getReportStatus(itemId: bigint): Promise<ReportStatus | null> {
  const head = await loadReportSource(itemId, { rows: false });
  if (!head) return null;
  const status = stateOf(head, await loadReportRow(itemId));
  // Whether it failed matters only while it waits for the final signature (an external approval
  // may stand for it then) — the results are read only for that.
  if (status.state === "awaiting_signature") {
    const src = await loadReportSource(itemId);
    status.failed = !!src?.route && failedStepRows(src.rows, src.route).length > 0;
  }
  return status;
}

type ReportDocument =
  | { kind: "not_found" }
  | { kind: "no_template" }
  | { kind: "pdf"; bytes: Buffer; final: boolean; version: number; filename: string };

/** Render, store and point at the final copy. */
async function freeze(src: ReportSource, row: ReportRow | null): Promise<{ bytes: Buffer; version: number }> {
  const { bytes, filename } = await renderReportPdf(src, { draft: false, ...signaturesOf(row, src.item.finished_at) });
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
    objectKey: key, fileName: filename, contentType: "application/pdf", sizeBytes: stored.size,
    checksum: stored.checksum, entityType: "item_report", entityId: String(itemId),
  });
  // Only the latest version is pointed at — drop the previous blob (the
  // bucket is versioned, so it is still recoverable from MinIO).
  if (row?.storage_key && row.storage_key !== key) {
    await removeObject(row.storage_key).catch((e) =>
      console.error(`[item-report] the previous copy ${row.storage_key} of item ${itemId} could not be removed`, e),
    );
    void markFileObjectDeleted(row.storage_key);
  }
  return { bytes, version };
}

/**
 * The report of an item: the stored final copy when there is a valid one, a
 * fresh final copy when the item has just become final, else a live draft.
 */
export async function getItemReport(itemId: bigint): Promise<ReportDocument> {
  // The results are read only when something is rendered — a frozen copy
  // needs the item and its template alone.
  const head = await loadReportSource(itemId, { rows: false });
  if (!head) return { kind: "not_found" };
  const row = await loadReportRow(itemId);
  const status = stateOf(head, row);
  if (status.state === "no_template") return { kind: "no_template" };
  const full = async (): Promise<ReportSource> => (await loadReportSource(itemId)) ?? head;

  if (status.state === "final") {
    if (isFrozenFor(row, head.item.finished_at)) {
      try {
        const bytes = await getObjectBuffer(row.storage_key);
        return { kind: "pdf", bytes, final: true, version: row.version, filename: `item-${itemId}.pdf` };
      } catch (e) {
        // The stored blob is gone: rebuild once from current data rather
        // than 404 forever — the only path that re-renders a final report.
        console.error(`[item-report] stored report of item ${itemId} is missing — rebuilding`, e);
      }
    }
    // Nothing to rebuild from once the template is gone too.
    if (!head.template || !templateHasContent(head.template)) return { kind: "no_template" };
    const { bytes, version } = await freeze(await full(), row);
    return { kind: "pdf", bytes, final: true, version, filename: `item-${itemId}.pdf` };
  }

  const { bytes, filename } = await renderReportPdf(await full(), { draft: true, ...signaturesOf(row, head.item.finished_at) });
  return { kind: "pdf", bytes, final: false, version: 0, filename };
}

/**
 * Of these items, those whose report waits for the final signature ("awaiting_signature" — the
 * state the item page shows): finished, the template asks for it, not given and not frozen. In a
 * few queries for all of them (the packages list asks for every closed box's items).
 */
export async function itemsAwaitingFinalSignature(itemIds: readonly bigint[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (itemIds.length === 0) return out;
  const routes = await prisma.item_routes.findMany({
    where: { item_id: { in: [...itemIds] }, finished_at: { not: null } },
    select: { item_id: true, item_type_id: true, route_number: true, finished_at: true },
  });
  if (routes.length === 0) return out;
  const pairs = [...new Map(routes.map((r) => [`${r.item_type_id}:${r.route_number}`, r])).values()];
  const [testingRoutes, rows] = await Promise.all([
    prisma.testing_routes.findMany({
      where: { OR: pairs.map((r) => ({ item_type_id: r.item_type_id, route_number: r.route_number })) },
      select: { item_type_id: true, route_number: true, report_template: { select: { template: true } }, item_types: { select: { is_package: true } } },
    }),
    prisma.item_reports.findMany({ where: { item_id: { in: routes.map((r) => r.item_id) } } }),
  ]);
  const general = generalTemplateOnce();
  const templates = new Map<string, ReportSource["template"]>();
  for (const tr of testingRoutes) templates.set(`${tr.item_type_id}:${tr.route_number}`, await templateOfRoute(tr, general));
  const rowOf = new Map(rows.map((r) => [r.item_id.toString(), r]));
  for (const r of routes) {
    const template = templates.get(`${r.item_type_id}:${r.route_number}`) ?? null;
    if (!template) continue;
    const state = stateOf({ item: { finished_at: r.finished_at }, template }, rowOf.get(r.item_id.toString()) ?? null).state;
    if (state === "awaiting_signature") out.add(r.item_id.toString());
  }
  return out;
}

/**
 * Of these items, those whose results came out "לא תקין": the latest row of a route step failed
 * (failedStepRows — the rule of the report's overall verdict and of an external approval). In a few
 * queries for all of them (the packages list asks it of the items that wait for the final signature:
 * their reports may be passed by an external approver — "ממתינים לאישור גורם חיצוני").
 */
export async function itemsWithFailedResults(itemIds: readonly bigint[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (itemIds.length === 0) return out;
  const routes = await prisma.item_routes.findMany({
    where: { item_id: { in: [...itemIds] } },
    select: { item_id: true, item_type_id: true, route_number: true },
  });
  if (routes.length === 0) return out;
  const pairs = [...new Map(routes.map((r) => [`${r.item_type_id}:${r.route_number}`, r])).values()];
  const [testingRoutes, rows] = await Promise.all([
    prisma.testing_routes.findMany({
      where: { OR: pairs.map((r) => ({ item_type_id: r.item_type_id, route_number: r.route_number })) },
      select: { item_type_id: true, route_number: true, route_steps: true, step_uids: true },
    }),
    prisma.$queryRaw<{ item_id: bigint; test_result_id: number; route_number: number; route_step: number; station_is_research: boolean; passed: boolean | null; details: unknown; created_at: Date }[]>`
      SELECT tr.item_id, tr.test_result_id, tr.route_number, tr.route_step,
             COALESCE(ts.is_research, false) AS station_is_research, tr.passed, tr.details, tr.created_at
        FROM test_results tr
        LEFT JOIN test_stations ts ON ts.test_station_id = tr.test_station_id
       WHERE tr.item_id IN (${Prisma.join(routes.map((r) => r.item_id))})`,
  ]);
  const routeOf = new Map(testingRoutes.map((t) => [`${t.item_type_id}:${t.route_number}`, t]));
  const rowsOf = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const id = r.item_id.toString();
    const list = rowsOf.get(id) ?? [];
    list.push({
      test_result_id: r.test_result_id, route_number: r.route_number, route_step: r.route_step,
      station: "", station_type: "", station_is_research: r.station_is_research,
      worker_id: null, worker_name: null, passed: r.passed, result: null, comments: null,
      details: r.details, created_at: r.created_at.toISOString(),
    });
    rowsOf.set(id, list);
  }
  for (const r of routes) {
    const route = routeOf.get(`${r.item_type_id}:${r.route_number}`);
    const id = r.item_id.toString();
    if (route && failedStepRows(rowsOf.get(id) ?? [], route).length > 0) out.add(id);
  }
  return out;
}

type PackageReportDocument =
  | { kind: "not_found" }
  | { kind: "not_a_package" }
  | { kind: "no_reports" }
  | { kind: "pdf"; bytes: Buffer; filename: string; items: number; drafts: number };

/**
 * A kit's combined report: the report of every item in the box, in the box's order (package_seq),
 * one after another in ONE PDF. Each is built exactly as the item's own report from the same data
 * (buildReportBody) — a final one with its signatures and no mark, one still a draft with its
 * "טיוטה" mark. Items whose route has no report are left out. Rendered live on every download and
 * never stored: an item's frozen copy stays its own record (getItemReport).
 */
export async function getPackageReport(packageId: bigint): Promise<PackageReportDocument> {
  const [box] = await prisma.$queryRaw<{ is_package: boolean | null }[]>`
    SELECT t.is_package FROM items i LEFT JOIN item_types t ON t.item_type_id = i.item_type_id
     WHERE i.item_id = ${packageId}`;
  if (!box) return { kind: "not_found" };
  if (!box.is_package) return { kind: "not_a_package" };

  const members = await prisma.items.findMany({
    where: { package_id: packageId },
    select: { item_id: true },
    orderBy: [{ package_seq: { sort: "asc", nulls: "last" } }, { item_id: "asc" }],
  });
  const parts: Awaited<ReturnType<typeof buildReportBody>>[] = [];
  let drafts = 0;
  // One at a time: each item's photos are made small in Chromium, and a box can hold many items.
  for (const { item_id } of members) {
    const src = await loadReportSource(item_id);
    if (!src?.template || !templateHasContent(src.template)) continue;
    const row = await loadReportRow(item_id);
    const draft = stateOf(src, row).state !== "final";
    if (draft) drafts++;
    parts.push(await buildReportBody(src, { draft, ...signaturesOf(row, src.item.finished_at) }));
  }
  if (parts.length === 0) return { kind: "no_reports" };
  const bytes = await renderCombinedPdf(parts, `דוח מארז ${packageId}${drafts ? " (כולל טיוטות)" : ""}`);
  return { kind: "pdf", bytes, filename: `package-${packageId}${drafts ? "-draft" : ""}.pdf`, items: parts.length, drafts };
}

/** The live HTML of the report (the signing previews). */
export async function getItemReportHtml(itemId: bigint): Promise<string | null> {
  const src = await loadReportSource(itemId);
  if (!src?.template || !templateHasContent(src.template)) return null;
  const row = await loadReportRow(itemId);
  const status = stateOf(src, row);
  const built = await buildReportHtml(src, { draft: status.state !== "final", ...signaturesOf(row, src.item.finished_at) });
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
    if (isFrozenFor(row, route.finished_at)) return;
    const src = await loadReportSource(itemId);
    if (!src?.template || !templateHasContent(src.template)) return;
    if (stateOf(src, row).state !== "final" || isFrozenFor(row, src.item.finished_at)) return;
    await freeze(src, row);
  } catch (e) {
    console.error(`[item-report] freezing the report of item ${itemId} failed — it will be built on first download`, e);
  }
}

/** A signature the report refuses: { error, code } with its status. */
const refuse = (status: number, code: string, message: string) => new HttpError(status, message, { code });

/** Store a drawn signature (closing or final) in MinIO and register it. */
async function storeSignature(itemId: bigint, png: Buffer, signer: Signer): Promise<string> {
  const key = ReportKeys.signature(itemId);
  const stored = await putObject(key, png, "image/png");
  void registerFileObject({
    objectKey: key, fileName: `signature-${itemId}.png`, contentType: "image/png", sizeBytes: stored.size,
    checksum: stored.checksum, entityType: "item_report_signature", entityId: String(itemId), createdBy: signer.username,
  });
  return key;
}

/** Give a signature of `kind` on a finished item's report, once per finish; freeze the report when
 *  that makes it final. → the frozen copy's version, 0 when it is not frozen (yet). */
async function sign(kind: SignKind, itemId: bigint, png: Buffer, signer: Signer): Promise<{ version: number }> {
  const k = SIGNATURES[kind];
  const src = await loadReportSource(itemId);
  if (!src) throw refuse(404, "NOT_FOUND", "Item not found");
  const row = await loadReportRow(itemId);
  const status = stateOf(src, row);
  if (status.state === "no_template") throw refuse(409, "NO_TEMPLATE", "The item's route has no report template");
  if (!status.finished) throw refuse(409, "NOT_FINISHED", "The item has not finished its route");
  if (k.signedBy(status)) throw refuse(409, "ALREADY_SIGNED", k.alreadySigned);
  if (!k.asked(status)) throw refuse(409, "NO_SIGNATURE_BLOCK", k.noBlock);
  // Frozen for this finish (e.g. frozen before the template gained the block): it stays as it was —
  // except a closing signature missing on a report an external approval locked (given before the
  // closing one was required first): it is added, and the report frozen again with both.
  const closingAfterExternal = kind === "closing" && closingMissingAfterExternal(status);
  if (status.version > 0 && !closingAfterExternal) throw refuse(409, "ALREADY_FINAL", "The report is already final");

  const key = await storeSignature(itemId, png, signer);
  const columns = k.columns(key, signer, src.item.finished_at);
  const next = await prisma.item_reports.upsert({ where: { item_id: itemId }, create: { item_id: itemId, ...columns }, update: columns });
  // The closing signature locks nothing while a final one is still to come.
  if (stateOf(src, next).state !== "final") return { version: 0 };
  const { version } = await freeze(src, next);
  return { version };
}

/** The approver's final signature on a finished item's report: it locks the report (frozen with it).
 *  Whoever signed at the closing may give it too. */
export const signItemReport = (itemId: bigint, png: Buffer, signer: Signer) => sign("final", itemId, png, signer);

/**
 * The signature given at the kit's closing (popup-templates `report_sign`), on a report whose
 * template asks for one. It is kept with the finish it was given for and does not lock the report —
 * unless the template asks for no final signature, in which case the report is final now and is
 * frozen with it.
 */
export const signClosingSignature = (itemId: bigint, png: Buffer, signer: Signer) => sign("closing", itemId, png, signer);

/** What an external approver writes: their name (required), their role / body and reason (optional). */
export type ExternalApproval = { name: string; role: string; note: string };

/**
 * An external approval of a finished item whose report came out "לא תקין" (docs/features/ITEM_REPORTS.md):
 * someone outside the system examined it and passes it, signing on the screen of the manager who
 * shows them the report (`manager`, the signed-in user). In one transaction:
 *   - the latest row of every failed step is passed (passed = true, details.verdict.ok = "pass"), with
 *     details.external_approval keeping who approved and the verdict it had before;
 *   - the approval is kept on item_reports for this finish.
 * It stands for the final signature: the report is frozen with it → { version, passed: rows passed }.
 * Only while the report waits for the final signature: a template without one is frozen at the finish.
 */
export async function approveExternal(
  itemId: bigint,
  png: Buffer,
  approval: ExternalApproval,
  manager: Signer,
): Promise<{ version: number; passed: number }> {
  const src = await loadReportSource(itemId);
  if (!src) throw refuse(404, "NOT_FOUND", "Item not found");
  const status = stateOf(src, await loadReportRow(itemId));
  if (status.state === "no_template") throw refuse(409, "NO_TEMPLATE", "The item's route has no report template");
  if (!status.finished) throw refuse(409, "NOT_FINISHED", "The item has not finished its route");
  if (status.externalApprovedBy) throw refuse(409, "ALREADY_APPROVED", "The report is already approved externally");
  if (status.signedBy) throw refuse(409, "ALREADY_SIGNED", "The report is already signed");
  if (status.state !== "awaiting_signature") throw refuse(409, "ALREADY_FINAL", "The report is already final");
  const failed = src.route ? failedStepRows(src.rows, src.route) : [];
  if (failed.length === 0) throw refuse(409, "NOT_FAILED", "The report did not come out failed");
  // The closing signature comes first: the approval locks the report, and after the lock its spot
  // would stay blank for good.
  if (closingBlocksExternalApproval(status)) throw refuse(409, "CLOSING_MISSING", "The closing signature must be given first");

  const key = await storeSignature(itemId, png, manager);
  const at = new Date();
  const finishedAt = src.item.finished_at;
  await prisma.$transaction(async (tx) => {
    // One approval per finish: the item's route row is the lock, and what was checked above is
    // checked again under it.
    const [route] = await tx.$queryRaw<{ finished_at: Date | null }[]>`
      SELECT finished_at FROM item_routes WHERE item_id = ${itemId} FOR UPDATE`;
    const current = await tx.item_reports.findUnique({ where: { item_id: itemId } });
    if (!sameInstant(route?.finished_at, finishedAt)) throw refuse(409, "NOT_FINISHED", "The item's route changed meanwhile");
    if (current && externalSignatureOf(current, finishedAt)) throw refuse(409, "ALREADY_APPROVED", "The report is already approved externally");
    if (current && (SIGNATURES.final.given(current, finishedAt) || isFrozenFor(current, finishedAt))) {
      throw refuse(409, "ALREADY_FINAL", "The report is already final");
    }
    for (const r of failed) {
      const d = isRecord(r.details) ? r.details : {};
      const details = {
        ...d,
        verdict: { ...(isRecord(d.verdict) ? d.verdict : {}), ok: "pass" },
        [EXTERNAL_APPROVAL_KEY]: {
          at: at.toISOString(),
          name: approval.name,
          role: approval.role || null,
          note: approval.note || null,
          presented_by: manager.username,
          presented_by_name: manager.name || null,
          previous: { passed: r.passed, verdict: d.verdict ?? null },
        },
      };
      await tx.test_results.update({
        where: { test_result_id: r.test_result_id },
        data: { passed: true, details: details as Prisma.InputJsonValue },
      });
    }
    const columns = {
      external_signature_key: key,
      external_signed_by_name: approval.name,
      external_signed_by_role: approval.role || null,
      external_note: approval.note || null,
      external_presented_by: manager.username,
      external_presented_by_name: manager.name || manager.username,
      external_signed_at: at,
      external_signed_finished_at: finishedAt,
    };
    await tx.item_reports.upsert({ where: { item_id: itemId }, create: { item_id: itemId, ...columns }, update: columns });
  });

  // Frozen from the results as they are now (passed), with the approval on it.
  const next = await loadReportRow(itemId);
  const { version } = await freeze((await loadReportSource(itemId)) ?? src, next);
  return { version, passed: failed.length };
}

/**
 * Sign the report at the closing with a result that has just been saved (popup-templates
 * `report_sign`): "signed" when the closing signature is given now or already was,
 * "nothing_to_sign" when the report does not ask for it (the result did not finish the route, no
 * template, no closing signature block). Anything else throws — the result itself stays saved.
 */
export async function signReportWithResult(itemId: bigint, png: Buffer, signer: Signer): Promise<"signed" | "nothing_to_sign"> {
  try {
    await signClosingSignature(itemId, png, signer);
    return "signed";
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.code === "ALREADY_SIGNED" || e.code === "ALREADY_FINAL") return "signed";
      if (e.code === "NOT_FINISHED" || e.code === "NO_TEMPLATE" || e.code === "NO_SIGNATURE_BLOCK") return "nothing_to_sign";
    }
    throw e;
  }
}
