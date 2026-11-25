// What each role may do — the "מה כל תפקיד יכול לעשות" panel on the users page — and how a role
// is drawn there.
//
// Read from the rules that ENFORCE access, never retyped beside them, so the
// panel cannot drift from what the system really allows:
//   - screens, settings pages and API-gated actions → resolveAccess()
//     (src/lib/routes.ts, the middleware's own table);
//   - the screens and settings pages themselves → the navigation registry (src/app/navigation.ts);
//   - signing, publishing and the actions checked in code → their ACCESS entries.
// Adding a capability here does not grant it; change the rule, the panel follows.

import { ACCESS, type AppRole } from "@/lib/auth/roles";
import { resolveAccess } from "@/lib/routes";
import { SECTIONS, SETTINGS, SETTINGS_PAGES } from "@/app/navigation";

export type Capability = { label: string; allowed: (role: AppRole) => boolean };
export type CapabilityGroup = { title: string; items: Capability[] };

/** The role may open this path (page or API) — the middleware's verdict. */
const can = (path: string) => (role: AppRole) => resolveAccess(path, [role]).kind === "allowed";

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
    items: SECTIONS.map((s) => ({ label: s.label, allowed: can(s.href) })),
  },
  {
    title: SETTINGS.label,
    items: SETTINGS_PAGES.map((s) => ({ label: s.label, allowed: can(s.href) })),
  },
  {
    title: "פעולות",
    items: [
      { label: "קליטת מארז מהמשלוח", allowed: can("/api/packages/intake") },
      { label: "התחלת בדיקה ושליחת תוצאה", allowed: can("/api/testing/results") },
      { label: "חתימה על הדוחות בסגירת מארז", allowed: (r) => ACCESS.reportClosingSign.includes(r) },
      { label: "חתימה סופית על דוח פריט", allowed: (r) => ACCESS.reportFinalSign.includes(r) },
      { label: "פרסום שדות לעמדות", allowed: (r) => ACCESS.publish.includes(r) },
      // api/testing/step-back and its button.
      { label: "חזרה לבדיקה הקודמת", allowed: (r) => ACCESS.stepBack.includes(r) },
      // The worker pickers: testing page, shipments (useShipmentWorker), item files.
      { label: "עבודה בשם עובד אחר", allowed: (r) => ACCESS.actAsOtherWorker.includes(r) },
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
