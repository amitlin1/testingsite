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
  /** Its overall verdict is "לא תקין" — read only while it waits for the final signature (false
   *  otherwise): an external approval may then stand for that signature. */
  failed: boolean;
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
  /** An external approval (it stands for the final signature): who approved, their role / body,
   *  when, and the manager who showed them the report. */
  externalApprovedBy: string | null;
  externalApprovedRole: string | null;
  externalApprovedAt: string | null;
  externalPresentedBy: string | null;
  version: number;
}

/** The item page offers "אישור גורם חיצוני": the report came out "לא תקין" and waits for the final
 *  signature (a manager's — the same people). */
export function externalApprovalOpen(s: ReportStatus): boolean {
  return s.state === "awaiting_signature" && s.failed;
}

/** The external approval waits for the closing signature (the template asks for it and it was not
 *  given): it comes first — the approval locks the report, and the closing spot would stay blank. */
export function closingBlocksExternalApproval(s: ReportStatus): boolean {
  return s.needsClosingSignature && !s.closingSignedBy;
}

/** GET /api/item-reports/[itemId]/status */
export interface ReportStatusResponse extends ReportStatus {
  /** This user may give the final signature (the item page's button). */
  canSign: boolean;
  /** This user may sign at the kit's closing. */
  canSignClosing: boolean;
}

/** The item page: the report waits for its final signature and its closing one was never given —
 *  it can still be, after the fact. Also on a report an external approval locked without it (given
 *  before the closing one was required first): it is added and the report frozen again. */
export function closingMissingOnItemPage(s: ReportStatus): boolean {
  return (s.state === "awaiting_signature" && s.needsClosingSignature && !s.closingSignedBy) || closingMissingAfterExternal(s);
}

/** An external approval locked the report while its closing signature was missing. */
export function closingMissingAfterExternal(s: ReportStatus): boolean {
  return s.state === "final" && !!s.externalApprovedBy && s.needsClosingSignature && !s.closingSignedBy;
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
