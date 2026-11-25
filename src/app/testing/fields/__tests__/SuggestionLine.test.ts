import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suggestionText, type FailItem } from "@/app/lib/station-fields/evaluate";
import { SUGGEST_PREFIX, SUGGEST_PREFIX_DIALOG, SUGGEST_TAIL_WORKER_DECIDES } from "@/app/lib/station-fields/labels";
import type { Field } from "@/app/lib/station-fields/schema";
import { SuggestionLine, type SuggestionLineProps } from "../SuggestionLine";

// Artboard 14's fields: a choice and a number with a unit.
const DEFS: Field[] = [
  { id: "f_led00001", type: "choice_row", label: "נורית מתח", required: true, notes: "required_on_fail", options: [{ id: "o_led00003", label: "לא דולקת", tone: "fail" }] },
  { id: "f_gnd00001", type: "number", label: "התנגדות הארקה", required: true, notes: "optional", unit: "Ω", max: 0.1, out_of_range_fail: true },
];
const FAILS: FailItem[] = [
  { field_id: "f_led00001", label: "נורית מתח", valueText: "לא דולקת" },
  { field_id: "f_gnd00001", label: "התנגדות הארקה", valueText: "0.2 Ω" },
];
const html = (props: Omit<SuggestionLineProps, "defs"> & { defs?: Field[] }): string =>
  renderToStaticMarkup(createElement(SuggestionLine, { defs: DEFS, ...props }));
/** The markup's text, entities decoded. */
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, "")
  .replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The isolated runs of the line (`<bdi>`), with their direction: what a bidi reader keeps apart. */
const runsOf = (markup: string): { dir: string | null; text: string }[] =>
  [...markup.matchAll(/<bdi(?: dir="(\w+)")?[^>]*>([^<]*)<\/bdi>/g)].map((m) => ({ dir: m[1] ?? null, text: textOf(m[2]) }));
/** How many live status regions the markup holds (a live region speaks only for what is added to it). */
const statusRegions = (markup: string) => (markup.match(/role="status"/g) ?? []).length;

test("no fail: the status region is there and empty, so the first suggestion is announced — never a 'מוצע: תקין' line", () => {
  for (const out of [html({ fails: [], prefix: SUGGEST_PREFIX }), html({ fails: [], prefix: SUGGEST_PREFIX_DIALOG, icon: "bulb", decided: "fail", style: { marginTop: 8 } })]) {
    assert.equal(statusRegions(out), 1);
    assert.equal(textOf(out), "");
  }
  assert.match(html({ fails: [], prefix: SUGGEST_PREFIX, id: "s1" }), /id="s1"/, "the region keeps the id a control points at");
});

test("one status region with every fail, as suggestionText writes it", () => {
  const out = html({ fails: FAILS, prefix: SUGGEST_PREFIX });
  assert.equal(statusRegions(out), 1);
  assert.equal(textOf(out), suggestionText(SUGGEST_PREFIX, FAILS));
  assert.equal(textOf(out), "מוצע: לא תקין — 'נורית מתח' = לא דולקת · 'התנגדות הארקה' = 0.2 Ω");
});

test("every label and value is isolated; a number with its unit reads left to right (spec §0.3, §8.11)", () => {
  assert.deepEqual(runsOf(html({ fails: FAILS, prefix: SUGGEST_PREFIX })), [
    { dir: null, text: "נורית מתח" }, { dir: null, text: "לא דולקת" },
    { dir: null, text: "התנגדות הארקה" }, { dir: "ltr", text: "0.2 Ω" },
  ]);
  // a negative reading: the minus stays in front of the number
  assert.deepEqual(runsOf(html({ fails: [{ field_id: "f_gnd00001", label: "התנגדות הארקה", valueText: "-7 °C" }], prefix: SUGGEST_PREFIX }))[1], { dir: "ltr", text: "-7 °C" });
  // without the number's definition, the value is not taken for one
  assert.deepEqual(runsOf(html({ fails: FAILS.slice(1), prefix: SUGGEST_PREFIX, defs: [] }))[1], { dir: null, text: "0.2 Ω" });
});

test("each artboard's own words: 13's tail after the suggestion, 14's prefix", () => {
  const withTail = html({ fails: FAILS.slice(0, 1), prefix: SUGGEST_PREFIX, tail: SUGGEST_TAIL_WORKER_DECIDES, icon: "triangle" });
  assert.equal(textOf(withTail), "מוצע: לא תקין — 'נורית מתח' = לא דולקת · ההחלטה בידי העובד");
  const dialog = html({ fails: FAILS.slice(0, 1), prefix: SUGGEST_PREFIX_DIALOG, icon: "bulb", size: "12.5", style: { marginTop: 8 } });
  assert.equal(textOf(dialog), "מוצע לסמן כלא תקין — 'נורית מתח' = לא דולקת");
});
