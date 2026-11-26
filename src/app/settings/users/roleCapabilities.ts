// What each role may do — the "מה כל תפקיד יכול לעשות" panel on the users page, and the per-user
// permissions dialog — and how a role is drawn there.
//
// Read from the rules that ENFORCE access, never retyped beside them, so the
// panel cannot drift from what the system really allows:
//   - screens and settings pages → the permission their path needs (permissionForPath, the
//     middleware's own table in src/lib/routes.ts), named by the navigation registry
//     (src/app/navigation.ts);
//   - signing, publishing and the actions checked in code → their ACCESS entries.
// Whether a set of roles holds a permission is can() (src/lib/auth/roles.ts), the gates' own check.

import { ACCESS, can, type AppRole, type Permission } from "@/lib/auth/roles";
import { permissionForPath } from "@/lib/routes";
import { SECTIONS, SETTINGS, SETTINGS_PAGES } from "@/app/navigation";

/** One line of the panel. perm = null: open to every signed-in user. */
export type Capability = { label: string; perm: Permission | null };
export type CapabilityGroup = { title: string; items: Capability[] };

export const ROLE_DESCRIPTION: Record<AppRole, string> = {
  manager: "גישה מלאה לכל המערכת: ניהול משתמשים ולקוחות, לוח הניהול, ופעולות שרק מנהל רשאי לבצע.",
  tester: "עובד בעמדות הבדיקה, ומגדיר מסלולים, שדות ותבניות לעמדות.",
  storekeeper: "מטפל במשלוחים הנכנסים ובקליטת המארזים, ובהגדרות הלקוחות, הפריטים והמקורות.",
  mashan: "מנהל את שעות העבודה והחופשות.",
};

// A role is a category, not a state: one neutral tag and one dot colour per
// role, the same in the KPI card, the table and the panel. Never the status
// colours (green / amber read as "ok" / "waiting" next to the status column).
export const ROLE_DOT: Record<AppRole, string> = {
  manager: "var(--color-ink)",
  tester: "var(--color-primary)",
  storekeeper: "var(--color-ink-muted-48)",
  mashan: "color-mix(in srgb, var(--color-primary) 45%, var(--color-canvas))",
};

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    title: "מסכים",
    items: SECTIONS.map((s) => ({ label: s.label, perm: permissionForPath(s.href) })),
  },
  {
    title: SETTINGS.label,
    items: SETTINGS_PAGES.map((s) => ({ label: s.label, perm: permissionForPath(s.href) })),
  },
  {
    title: "פעולות",
    items: [
      { label: "קליטת מארז מהמשלוח", perm: ACCESS.intake },
      // The testing API's permission — the same one as the testing screen.
      { label: "התחלת בדיקה ושליחת תוצאה", perm: permissionForPath("/api/testing/results") },
      { label: "חתימה על הדוחות בסגירת מארז", perm: ACCESS.reportClosingSign },
      { label: "חתימה סופית על דוח פריט", perm: ACCESS.reportFinalSign },
      { label: "פרסום שדות לעמדות", perm: ACCESS.publish },
      // api/testing/step-back and its button.
      { label: "חזרה לבדיקה הקודמת", perm: ACCESS.stepBack },
      // The worker pickers: testing page, shipments (useShipmentWorker), item files.
      { label: "עבודה בשם עובד אחר", perm: ACCESS.actAsOtherWorker },
    ],
  },
];

export type RoleSummary = {
  groups: { title: string; items: { label: string; ok: boolean }[]; allowed: number }[];
  allowed: number;
  total: number;
};

/** What a set of roles reaches, line by line. */
export function summarize(roles: readonly string[]): RoleSummary {
  let allowed = 0;
  let total = 0;
  const groups = CAPABILITY_GROUPS.map((g) => {
    const items = g.items.map((c) => ({ label: c.label, ok: c.perm == null || can(roles, c.perm) }));
    const n = items.filter((i) => i.ok).length;
    allowed += n;
    total += items.length;
    return { title: g.title, items, allowed: n };
  });
  return { groups, allowed, total };
}

/**
 * What a main role reaches. `bundle`: the perm-… roles its Keycloak bundle holds (GET
 * /api/users/role-bundles); left out — or empty, a realm the migration script has not run on —
 * the default bundle answers (can()).
 */
export function summarizeRole(role: AppRole, bundle: readonly string[] = []): RoleSummary {
  return summarize([role, ...bundle]);
}

/** One switch of a user's permissions dialog: a permission, named by every panel line it covers
 *  (the testing screen and "start a test" are one permission, so one switch), in the group of the
 *  first of them. */
export type PermissionSwitch = { perm: Permission; labels: string[]; group: string };

/** The panel's permissions in its order, each once. Lines open to everyone have no switch. */
export const PERMISSION_SWITCHES: PermissionSwitch[] = (() => {
  const out: PermissionSwitch[] = [];
  for (const g of CAPABILITY_GROUPS) {
    for (const { label, perm } of g.items) {
      if (!perm) continue;
      const seen = out.find((s) => s.perm.key === perm.key);
      if (seen) seen.labels.push(label);
      else out.push({ perm, labels: [label], group: g.title });
    }
  }
  return out;
})();
