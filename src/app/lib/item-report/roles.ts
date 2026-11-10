import type { AppRole } from "@/lib/auth/roles";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";

/** Who edits a route's report template — the same people who edit its station fields. */
export const REPORT_TEMPLATE_ROLES: AppRole[] = [...FIELDS_EDIT_ROLES];

/** Who signs the reports at a kit's closing (the template's "closing" signature, before "סגור מארז"). */
export const REPORT_CLOSING_SIGN_ROLES: AppRole[] = ["manager", "tester"];

/** Who gives a finished item's report its final signature (the template's "final" signature), which
 *  locks it. The one who signed at the closing may give it too. */
export const REPORT_FINAL_SIGN_ROLES: AppRole[] = ["manager"];
