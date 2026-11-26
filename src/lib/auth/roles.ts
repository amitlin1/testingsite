// App role names, their Hebrew labels, and who may do what (ACCESS).
//
// These are REALM roles in the `testing` Keycloak realm (realm_access.roles);
// auth.ts also merges client roles, so listing the final names here is enough
// regardless of where they're assigned. realm_access also carries noise
// (default-roles-testing, offline_access, uma_authorization) — only the names
// below carry meaning in this app.
export const APP_ROLES = ["manager", "tester", "storekeeper", "mashan"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABEL: Record<AppRole, string> = {
  manager: "מנהל",
  tester: "בודק",
  storekeeper: "מחסנאי",
  mashan: "משאן",
};

export function isAppRole(v: unknown): v is AppRole {
  return (APP_ROLES as readonly unknown[]).includes(v);
}

/** This app's admin role: it manages users, and the last enabled one cannot be removed. */
export const ADMIN_ROLE: AppRole = "manager";

const SHIPMENTS: readonly AppRole[] = ["manager", "storekeeper"];
const FIELDS_EDIT: readonly AppRole[] = ["manager", "tester"];

/**
 * Who may do what. Every gate reads its set here: the middleware's ROLE_PROTECTED (src/lib/routes.ts),
 * withAuth({ role }) on the API, requireRole, and the screens that hide what the user may not do.
 * A permissions change is one line here. Any one role of a set grants it.
 */
export const ACCESS = accessTable({
  /** User management: /settings/users and /api/users. */
  usersAdmin: ["manager"],
  /** The analytics dashboard and its API. */
  dashboard: ["manager"],
  /** The background jobs' health report (/api/health/jobs). */
  healthJobs: ["manager"],
  /** The testing page and its API: start a test, post a result. */
  testing: ["manager", "tester"],
  /** The shipments screen and its API. */
  shipments: SHIPMENTS,
  /** Take a box in from its shipment, and undo that — the shipments screen's roles. */
  intake: SHIPMENTS,
  /** Delete a shipment whose boxes were already taken in — with those boxes, their items and tests. */
  deleteTakenInShipment: ["manager"],
  /** Create a box directly (POST /api/packages). */
  createPackage: ["manager"],
  /** Step an item back to its previous test (a reason is required). */
  stepBack: ["manager", "tester"],
  /** Pick another worker than yourself: the testing page, shipments, item files. */
  actAsOtherWorker: ["manager"],
  /** File management (/files). */
  files: ["manager", "tester", "mashan"],
  /** Work hours and holidays: the settings page and its API. */
  workHours: ["manager", "mashan"],
  /** Write station-field configuration (routes, drafts, option lists, field sets, popup templates);
   *  the /settings/testing-routes page. */
  fieldsEdit: FIELDS_EDIT,
  /** Publish drafts to the stations. Open decision (spec §10.2-1): the recommendation is manager
   *  only; until it is decided this is the testing-routes page's roles. */
  publish: ["manager", "tester"],
  /** Edit a route's report template — the same people who edit its station fields. */
  reportTemplate: FIELDS_EDIT,
  /** Sign the reports at a kit's closing (the template's "closing" signature). */
  reportClosingSign: ["manager", "tester"],
  /** Give a finished item's report its final signature, which locks it. */
  reportFinalSign: ["manager"],
  /** Settings pages, one per page. */
  customersSettings: ["manager", "storekeeper"],
  itemTypesSettings: ["manager", "tester", "storekeeper"],
  packagesSettings: ["manager", "tester"],
  sourcesSettings: ["manager", "storekeeper"],
  itemStatusSettings: ["manager", "tester"],
  testStationStatusSettings: ["manager", "tester"],
  testStationsSettings: ["manager", "tester"],
  popupTemplatesSettings: ["manager", "tester"],
  referenceItemsSettings: ["manager", "tester", "storekeeper"],
  /** Any settings page without its own entry. */
  otherSettings: ["manager"],
});

/** Keeps ACCESS's keys while typing every entry as readonly AppRole[] (any AppRole may be tested against it). */
function accessTable<K extends string>(table: Record<K, readonly AppRole[]>): Record<K, readonly AppRole[]> {
  return table;
}

/** True if the user has at least one of the listed roles. */
export function hasAnyRole(
  roles: readonly string[],
  required: readonly AppRole[],
): boolean {
  return required.some((r) => roles.includes(r));
}
