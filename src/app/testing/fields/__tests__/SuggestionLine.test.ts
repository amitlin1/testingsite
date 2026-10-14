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

test("no fail: the status region alone, empty — never a 'מוצע: תקין' line", () => {
  assert.equal(html({ fails: [], prefix: SUGGEST_PREFIX }), '<div role="status"></div>');
  assert.equal(html({ fails: [], prefix: SUGGEST_PREFIX_DIALOG, icon: "bulb", decided: "fail", style: { marginTop: 8 } }), '<div role="status"></div>');
  assert.equal(html({ fails: [], prefix: SUGGEST_PREFIX, id: "s1" }), '<div role="status" id="s1"></div>');
});

test("one status line with every fail, as suggestionText writes it", () => {
  const out = html({ fails: FAILS, prefix: SUGGEST_PREFIX });
  assert.match(out, /^<div role="status"><div style=/);
  assert.equal(textOf(out), suggestionText(SUGGEST_PREFIX, FAILS));
  assert.equal(textOf(out), "מוצע: לא תקין — 'נורית מתח' = לא דולקת · 'התנגדות הארקה' = 0.2 Ω");
});

test("a number and its unit read left to right, every label and value isolated (spec §0.3, §8.11)", () => {
  const out = html({ fails: FAILS, prefix: SUGGEST_PREFIX });
  assert.match(out, /<bdi dir="ltr" style="font-variant-numeric:tabular-nums;white-space:nowrap">0\.2 Ω<\/bdi>/);
  assert.match(out, /&#x27;<bdi>התנגדות הארקה<\/bdi>&#x27; = /);
  // a choice's value keeps its own direction (Hebrew)
  assert.match(out, /&#x27;<bdi>נורית מתח<\/bdi>&#x27; = <bdi>לא דולקת<\/bdi> · /);
  // a negative reading: the minus stays in front of the number
  const neg = html({ fails: [{ field_id: "f_gnd00001", label: "התנגדות הארקה", valueText: "-7 °C" }], prefix: SUGGEST_PREFIX });
  assert.match(neg, /<bdi dir="ltr"[^>]*>-7 °C<\/bdi>/);
  // without the number's definition, the value is not taken for one
  const unknown = html({ fails: FAILS.slice(1), prefix: SUGGEST_PREFIX, defs: [] });
  assert.match(unknown, /<bdi>0\.2 Ω<\/bdi>/);
});

test("warning ink, blue once the worker chose 'לא תקין' (artboards 12, 15, 16)", () => {
  assert.match(html({ fails: FAILS, prefix: SUGGEST_PREFIX }), /color:var\(--color-warning-ink\)/);
  assert.match(html({ fails: FAILS, prefix: SUGGEST_PREFIX, decided: "pass" }), /color:var\(--color-warning-ink\)/);
  assert.match(html({ fails: FAILS, prefix: SUGGEST_PREFIX, decided: "" }), /color:var\(--color-warning-ink\)/);
  assert.match(html({ fails: FAILS, prefix: SUGGEST_PREFIX, decided: "fail" }), /color:var\(--color-primary\)/);
});

test("artboard 13's muted tail, artboard 14's size", () => {
  const withTail = html({ fails: FAILS.slice(0, 1), prefix: SUGGEST_PREFIX, tail: SUGGEST_TAIL_WORKER_DECIDES, icon: "triangle" });
  assert.equal(textOf(withTail), "מוצע: לא תקין — 'נורית מתח' = לא דולקת · ההחלטה בידי העובד");
  assert.match(withTail, /<span style="color:var\(--color-ink-muted-48\)"> · ההחלטה בידי העובד<\/span>/);

  const dialog = html({ fails: FAILS.slice(0, 1), prefix: SUGGEST_PREFIX_DIALOG, icon: "bulb", size: "12.5", style: { marginTop: 8 } });
  assert.equal(textOf(dialog), "מוצע לסמן כלא תקין — 'נורית מתח' = לא דולקת");
  assert.match(dialog, /font-size:12.5px/);
  assert.match(dialog, /margin-top:8px/);
});
