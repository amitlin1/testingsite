import type { AppRole } from "@/lib/auth/roles";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";

/** Who edits a route's report template — the same people who edit its station fields. */
export const REPORT_TEMPLATE_ROLES: AppRole[] = [...FIELDS_EDIT_ROLES];

/** Who signs a finished item's report (the template's "final" signature). */
export const REPORT_SIGN_ROLES: AppRole[] = ["manager", "tester"];
