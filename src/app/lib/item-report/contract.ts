/**
 * The item-report wire contract: what the /api/item-reports routes answer, and
 * the rules the clients read off a report's status. Client-safe — no prisma.
 */
import type { Data } from "@measured/puck";
import type { ReportStepRef, ReportVar } from "./types";

export type ReportState =
  | "no_template"   // the item's route has no report template
  | "in_progress"   // a live draft
  | "awaiting_signature" // finished, the template wants the final signature, not signed yet
  | "final";        // finished (+ signed): the stored document

export interface ReportStatus {
  state: ReportState;
  finished: boolean;
  /** The template asks for the approver's final signature (it locks the report). */
  needsSignature: boolean;
  /** The final signature: who gave it, when. */
  signedBy: string | null;
  signedAt: string | null;
  /** The template asks for a signature at the kit's closing. */
  needsClosingSignature: boolean;
  /** The closing signature: who gave it, when. */
  closingSignedBy: string | null;
  closingSignedAt: string | null;
  version: number;
}

/** GET /api/item-reports/[itemId]/status */
export interface ReportStatusResponse extends ReportStatus {
  /** This user may give the final signature (the item page's button). */
  canSign: boolean;
  /** This user may sign at the kit's closing. */
  canSignClosing: boolean;
}

/** The item page: the report waits for its final signature and its closing one was never given —
 *  it can still be, after the fact. */
export function closingMissingOnItemPage(s: ReportStatus): boolean {
  return s.state === "awaiting_signature" && s.needsClosingSignature && !s.closingSignedBy;
}

/** The kit's closing: the report asks for the closing signature and is neither signed at the
 *  closing nor locked yet. */
export function closingStillToSign(s: ReportStatus): boolean {
  return s.needsClosingSignature && s.state !== "final" && !s.closingSignedBy;
}

/** GET /api/item-reports/templates/[routeId] */
export interface RouteTemplateJson {
  route: { test_route_id: number; item_type_id: number; item_type_desc: string; route_number: number; is_package: boolean };
  template: Data | null;
  updated_at: string | null;
  updated_by_name: string | null;
  vars: ReportVar[];
  steps: ReportStepRef[];
}

/** GET /api/item-reports/templates/general */
export interface GeneralTemplateJson {
  template: Data | null;
  updated_at: string | null;
  updated_by_name: string | null;
  vars: ReportVar[];
  steps: ReportStepRef[];
  /** Item routes that use it (no template of their own). */
  routes: number;
}

/** PUT of a template: who saved it, when. */
export interface TemplateSavedJson {
  updated_at: string;
  updated_by_name: string | null;
}
