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
import { targetKey } from "@/app/lib/station-fields/schema";
import type { ReportFieldResult, ReportStepRef, ReportStepResult, ReportTone, ReportVar } from "./types";

// ---------------------------------------------------------------- catalog

export const ITEM_GROUP = "פרטי הפריט";
export const REPORT_GROUP = "המסמך";

export const ITEM_VARS: { key: string; label: string }[] = [
  { key: "item_id", label: "מספר פריט (ברקוד)" },
  { key: "serial_no", label: "מספר סידורי" },
  { key: "makat", label: 'מק"ט' },
  { key: "model", label: "דגם" },
  { key: "manufacturer_name", label: "יצרן" },
  { key: "manufacturer_no", label: 'מק"ט יצרן' },
  { key: "item_type", label: "סוג פריט" },
  { key: "customer", label: "לקוח" },
  { key: "shipment_code", label: "מספר משלוח" },
  { key: "package_id", label: "מארז" },
  { key: "package_type", label: "סוג המארז" },
  { key: "package_seq", label: "מיקום במארז" },
  { key: "route_number", label: "מספר מסלול" },
  { key: "status", label: "סטטוס" },
  { key: "created_at", label: "תאריך קליטה" },
  { key: "finished_at", label: "תאריך סיום המסלול" },
  { key: "verdict", label: "תוצאה כוללת" },
];

export const REPORT_VARS: { key: string; label: string }[] = [
  { key: "generated_at", label: "תאריך הפקת הדוח" },
  { key: "signer", label: "חותם הדוח" },
  { key: "signed_at", label: "תאריך החתימה" },
];

export const STEP_ATTRS: { key: string; label: string }[] = [
  { key: "station_type", label: "שם השלב" },
  { key: "station", label: "עמדה" },
  { key: "worker", label: "עובד" },
  { key: "worker_number", label: "מספר עובד" },
  { key: "date", label: "תאריך" },
  { key: "time", label: "שעה" },
  { key: "verdict", label: "תוצאה" },
  { key: "result", label: "ערך תוצאה" },
  { key: "comments", label: "הערות" },
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
export function itemFieldsOf(step: StepConfig, kind: "item" | "kit", itemTypeId: number): Field[] {
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
      const label = `${i + 1} · ${stationLabel}`;
      const group = r.label;
      const fields = cfg ? itemFieldsOf(cfg, r.kind, r.item_type_id) : [];
      steps.push({
        uid,
        label: r.kind === "kit" ? `${r.label} · ${stationLabel}` : label,
        group,
        fields: fields.map((f) => ({ id: f.id, label: f.label || "שדה", type: f.type })),
      });
      const stepLabel = r.kind === "kit" ? `${r.label} · ${stationLabel}` : label;
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

// ---------------------------------------------------------------- formatting

const TONE_STATUS: Record<ReportTone, string> = { pass: "תקין", warn: "אזהרה", fail: "לא תקין", neutral: "" };

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
      return { value: v.ok === "pass" ? "תקין" : v.ok === "fail" ? "לא תקין" : "", tone: v.ok ?? null };
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

export function toneStatus(tone: ReportTone | null): string {
  return tone ? TONE_STATUS[tone] : "";
}

// ---------------------------------------------------------------- results

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

export interface ResultsRoute {
  route_number: number;
  route_steps: number[];
  step_uids: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** The step uid a row answered: the station-fields schema ref, else the
 *  item's route at the row's position. */
export function rowStepUid(row: ResultRow, route: ResultsRoute): string | null {
  const d = isObj(row.details) ? row.details : null;
  const schema = d && isObj(d.schema) ? d.schema : null;
  if (schema && typeof schema.step_uid === "string" && schema.step_uid) return schema.step_uid;
  if (row.route_number !== route.route_number) return null;
  if (route.step_uids.length !== route.route_steps.length) return null;
  return route.step_uids[row.route_step - 1] ?? null;
}

function legacyPhotos(d: Obj): string[] {
  const out: string[] = [];
  for (const k of ["photo", "product", "pkg"]) {
    const block = d[k];
    if (isObj(block) && Array.isArray(block.photos)) {
      for (const p of block.photos) if (typeof p === "string") out.push(p);
    }
  }
  return out;
}

/** The fields of a row: the station-fields block when present, else what the
 *  legacy popups saved (weight / photos / the documented `fields` array). */
function rowFields(d: Obj | null): ReportFieldResult[] {
  if (!d) return [];
  const out: ReportFieldResult[] = [];
  if (isObj(d.fields)) {
    for (const [id, raw] of Object.entries(d.fields)) {
      if (!isObj(raw) || typeof raw.t !== "string") continue;
      const v = raw as unknown as FieldValue;
      const f = formatFieldValue(v);
      out.push({ id, label: v.label || "שדה", value: f.value, tone: f.tone, ...(v.note ? { note: v.note } : {}), ...(f.photos ? { photos: f.photos } : {}) });
    }
  } else if (Array.isArray(d.fields)) {
    // docs/REPORT_TEMPLATE.md: [{ label, type, value, unit?, min?, max?, expected?, passed? }]
    d.fields.forEach((raw, i) => {
      if (!isObj(raw)) return;
      const label = typeof raw.label === "string" ? raw.label : `שדה ${i + 1}`;
      const val = raw.value;
      const unit = typeof raw.unit === "string" ? ` ${raw.unit}` : "";
      const value = typeof val === "boolean" ? (val ? "כן" : "לא") : val == null ? "" : `${String(val)}${unit}`;
      const tone: ReportTone | null = typeof raw.passed === "boolean" ? (raw.passed ? "pass" : "fail") : null;
      out.push({ id: `legacy_${i}`, label, value, tone });
    });
  }
  if (isObj(d.weight)) {
    const w = d.weight;
    const parts = [w.measured != null ? `נמדד ${String(w.measured)}` : "", w.reference != null ? `ייחוס ${String(w.reference)}` : ""].filter(Boolean);
    out.push({ id: "legacy_weight", label: "משקל", value: parts.join(" · "), tone: typeof w.pass === "boolean" ? (w.pass ? "pass" : "fail") : null });
  }
  const photos = legacyPhotos(d);
  if (photos.length > 0 && !out.some((f) => f.photos)) {
    out.push({ id: "legacy_photos", label: "תמונות", value: `${photos.length} תמונות`, tone: null, photos });
  }
  return out;
}

function orderFields(fields: ReportFieldResult[], order: readonly string[] | undefined): ReportFieldResult[] {
  if (!order) return fields;
  const pos = new Map(order.map((id, i) => [id, i]));
  const at = (f: ReportFieldResult) => pos.get(f.id) ?? Number.MAX_SAFE_INTEGER;
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

function rowVerdict(row: ResultRow, d: Obj | null): "pass" | "fail" | null {
  const verdict = d && isObj(d.verdict) ? d.verdict : null;
  if (verdict?.ok === "pass" || verdict?.ok === "fail") return verdict.ok;
  if (typeof row.passed === "boolean") return row.passed ? "pass" : "fail";
  if (verdict?.suggested === "pass" || verdict?.suggested === "fail") return verdict.suggested;
  return null;
}

export interface DateParts { date: string; time: string }

/**
 * Every station step the item passed, in route order. A step run more than
 * once (released, re-queued, research loop) prints its LATEST row. Research
 * benches are not route steps and are left out; rows of a route the item is
 * no longer on (a retype) do not resolve to a uid of the current route and
 * drop out.
 */
export function buildStepResults(
  rows: readonly ResultRow[],
  route: ResultsRoute,
  fmt: (iso: string) => DateParts,
  knownUids?: ReadonlySet<string>,
  /** step uid → field ids in the config's order. details.fields is jsonb, which
   *  does not keep key order, so the saved order is not the configured one. */
  fieldOrder?: ReadonlyMap<string, readonly string[]>,
): ReportStepResult[] {
  const latest = new Map<string, ResultRow>();
  const ownUids = new Set(route.step_uids);
  for (const row of rows) {
    if (row.station_is_research) continue;
    const uid = rowStepUid(row, route);
    if (!uid) continue;
    if (!ownUids.has(uid) && !(knownUids?.has(uid))) continue;
    const prev = latest.get(uid);
    if (!prev || row.created_at > prev.created_at || (row.created_at === prev.created_at && row.test_result_id > prev.test_result_id)) {
      latest.set(uid, row);
    }
  }
  const out: ReportStepResult[] = [];
  for (const [uid, row] of latest) {
    const d = isObj(row.details) ? row.details : null;
    const verdictNote = d && isObj(d.verdict) && typeof d.verdict.note === "string" ? d.verdict.note : "";
    const { date, time } = fmt(row.created_at);
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
      fields: orderFields(rowFields(d), fieldOrder?.get(uid)),
    });
  }
  out.sort((a, b) => a.position - b.position || a.uid.localeCompare(b.uid));
  return out;
}

/** The overall verdict: fail as soon as any step failed; pass only once the
 *  route has FINISHED and every decided step passed — an item halfway through
 *  its route is not "תקין" yet. */
export function overallVerdict(results: readonly ReportStepResult[], finished = true): "pass" | "fail" | null {
  if (results.some((r) => r.verdict === "fail")) return "fail";
  if (finished && results.length > 0 && results.every((r) => r.verdict === "pass")) return "pass";
  return null;
}

export const VERDICT_WORD = { pass: "תקין", fail: "לא תקין" } as const;

/** The variable values of one item: item.* from `item`, step.* / field.* from
 *  its results, report.* from `report`. */
export function buildValues(
  item: Record<string, string>,
  results: readonly ReportStepResult[],
  report: Record<string, string> = {},
  opts: { finished?: boolean } = {},
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(item)) values[`item.${k}`] = v;
  const overall = overallVerdict(results, opts.finished ?? true);
  if (values["item.verdict"] == null) values["item.verdict"] = overall ? VERDICT_WORD[overall] : "";
  for (const [k, v] of Object.entries(report)) values[`report.${k}`] = v;
  for (const r of results) {
    const p = `step.${r.uid}.`;
    values[p + "station_type"] = r.stationType;
    values[p + "station"] = r.station;
    values[p + "worker"] = r.worker;
    values[p + "worker_number"] = r.workerNumber;
    values[p + "date"] = r.date;
    values[p + "time"] = r.time;
    values[p + "verdict"] = r.verdict ? VERDICT_WORD[r.verdict] : "";
    values[p + "result"] = r.result == null ? "" : String(r.result);
    values[p + "comments"] = r.comments;
    for (const f of r.fields) {
      const fp = `field.${r.uid}.${f.id}`;
      values[fp] = f.value;
      values[fp + ".status"] = toneStatus(f.tone);
      values[fp + ".note"] = f.note ?? "";
    }
  }
  return values;
}

/** Editor sample values: every variable shows its own label. */
export function sampleValues(vars: readonly ReportVar[]): Record<string, string> {
  return Object.fromEntries(vars.map((v) => [v.name, v.label]));
}
