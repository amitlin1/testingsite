// What each role may do — the "מה כל תפקיד יכול לעשות" panel on the users page.
//
// Read from the rules that ENFORCE access, never retyped beside them, so the
// panel cannot drift from what the system really allows:
//   - screens, settings pages and API-gated actions → resolveAccess()
//     (src/lib/routes.ts, the middleware's own table);
//   - the settings list itself → settingsLinks (the settings menu);
//   - signing / publishing → their role constants;
//   - manager-only actions checked in code → isAdmin(), as the pages do.
// Adding a capability here does not grant it; change the rule, the panel follows.

import { APP_ROLES, isAdmin, type AppRole } from "@/lib/auth/roles";
import { resolveAccess } from "@/lib/routes";
import { settingsLinks } from "../settingsNav";
import { REPORT_CLOSING_SIGN_ROLES, REPORT_FINAL_SIGN_ROLES } from "@/app/lib/item-report/roles";
import { PUBLISH_ROLES } from "@/app/lib/station-fields/roles";

export type Capability = { label: string; allowed: (role: AppRole) => boolean };
export type CapabilityGroup = { title: string; items: Capability[] };

/** The role may open this path (page or API) — the middleware's verdict. */
const can = (path: string) => (role: AppRole) => resolveAccess(path, [role]).kind === "allowed";

export const ROLE_DESCRIPTION: Record<AppRole, string> = {
  manager: "גישה מלאה לכל המערכת: ניהול משתמשים ולקוחות, לוח הניהול, ופעולות שרק מנהל רשאי לבצע.",
  tester: "עובד בעמדות הבדיקה, ומגדיר מסלולים, שדות ותבניות לעמדות.",
  storekeeper: "מטפל במשלוחים הנכנסים, בקליטת המארזים ובהגדרות הפריטים.",
  mashan: "מנהל את שעות העבודה והחופשות.",
};

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    title: "מסכים",
    items: [
      { label: "מארזים ופריטים", allowed: can("/packages") },
      { label: "מסך בדיקה", allowed: can("/testing") },
      { label: "לוח ניהול", allowed: can("/dashboard/tests") },
      { label: "משלוחים נכנסים", allowed: can("/shipments") },
      { label: "ניהול קבצים", allowed: can("/files") },
    ],
  },
  {
    title: "הגדרות מערכת",
    items: settingsLinks.map((s) => ({ label: s.label, allowed: can(s.path) })),
  },
  {
    title: "פעולות",
    items: [
      { label: "קליטת מארז מהמשלוח", allowed: can("/api/packages/intake") },
      { label: "התחלת בדיקה ושליחת תוצאה", allowed: can("/api/testing/results") },
      { label: "חתימה על הדוחות בסגירת מארז", allowed: (r) => REPORT_CLOSING_SIGN_ROLES.includes(r) },
      { label: "חתימה סופית על דוח פריט", allowed: (r) => REPORT_FINAL_SIGN_ROLES.includes(r) },
      { label: "פרסום שדות לעמדות", allowed: (r) => PUBLISH_ROLES.includes(r) },
      // api/testing/step-back (withAuth role "manager") and its button (isAdmin).
      { label: "חזרה לבדיקה הקודמת", allowed: (r) => isAdmin([r]) },
      // The worker pickers: testing page, shipments (useShipmentWorker), item files.
      { label: "עבודה בשם עובד אחר", allowed: (r) => isAdmin([r]) },
    ],
  },
];

export type RoleSummary = {
  groups: { title: string; items: { label: string; ok: boolean }[]; allowed: number }[];
  allowed: number;
  total: number;
};

export function summarizeRole(role: AppRole): RoleSummary {
  let allowed = 0;
  let total = 0;
  const groups = CAPABILITY_GROUPS.map((g) => {
    const items = g.items.map((c) => ({ label: c.label, ok: c.allowed(role) }));
    const n = items.filter((i) => i.ok).length;
    allowed += n;
    total += items.length;
    return { title: g.title, items, allowed: n };
  });
  return { groups, allowed, total };
}

export const ALL_ROLES: readonly AppRole[] = APP_ROLES;
