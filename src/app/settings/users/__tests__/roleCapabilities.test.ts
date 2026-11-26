// The role panel reads the access rules; these pin what it must say for each role. Screens and
// settings pages are named by their path (the navigation registry), not by their wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AppRole } from "@/lib/auth/roles";
import { SECTIONS, SETTINGS, SETTINGS_PAGES } from "@/app/navigation";
import { summarizeRole } from "../roleCapabilities";

const labelOf = (href: string) => [...SECTIONS, ...SETTINGS_PAGES].find((e) => e.href === href)!.label;
const okIn = (role: AppRole, title: string) =>
  summarizeRole(role).groups.find((g) => g.title === title)!.items.filter((i) => i.ok).map((i) => i.label);
const okLabels = (role: AppRole) =>
  new Set(summarizeRole(role).groups.flatMap((g) => g.items.filter((i) => i.ok).map((i) => i.label)));

test("a manager reaches everything", () => {
  const s = summarizeRole("manager");
  assert.equal(s.allowed, s.total);
});

test("a tester tests and configures the stations, but has no users, customers, sources, dashboard or shipments", () => {
  const ok = okLabels("tester");
  for (const href of ["/testing", "/settings/testing-routes", "/settings/popup-templates"]) assert.ok(ok.has(labelOf(href)), href);
  for (const href of ["/settings/users", "/settings/customers", "/settings/sources", "/dashboard/tests", "/shipments"]) {
    assert.ok(!ok.has(labelOf(href)), href);
  }
});

test("a storekeeper: boxes and shipments, and exactly four settings pages", () => {
  assert.deepEqual(okIn("storekeeper", "מסכים"), ["/packages", "/shipments"].map(labelOf));
  assert.deepEqual(
    okIn("storekeeper", SETTINGS.label),
    ["/settings/customers", "/settings/item-types", "/settings/sources", "/settings/reference-items"].map(labelOf),
  );
});

test("a mashan: of the settings, only work hours", () => {
  assert.deepEqual(okIn("mashan", SETTINGS.label), [labelOf("/settings/work-hours")]);
});

test("the actions: a tester starts tests, steps items back and signs at the closing; a storekeeper only takes boxes in; a mashan neither", () => {
  const tester = new Set(okIn("tester", "פעולות"));
  for (const l of ["התחלת בדיקה ושליחת תוצאה", "חזרה לבדיקה הקודמת", "חתימה על הדוחות בסגירת מארז"]) assert.ok(tester.has(l), l);
  for (const l of ["קליטת מארז מהמשלוח", "עבודה בשם עובד אחר", "חתימה סופית על דוח פריט"]) assert.ok(!tester.has(l), l);
  assert.deepEqual(okIn("storekeeper", "פעולות"), ["קליטת מארז מהמשלוח"]);
  assert.deepEqual(okIn("mashan", "פעולות"), []);
});
