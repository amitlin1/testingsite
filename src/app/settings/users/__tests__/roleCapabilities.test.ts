// The role panel reads the access rules; these pin what it must say for each role.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRole } from "../roleCapabilities";

const okLabels = (role: Parameters<typeof summarizeRole>[0]) =>
  new Set(summarizeRole(role).groups.flatMap((g) => g.items.filter((i) => i.ok).map((i) => i.label)));

test("a manager reaches everything", () => {
  const s = summarizeRole("manager");
  assert.equal(s.allowed, s.total);
});

test("a tester tests, configures and signs at the closing, but no users, customers, dashboard, shipments, step back or final signature", () => {
  const ok = okLabels("tester");
  for (const l of ["מסך בדיקה", "מסלולי בדיקה", "חתימה על הדוחות בסגירת מארז", "התחלת בדיקה ושליחת תוצאה"]) assert.ok(ok.has(l), l);
  for (const l of ["משתמשים והרשאות", "לקוחות", "לוח ניהול", "משלוחים נכנסים", "חזרה לבדיקה הקודמת", "עבודה בשם עובד אחר", "חתימה סופית על דוח פריט"]) assert.ok(!ok.has(l), l);
});

test("a storekeeper: shipments and box intake, no testing", () => {
  const ok = okLabels("storekeeper");
  for (const l of ["משלוחים נכנסים", "קליטת מארז מהמשלוח", "סוגי פריטים"]) assert.ok(ok.has(l), l);
  for (const l of ["מסך בדיקה", "מסלולי בדיקה", "התחלת בדיקה ושליחת תוצאה"]) assert.ok(!ok.has(l), l);
});

test("a mashan: of the settings, only work hours", () => {
  const settings = summarizeRole("mashan").groups.find((g) => g.title === "הגדרות מערכת")!;
  assert.deepEqual(settings.items.filter((i) => i.ok).map((i) => i.label), ["שעות עבודה וחופשות"]);
});

test("the totals add up", () => {
  const s = summarizeRole("tester");
  assert.equal(s.total, s.groups.reduce((n, g) => n + g.items.length, 0));
  assert.equal(s.allowed, s.groups.reduce((n, g) => n + g.allowed, 0));
});
