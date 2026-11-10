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

test("a tester tests, configures and signs at the closing, but no users, customers, sources, dashboard, shipments, box intake, step back or final signature", () => {
  const ok = okLabels("tester");
  for (const l of ["מסך בדיקה", "מסלולי בדיקה", "חתימה על הדוחות בסגירת מארז", "התחלת בדיקה ושליחת תוצאה"]) assert.ok(ok.has(l), l);
  for (const l of ["משתמשים והרשאות", "לקוחות", "לוח ניהול", "משלוחים נכנסים", "ניהול מקורות", "קליטת מארז מהמשלוח", "חזרה לבדיקה הקודמת", "עבודה בשם עובד אחר", "חתימה סופית על דוח פריט"]) assert.ok(!ok.has(l), l);
});

test("a storekeeper: boxes, shipments and intake, and exactly four settings pages", () => {
  const s = summarizeRole("storekeeper");
  const ok = (title: string) => s.groups.find((g) => g.title === title)!.items.filter((i) => i.ok).map((i) => i.label);
  assert.deepEqual(ok("מסכים"), ["מארזים ופריטים", "משלוחים נכנסים"]);
  assert.deepEqual(ok("הגדרות מערכת"), ["לקוחות", "סוגי פריטים", "ניהול מקורות", "פריטי ייחוס"]);
  assert.deepEqual(ok("פעולות"), ["קליטת מארז מהמשלוח"]);
});

test("a mashan takes no box in", () => {
  assert.ok(!okLabels("mashan").has("קליטת מארז מהמשלוח"));
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
