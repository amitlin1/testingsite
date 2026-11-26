// The role panel reads the access rules; these pin what it must say for each role. Screens and
// settings pages are named by their path (the navigation registry), not by their wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AppRole } from "@/lib/auth/roles";
import { SECTIONS, SETTINGS, SETTINGS_PAGES } from "@/app/navigation";
import { ACCESS } from "@/lib/auth/roles";
import { PERMISSION_SWITCHES, summarize, summarizeRole } from "../roleCapabilities";

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
  for (const href of ["/settings/users", "/settings/customers", "/settings/sources", "/dashboard", "/shipments"]) {
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

test("the actions: a tester starts tests, signs at the closing and steps back; a storekeeper only takes boxes in; a mashan neither", () => {
  const tester = new Set(okIn("tester", "פעולות"));
  for (const l of ["התחלת בדיקה ושליחת תוצאה", "חתימה על הדוחות בסגירת מארז", "חזרה לבדיקה הקודמת"]) assert.ok(tester.has(l), l);
  for (const l of ["קליטת מארז מהמשלוח", "עבודה בשם עובד אחר", "חתימה סופית על דוח פריט"]) assert.ok(!tester.has(l), l);
  assert.deepEqual(okIn("storekeeper", "פעולות"), ["קליטת מארז מהמשלוח"]);
  assert.deepEqual(okIn("mashan", "פעולות"), []);
});

test("the panel follows the bundle Keycloak holds, not the defaults, once there is one", () => {
  // A tester bundle without step-back (removed in Keycloak): the panel says so.
  const bundle = ["perm-testing", "perm-files", "perm-report-closing-sign"];
  const ok = new Set(summarizeRole("tester", bundle).groups.flatMap((g) => g.items.filter((i) => i.ok).map((i) => i.label)));
  assert.ok(ok.has("מסך בדיקה") && ok.has("ניהול קבצים"));
  assert.ok(!ok.has("חזרה לבדיקה הקודמת"));
});

test("one user without step-back: everything else of the bundle stays", () => {
  const tester = summarizeRole("tester");
  const without = summarize(["tester", ACCESS.stepBack.deny]);
  assert.equal(without.allowed, tester.allowed - 1);
  assert.ok(!without.groups.find((g) => g.title === "פעולות")!.items.find((i) => i.label === "חזרה לבדיקה הקודמת")!.ok);
});

test("the permissions dialog: one switch per permission, the testing screen and starting a test share one", () => {
  const keys = PERMISSION_SWITCHES.map((s) => s.perm.key);
  assert.equal(new Set(keys).size, keys.length);
  const testing = PERMISSION_SWITCHES.find((s) => s.perm.key === "testing")!;
  assert.deepEqual(testing.labels, [labelOf("/testing"), "התחלת בדיקה ושליחת תוצאה"]);
  assert.equal(testing.group, "מסכים");
  // "מארזים ופריטים" is open to every signed-in user: no switch.
  assert.ok(!PERMISSION_SWITCHES.some((s) => s.labels.includes(labelOf("/packages"))));
});
