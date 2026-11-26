// The StepBacks block: the times the item went back to a test, with who sent it back and why —
// and nothing at all on an item that never went back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplateBody } from "../render-react";
import { generalStarterTemplate } from "../starter";
import type { ReportRenderMeta, ReportStepBack } from "../types";

const meta = (stepBacks: ReportStepBack[]): ReportRenderMeta => ({
  mode: "print", vars: [], steps: [], values: {}, results: [], stepBacks,
  photos: {}, signatures: {}, signerMeta: {}, logos: {},
});

const back: ReportStepBack = {
  date: "26.11.2026", time: "09:15", fromStep: 3, toStep: 2, from: "בדיקה חשמלית", to: "בדיקה ויזואלית",
  worker: "ישראל ישראלי", workerNumber: "1234", reason: "נמצא שבר במחבר",
};

test("the general starter template carries the StepBacks block", () => {
  assert.ok((generalStarterTemplate().content as { type: string }[]).some((n) => n.type === "StepBacks"));
});

test("an item sent back: who, from where to where, and why", async () => {
  const html = await renderTemplateBody(generalStarterTemplate(), meta([back, { ...back, reason: "" }]));
  for (const s of ["החזרות לבדיקה חוזרת", "ישראל ישראלי", "1234", "נמצא שבר במחבר", "3. בדיקה חשמלית", "2. בדיקה ויזואלית", "26.11.2026 09:15"]) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(html.includes("לא נרשמה סיבה"), "an older step back without a reason says so");
});

test("an item never sent back: the block prints nothing", async () => {
  const html = await renderTemplateBody(generalStarterTemplate(), meta([]));
  assert.ok(!html.includes("החזרות לבדיקה חוזרת"));
  assert.ok(!html.includes("pdf-stepbacks"));
});
