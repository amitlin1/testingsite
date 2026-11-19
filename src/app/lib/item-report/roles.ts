import type { AppRole } from "@/lib/auth/roles";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";

/** Who edits a route's report template — the same people who edit its station fields. */
export const REPORT_TEMPLATE_ROLES: AppRole[] = [...FIELDS_EDIT_ROLES];

/** Who signs the reports at a kit's closing (the template's "closing" signature, before "סגור מארז"). */
export const REPORT_CLOSING_SIGN_ROLES: AppRole[] = ["manager", "tester"];

/** Who gives a finished item's report its final signature (the template's "final" signature), which
 *  locks it. The one who signed at the closing may give it too. */
export const REPORT_FINAL_SIGN_ROLES: AppRole[] = ["manager"];

/** The role a closing signature prints in its "תפקיד החותם" cell — of the signed-in user at the
 *  moment they sign: a manager (also one who is a tester too) "מנהל", a tester "בודק". Only those
 *  two may sign at the closing (REPORT_CLOSING_SIGN_ROLES); anyone else gets "". */
export function signerRoleLabel(roles: readonly string[]): string {
  if (roles.includes("manager")) return "מנהל";
  if (roles.includes("tester")) return "בודק";
  return "";
}
