/**
 * Item report variables — what a template can place, and their values for one
 * item.
 *
 *   item.<key>                    the item's own details (ITEM_VARS)
 *   step.<uid>.<attr>             a station step the item passed (STEP_ATTRS):
 *                                 the station, the worker, the date, the verdict…
 *   field.<uid>.<fieldId>         the value a worker filled in a station field
 *   field.<uid>.<fieldId>.status  its verdict word ("תקין" / "לא תקין")
 *   field.<uid>.<fieldId>.note    the worker's note on it
 *   report.<key>                  the document itself (date printed, signer)
 *
 * Steps are addressed by their STEP UID (testing_routes.step_uids), never by
 * position — the same contract as the station fields (schema.ts): moving a step
 * never re-points a variable. A package-level step (opening / closing a kit)
 * is the KIT route's step: an item's row there carries the kit's uid in
 * details.schema.step_uid, so the item's report reads it the same way.
 *
 * Pure module: the editor (catalog) and the server renderer (values) both use
 * it; no prisma / next / React.
 */
import type { Field, FieldValue, RouteFieldsConfig, StepConfig } from "@/app/lib/station-fields/schema";
import { stepUidAt, targetKey } from "@/app/lib/station-fields/schema";
import { isTemplateComponentId } from "@/app/lib/popup-templates/schema";
import { PHOTO_BLOCK_KEYS, REF_SOURCES, readSchemaRef, type RefSource } from "@/app/lib/test-results/details";
import { isRecord, oneOf, type JsonObject } from "@/lib/json-guards";
import { formatDocDate } from "@/app/lib/datetime";
import { REPORT_TONE_WORD } from "./types";
import { PASS_FAIL_WORD } from "@/app/lib/station-fields/labels";
import type { ReportFieldResult, ReportStepRef, ReportStepResult, ReportTone, ReportVar } from "./types";

/** An item's own details, as the report source reads them. */
export type ItemFacts = {
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
  /** The customer CODE (never the name — see source.ts). */
  customer: string | null;
  shipment_code: string | null;
  package_type: string | null;
  route_number: number;
  created_at: Date;
  finished_at: Date | null;
  status: string | null;
};

/** A signature given on the report: who, when, and (a closing one) their role. */
export type GivenSignature = { name: string; at: Date; role?: string };

/** What the report.* variables print. */
export interface ReportFacts {
  generatedAt: Date;
  signature: GivenSignature | null;
  closingSignature: GivenSignature | null;
  /** The external approver's (role = their role / body). */
  externalSignature?: GivenSignature | null;
}

/** test_results.details key of a failed step an external approver passed (lifecycle approveExternal):
 *  who approved, when, and the verdict the step had before. */
export const EXTERNAL_APPROVAL_KEY = "external_approval";

/** The overall verdict word: "תקין (אושר ע״י גורם חיצוני)" when a step passes only by an external
 *  approval. */
export const EXTERNALLY_APPROVED_VERDICT = `${PASS_FAIL_WORD.pass} (אושר ע״י גורם חיצוני)`;

/** What the item.* variables are computed from: the item, and its steps for the overall verdict. */
export interface ItemValueContext {
  item: ItemFacts;
  results: readonly ReportStepResult[];
  /** The route has finished (the overall verdict waits for it). */
  finished: boolean;
}

/** A variable: its key under its prefix, the label the editor shows, and its value. */
type VarDef<C> = { key: string; label: string; value: (ctx: C) => string };

const ITEM_GROUP = "פרטי הפריט";
const REPORT_GROUP = "המסמך";

const trimOrEmpty = (v: unknown): string => (v == null ? "" : String(v).trim());

const ITEM_VARS: readonly VarDef<ItemValueContext>[] = [
  { key: "item_id", label: "מספר פריט (ברקוד)", value: ({ item }) => String(item.item_id) },
  { key: "serial_no", label: "מספר סידורי", value: ({ item }) => trimOrEmpty(item.serial_no) },
  { key: "makat", label: 'מק"ט', value: ({ item }) => trimOrEmpty(item.makat) },
  { key: "model", label: "דגם", value: ({ item }) => trimOrEmpty(item.model) },
  { key: "manufacturer_name", label: "יצרן", value: ({ item }) => trimOrEmpty(item.manufacturer_name) },
  { key: "manufacturer_no", label: 'מק"ט יצרן', value: ({ item }) => trimOrEmpty(item.manufacturer_no) },
  { key: "item_type", label: "סוג פריט", value: ({ item }) => trimOrEmpty(item.item_type) },
  // The customer CODE (source.ts) — a report never names the customer.
  { key: "customer", label: "קוד לקוח", value: ({ item }) => trimOrEmpty(item.customer) },
  { key: "shipment_code", label: "מספר משלוח", value: ({ item }) => trimOrEmpty(item.shipment_code) },
  { key: "package_id", label: "מארז", value: ({ item }) => (item.package_id != null ? String(item.package_id) : "") },
  { key: "package_type", label: "סוג המארז", value: ({ item }) => trimOrEmpty(item.package_type) },
  { key: "package_seq", label: "מיקום במארז", value: ({ item }) => (item.package_seq != null ? String(item.package_seq).padStart(2, "0") : "") },
  { key: "route_number", label: "מספר מסלול", value: ({ item }) => String(item.route_number) },
  { key: "status", label: "סטטוס", value: ({ item }) => trimOrEmpty(item.status) },
  { key: "created_at", label: "תאריך קליטה", value: ({ item }) => formatDocDate(item.created_at) },
  { key: "finished_at", label: "תאריך סיום המסלול", value: ({ item }) => (item.finished_at ? formatDocDate(item.finished_at) : "") },
  {
    key: "verdict",
    label: "תוצאה כוללת",
    value: ({ results, finished }) => {
      const overall = overallVerdict(results, finished);
      if (overall === "pass" && results.some((r) => r.externallyApproved)) return EXTERNALLY_APPROVED_VERDICT;
      return overall ? PASS_FAIL_WORD[overall] : "";
    },
  },
];

const REPORT_VARS: readonly VarDef<ReportFacts>[] = [
  { key: "generated_at", label: "תאריך הפקת הדוח", value: (r) => formatDocDate(r.generatedAt) },
  { key: "signer", label: "מאשר הדוח (חתימה סופית)", value: (r) => r.signature?.name ?? "" },
  { key: "signed_at", label: "תאריך החתימה הסופית", value: (r) => (r.signature ? formatDocDate(r.signature.at) : "") },
  { key: "closing_signer", label: "החותם בסגירת המארז", value: (r) => r.closingSignature?.name ?? "" },
  { key: "closing_signer_role", label: "תפקיד החותם בסגירה", value: (r) => r.closingSignature?.role ?? "" },
  { key: "closing_signed_at", label: "תאריך החתימה בסגירה", value: (r) => (r.closingSignature ? formatDocDate(r.closingSignature.at) : "") },
  { key: "external_signer", label: "גורם חיצוני שאישר", value: (r) => r.externalSignature?.name ?? "" },
  { key: "external_signer_role", label: "תפקיד / גוף של הגורם החיצוני", value: (r) => r.externalSignature?.role ?? "" },
  { key: "external_signed_at", label: "תאריך האישור החיצוני", value: (r) => (r.externalSignature ? formatDocDate(r.externalSignature.at) : "") },
];

const STEP_ATTRS: readonly VarDef<ReportStepResult>[] = [
  { key: "station_type", label: "שם השלב", value: (r) => r.stationType },
  { key: "station", label: "עמדה", value: (r) => r.station },
  { key: "worker", label: "עובד", value: (r) => r.worker },
  { key: "worker_number", label: "מספר עובד", value: (r) => r.workerNumber },
  { key: "date", label: "תאריך", value: (r) => r.date },
  { key: "time", label: "שעה", value: (r) => r.time },
  { key: "verdict", label: "תוצאה", value: (r) => (r.verdict ? PASS_FAIL_WORD[r.verdict] : "") },
  { key: "result", label: "ערך תוצאה", value: (r) => (r.result == null ? "" : String(r.result)) },
  { key: "comments", label: "הערות", value: (r) => r.comments },
];

/** One route the catalog draws from: the item's own route, or a kit route
 *  (its package-level steps only — the item's rows there carry the kit uid). */
export interface CatalogRoute {
  /** "מסלול 1" / "מארז X · מסלול 1" — prefixes every step label of this route. */
  label: string;
  kind: "item" | "kit";
  route_steps: number[];
  step_uids: string[];
  /** draft ?? published; null = no station fields. */
  config: RouteFieldsConfig | null;
  /** The item type the report is for (picks the kit's {item_type_id} group). */
  item_type_id: number;
}

export interface CatalogStationTypes {
  [stationTypeId: number]: { label: string; package_level: boolean };
}

/** The fields an item answers at a step: its own group on an item route; the
 *  each_item + its type group on a kit's package-level step. */
function itemFieldsOf(step: StepConfig, kind: "item" | "kit", itemTypeId: number): Field[] {
  const keys = kind === "item" ? ["item"] : ["each_item", targetKey({ item_type_id: itemTypeId })];
  const out: Field[] = [];
  for (const k of keys) {
    const g = step.groups.find((x) => targetKey(x.target) === k);
    if (g) out.push(...g.fields);
  }
  return out;
}

/** The variables and steps a template of an item route can bind. */
export function buildCatalog(
  routes: readonly CatalogRoute[],
  stationTypes: CatalogStationTypes,
): { vars: ReportVar[]; steps: ReportStepRef[] } {
  const vars: ReportVar[] = [
    ...ITEM_VARS.map((v) => ({ name: `item.${v.key}`, label: v.label, group: ITEM_GROUP })),
    ...REPORT_VARS.map((v) => ({ name: `report.${v.key}`, label: v.label, group: REPORT_GROUP })),
  ];
  const steps: ReportStepRef[] = [];
  for (const r of routes) {
    r.step_uids.forEach((uid, i) => {
      const typeId = r.route_steps[i];
      if (!uid || typeId == null) return;
      const st = stationTypes[typeId];
      // A kit route contributes only the steps its items answer (package-level).
      if (r.kind === "kit" && !st?.package_level) return;
      const cfg = r.config?.steps && Object.prototype.hasOwnProperty.call(r.config.steps, uid) ? r.config.steps[uid] : undefined;
      const stationLabel = st?.label ?? cfg?.station_label ?? `עמדה ${typeId}`;
      const stepLabel = r.kind === "kit" ? `${r.label} · ${stationLabel}` : `${i + 1} · ${stationLabel}`;
      const group = r.label;
      const fields = cfg ? itemFieldsOf(cfg, r.kind, r.item_type_id) : [];
      steps.push({
        uid,
        label: stepLabel,
        group,
        fields: fields.map((f) => ({ id: f.id, label: f.label || "שדה", type: f.type })),
      });
      for (const a of STEP_ATTRS) {
        vars.push({ name: `step.${uid}.${a.key}`, label: `${stepLabel} · ${a.label}`, group });
      }
      for (const f of fields) {
        if (f.type === "section" || f.type === "photo") continue;
        const fl = f.label || "שדה";
        vars.push({ name: `field.${uid}.${f.id}`, label: `${stepLabel} · ${fl}`, group });
        vars.push({ name: `field.${uid}.${f.id}.status`, label: `${stepLabel} · ${fl} · סטטוס`, group });
        if (f.notes !== "off") {
          vars.push({ name: `field.${uid}.${f.id}.note`, label: `${stepLabel} · ${fl} · הערה`, group });
        }
      }
    });
  }
  return { vars, steps };
}

function fmtNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/** A saved field value → printable text + verdict tone. */
export function formatFieldValue(v: FieldValue): { value: string; tone: ReportTone | null; photos?: string[] } {
  switch (v.t) {
    case "choice_row":
      return { value: v.opt_label ?? "", tone: v.tone ?? null };
    case "multi_choice": {
      const tones = v.opts.map((o) => o.tone);
      const tone: ReportTone | null = tones.includes("fail") ? "fail" : tones.includes("warn") ? "warn" : tones.length ? (tones.includes("pass") ? "pass" : "neutral") : null;
      return { value: v.opts.map((o) => o.label).join(", "), tone };
    }
    case "pass_fail":
      return { value: v.ok ? PASS_FAIL_WORD[v.ok] : "", tone: v.ok ?? null };
    case "number": {
      if (v.value == null) return { value: "", tone: null };
      const value = v.unit ? `${fmtNumber(v.value)} ${v.unit}` : fmtNumber(v.value);
      return { value, tone: v.in_range == null ? null : v.in_range ? "pass" : "fail" };
    }
    case "text":
    case "textarea":
    case "scan":
      return { value: v.value ?? "", tone: null };
    case "checklist": {
      const value = v.items.map((it) => `${it.label} ${it.ok ? "✓" : "✗"}`).join(" · ");
      const tone: ReportTone | null = v.items.length === 0 ? null : v.items.every((it) => it.ok) ? "pass" : "fail";
      return { value, tone };
    }
    case "photo":
      return { value: `${v.photos.length} תמונות`, tone: null, photos: [...v.photos] };
    default:
      return { value: "", tone: null };
  }
}

/** One test_results row, with what the server joined to it. */
export interface ResultRow {
  test_result_id: number;
  route_number: number;
  /** 1-based step of the item's OWN route. */
  route_step: number;
  station: string;
  station_type: string;
  /** The station is a research bench — not a route step. */
  station_is_research: boolean;
  worker_id: number | null;
  /** Snapshot from the ledger event, else the directory. */
  worker_name: string | null;
  passed: boolean | null;
  result: number | null;
  comments: string | null;
  details: unknown;
  /** ISO */
  created_at: string;
}

interface ResultsRoute {
  route_number: number;
  route_steps: number[];
  step_uids: string[];
}

/** The step uid a row answered: the station-fields schema ref, else the
 *  item's route at the row's position. */
export function rowStepUid(row: ResultRow, route: ResultsRoute): string | null {
  const ref = readSchemaRef(row.details);
  if (ref.step_uid) return ref.step_uid;
  if (row.route_number !== route.route_number) return null;
  return stepUidAt(route, row.route_step);
}

/** The photo keys of the code popups' photo blocks (SavedPhotoBlock). */
function blockPhotos(d: JsonObject): string[] {
  const out: string[] = [];
  for (const k of PHOTO_BLOCK_KEYS) {
    const block = d[k];
    if (isRecord(block) && Array.isArray(block.photos)) {
      for (const p of block.photos) if (typeof p === "string") out.push(p);
    }
  }
  return out;
}

/** Details.refSource of a package item's opening. */
const REF_SOURCE_LABEL: Record<RefSource, string> = {
  package: "מייחוס המארז",
  scan: "לפי הסריקה",
  package_fallback: "מייחוס המארז · המק״ט לא תאם",
  none: "ללא ייחוס",
};

/** One saved FieldValue as a report row. */
function fieldValueRow(id: string, raw: unknown): ReportFieldResult | null {
  if (!isRecord(raw) || typeof raw.t !== "string") return null;
  const v = raw as unknown as FieldValue;
  const f = formatFieldValue(v);
  return { id, label: v.label || "שדה", value: f.value, tone: f.tone, ...(v.note ? { note: v.note } : {}), ...(f.photos ? { photos: f.photos } : {}) };
}

/** The fields of a row: a popup template's components (docs/features/popup-templates/PLAN.md §3.5), the
 *  station-fields block or the documented `fields` array, and the keys the code popups save
 *  (refSource, weight, the photo blocks). */
function rowFields(d: JsonObject | null): ReportFieldResult[] {
  if (!d) return [];
  const out: ReportFieldResult[] = [];
  // SavedComponent[], in popup order.
  if (Array.isArray(d.components)) {
    for (const raw of d.components) {
      if (isRecord(raw) && typeof raw.id === "string") {
        const row = fieldValueRow(raw.id, raw);
        if (row) out.push(row);
      }
    }
  }
  if (isRecord(d.fields)) {
    for (const [id, raw] of Object.entries(d.fields)) {
      const row = fieldValueRow(id, raw);
      if (row) out.push(row);
    }
  } else if (Array.isArray(d.fields)) {
    // The legacy array (docs/features/REPORT_TEMPLATE.md): [{ label, value, unit?, passed? }, …]
    d.fields.forEach((raw, i) => {
      if (!isRecord(raw)) return;
      const label = typeof raw.label === "string" ? raw.label : `שדה ${i + 1}`;
      const val = raw.value;
      const unit = typeof raw.unit === "string" ? ` ${raw.unit}` : "";
      const value = typeof val === "boolean" ? (val ? "כן" : "לא") : val == null ? "" : `${String(val)}${unit}`;
      const tone: ReportTone | null = typeof raw.passed === "boolean" ? (raw.passed ? "pass" : "fail") : null;
      out.push({ id: `legacy_${i}`, label, value, tone });
    });
  }
  // An item opened against its package reference: where its reference came
  // from, and the SKU that was expected when the scan differed from it.
  if (oneOf(REF_SOURCES, d.refSource)) {
    const differs = typeof d.expectedSku === "string" && d.expectedSku !== "" && d.expectedSku !== d.sku;
    out.push({
      id: "legacy_reference",
      label: "ייחוס",
      value: `${REF_SOURCE_LABEL[d.refSource]}${differs ? ` · צפוי ${d.expectedSku}` : ""}`,
      tone: d.refSource === "package" ? "pass" : differs ? "warn" : null,
    });
  }
  if (isRecord(d.weight)) {
    // SavedWeight
    const w = d.weight;
    const parts = [w.measured != null ? `נמדד ${String(w.measured)}` : "", w.reference != null ? `ייחוס ${String(w.reference)}` : ""].filter(Boolean);
    out.push({ id: "legacy_weight", label: "משקל", value: parts.join(" · "), tone: typeof w.pass === "boolean" ? (w.pass ? "pass" : "fail") : null });
  }
  const photos = blockPhotos(d);
  if (photos.length > 0 && !out.some((f) => f.photos)) {
    out.push({ id: "legacy_photos", label: "תמונות", value: `${photos.length} תמונות`, tone: null, photos });
  }
  return out;
}

function orderFields(fields: ReportFieldResult[], order: readonly string[] | undefined): ReportFieldResult[] {
  if (!order) return fields;
  const pos = new Map(order.map((id, i) => [id, i]));
  // A template's components lead, in the popup's order (the sort is stable); the route's fields
  // follow in their config's order; anything else trails.
  const at = (f: ReportFieldResult) => pos.get(f.id) ?? (isTemplateComponentId(f.id) ? -1 : Number.MAX_SAFE_INTEGER);
  return [...fields].sort((a, b) => at(a) - at(b));
}

/** step uid → its field ids in config order (every group of the step). */
export function fieldOrderOf(configs: readonly RouteFieldsConfig[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const cfg of configs) {
    for (const [uid, step] of Object.entries(cfg.steps)) {
      if (out.has(uid)) continue;
      out.set(uid, step.groups.flatMap((g) => g.fields.map((f) => f.id)));
    }
  }
  return out;
}

function rowVerdict(row: ResultRow, d: JsonObject | null): "pass" | "fail" | null {
  const verdict = d && isRecord(d.verdict) ? d.verdict : null;
  if (verdict?.ok === "pass" || verdict?.ok === "fail") return verdict.ok;
  if (typeof row.passed === "boolean") return row.passed ? "pass" : "fail";
  if (verdict?.suggested === "pass" || verdict?.suggested === "fail") return verdict.suggested;
  return null;
}

type DateParts = { date: string; time: string };

/**
 * Every station step the item passed, in route order. A step run more than
 * once (released, re-queued, research loop) prints its LATEST row. Research
 * benches are not route steps and are left out; rows of a route the item is
 * no longer on (a retype) do not resolve to a uid of the current route and
 * drop out — except an item's rows at its kit's package-level steps (schema
 * target "kit_item"), whose uids are the kit route's.
 */
export function buildStepResults(
  rows: readonly ResultRow[],
  route: ResultsRoute,
  fmt: (iso: string) => DateParts,
  /** step uid → field ids in the config's order. details.fields is jsonb, which
   *  does not keep key order, so the saved order is not the configured one. */
  fieldOrder?: ReadonlyMap<string, readonly string[]>,
): ReportStepResult[] {
  const out: ReportStepResult[] = [];
  for (const [uid, row] of latestStepRows(rows, route)) {
    const d = isRecord(row.details) ? row.details : null;
    const verdictNote = d && isRecord(d.verdict) && typeof d.verdict.note === "string" ? d.verdict.note : "";
    const { date, time } = fmt(row.created_at);
    const approved = !!d && isRecord(d[EXTERNAL_APPROVAL_KEY]);
    const fields = orderFields(rowFields(d), fieldOrder?.get(uid));
    out.push({
      uid,
      position: row.route_step,
      stationType: row.station_type,
      station: row.station,
      worker: row.worker_name ?? (row.worker_id != null ? `#${row.worker_id}` : ""),
      workerNumber: row.worker_id != null ? String(row.worker_id) : "",
      date,
      time,
      verdict: rowVerdict(row, d),
      result: row.result,
      comments: row.comments || verdictNote || "",
      // A step passed by an external approval: what failed in it prints "תקין *" too — the measured
      // value stays as it was saved.
      fields: approved ? fields.map((f) => (f.tone === "fail" ? { ...f, tone: "pass" as const, approved: true } : f)) : fields,
      ...(approved ? { externallyApproved: true } : {}),
    });
  }
  out.sort((a, b) => a.position - b.position || a.uid.localeCompare(b.uid));
  return out;
}

/** The latest row of every route step that failed — what an external approval passes. */
export function failedStepRows(rows: readonly ResultRow[], route: ResultsRoute): ResultRow[] {
  return [...latestStepRows(rows, route).values()].filter((row) => rowVerdict(row, isRecord(row.details) ? row.details : null) === "fail");
}

/** step uid → the row the report prints for it: the latest, research benches and rows of another
 *  route left out (buildStepResults). */
function latestStepRows(rows: readonly ResultRow[], route: ResultsRoute): Map<string, ResultRow> {
  const latest = new Map<string, ResultRow>();
  const knownUids = new Set(route.step_uids);
  for (const row of rows) {
    const ref = readSchemaRef(row.details);
    if (ref.target === "kit_item" && ref.step_uid) knownUids.add(ref.step_uid);
  }
  for (const row of rows) {
    if (row.station_is_research) continue;
    const uid = rowStepUid(row, route);
    if (!uid || !knownUids.has(uid)) continue;
    const prev = latest.get(uid);
    if (!prev || row.created_at > prev.created_at || (row.created_at === prev.created_at && row.test_result_id > prev.test_result_id)) {
      latest.set(uid, row);
    }
  }
  return latest;
}

/** The overall verdict: fail as soon as any step failed; pass only once the
 *  route has FINISHED and every decided step passed — an item halfway through
 *  its route is not "תקין" yet. */
export function overallVerdict(results: readonly ReportStepResult[], finished = true): "pass" | "fail" | null {
  if (results.some((r) => r.verdict === "fail")) return "fail";
  if (finished && results.length > 0 && results.every((r) => r.verdict === "pass")) return "pass";
  return null;
}

/** The variable values of one item: item.* from the item (and its steps' overall verdict),
 *  report.* from the document, step.* / field.* from its results. */
export function buildValues(itemCtx: ItemValueContext, report: ReportFacts): Record<string, string> {
  const values: Record<string, string> = {};
  for (const v of ITEM_VARS) values[`item.${v.key}`] = v.value(itemCtx);
  for (const v of REPORT_VARS) values[`report.${v.key}`] = v.value(report);
  for (const r of itemCtx.results) {
    for (const a of STEP_ATTRS) values[`step.${r.uid}.${a.key}`] = a.value(r);
    for (const f of r.fields) {
      const fp = `field.${r.uid}.${f.id}`;
      values[fp] = f.value;
      values[fp + ".status"] = f.tone ? `${REPORT_TONE_WORD[f.tone]}${f.approved ? " *" : ""}` : "";
      values[fp + ".note"] = f.note ?? "";
    }
  }
  return values;
}

/** Editor sample values: every variable shows its own label. */
export function sampleValues(vars: readonly ReportVar[]): Record<string, string> {
  return Object.fromEntries(vars.map((v) => [v.name, v.label]));
}
