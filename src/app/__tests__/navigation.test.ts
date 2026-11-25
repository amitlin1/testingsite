// The navigation registry's path rules: which menu entry a page lights, and the top bar's title.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTIONS, SETTINGS, SETTINGS_PAGES, activeHref, pageTitle } from "../navigation";

const section = (href: string) => SECTIONS.find((s) => s.href === href)!;

test("a page lights its section; an item's pages belong to the packages section", () => {
  assert.equal(activeHref("/packages/12", SECTIONS), "/packages");
  assert.equal(activeHref("/items/5/history", SECTIONS), "/packages");
  assert.equal(activeHref("/dashboard/tests/kpis", SECTIONS), "/dashboard/tests");
  assert.equal(activeHref("/items", SECTIONS), null);
  assert.equal(activeHref("/settings/test-stations", SETTINGS_PAGES), "/settings/test-stations");
  assert.equal(activeHref("/settings/test-station-status", SETTINGS_PAGES), "/settings/test-station-status");
  assert.equal(activeHref(null, SECTIONS), null);
});

test("the top bar: the section's title on every page of it, an item's history, else the items list", () => {
  assert.equal(pageTitle("/testing").title, section("/testing").label);
  assert.equal(pageTitle("/dashboard/tests/kpis").title, section("/dashboard/tests").label);
  assert.equal(pageTitle("/settings/users").title, SETTINGS.label);
  assert.equal(pageTitle("/items/5/history").title, "היסטוריית פריט");
  assert.equal(pageTitle("/items").title, pageTitle(null).title);
  assert.notEqual(pageTitle("/items").title, pageTitle("/items/5/history").title);
});
