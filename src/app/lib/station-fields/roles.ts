import type { AppRole } from "@/lib/auth/roles";

/**
 * Who may write station-field configuration: routes (steps + step uids), drafts,
 * option lists and field sets. The same roles as the /settings/testing-routes
 * page (src/lib/routes.ts). Reads stay open to any signed-in user, because the
 * intake and the queues still read routes through /api/settings/*.
 */
export const FIELDS_EDIT_ROLES: AppRole[] = ["manager", "tester"];

/**
 * Who may publish a draft to the stations. Open decision (spec §10.2-1): the
 * recommendation is manager only; until it is decided this is the page's roles.
 * Flipping the decision is this one line.
 */
export const PUBLISH_ROLES: AppRole[] = ["manager", "tester"];
