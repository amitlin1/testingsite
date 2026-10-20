/**
 * Item report (דוח פריט) — the shapes the print components read.
 *
 * Ported from ticketflow's PdfRenderMeta: the SAME metadata object feeds the
 * template editor (mode "edit": labels as sample values, logo URLs) and the
 * server renderer (mode "print": the item's real values, every image as a data
 * URL so Chromium makes no network call — air-gap safe).
 *
 * Pure module — no prisma / next / React.
 */

/** A variable the template can place ({{name}} / a chip in the rich text). */
export interface ReportVar {
  /** "item.serial_no", "step.<uid>.worker", "field.<uid>.<fieldId>", … */
  name: string;
  /** What the editor shows on the chip / in the picker. */
  label: string;
  /** Picker group: "פרטי הפריט", "קליטה וצילום · מסלול", … */
  group: string;
}

/** A field of a station step, as the step-bound blocks list it. */
export interface ReportFieldRef {
  id: string;
  label: string;
  /** station-fields FieldType ("number", "photo", …) or "legacy". */
  type: string;
}

/** A station step the template can bind to (StepFields / Photos / Signature). */
export interface ReportStepRef {
  /** The step uid (testing_routes.step_uids), unique across routes. */
  uid: string;
  /** "3 · בדיקה חשמלית" or "מארז X · פתיחת מארז". */
  label: string;
  /** Picker group (the route the step belongs to). */
  group: string;
  fields: ReportFieldRef[];
}

export type ReportTone = "pass" | "warn" | "fail" | "neutral";

/** One filled field of a step, ready to print. */
export interface ReportFieldResult {
  id: string;
  label: string;
  /** The value as text ("27.9 V", "תקין", "א ✓ · ב ✗"). */
  value: string;
  tone: ReportTone | null;
  note?: string;
  /** Photo fields: MinIO object keys (resolved through meta.photos). */
  photos?: string[];
}

/** The result of one station step the item passed. */
export interface ReportStepResult {
  uid: string;
  /** Position in the route (1-based) — the order of the results table. */
  position: number;
  /** The station type ("בדיקה חשמלית"). */
  stationType: string;
  /** The physical station the test ran on ("עמדה 3"). */
  station: string;
  worker: string;
  workerNumber: string;
  /** dd.mm.yyyy */
  date: string;
  /** HH:mm */
  time: string;
  verdict: "pass" | "fail" | null;
  /** test_results.result — the numeric "תוצאת בדיקה". */
  result: number | null;
  comments: string;
  fields: ReportFieldResult[];
}

/** The signer of a Signature block's bind (resolved identity + date). */
export interface ReportSignerInfo {
  fullName: string;
  number: string;
  date: string;
  station?: string;
}

export interface ReportRenderMeta {
  mode: "edit" | "print";
  /** Variable catalog — chip labels in the editor. */
  vars: ReportVar[];
  /** Steps the step-bound blocks can pick. */
  steps: ReportStepRef[];
  /** variable name → printed value (real in print, the label in edit). */
  values: Record<string, string>;
  /** Every step the item passed, in route order (print only). */
  results: ReportStepResult[];
  /** photo object key → image src (data URL in print). */
  photos: Record<string, string>;
  /** Signature image keyed by the Signature block's bind ("final"). */
  signatures: Record<string, string>;
  /** bind → the signer ("final" → who signed; "step:<uid>" → the worker). */
  signerMeta: Record<string, ReportSignerInfo>;
  /** logo object key → image src (data URL in print; logo route URL in edit). */
  logos: Record<string, string>;
  /** Marks the unsigned Signature block with this bind ("חתום/י כאן"). */
  highlightBind?: string;
  /** Not the final document — prints a "טיוטה" mark on the page. */
  draft?: boolean;
}

/** The bind of the one hand-drawn signature: whoever signs the finished report. */
export const FINAL_SIGNATURE_BIND = "final";
