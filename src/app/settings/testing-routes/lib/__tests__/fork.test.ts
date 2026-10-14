import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SharedRouteNotice } from "../../components/editor/SharedRouteNotice";
import { DraftStoreProvider } from "../draftStore";
import type { FlushResult } from "../draftStore";
import { FORK_UNDRAWN_TEXT, FORK_TEXT, forkConfirmMessage, forkErrorText } from "../forkLabels";
import { sharedNoticeText } from "../labels";
import { forkOutcome, forkRoute, forkUrl, parseForkResult } from "../useFork";

// "צור מסלול נפרד למארז הזה" (artboard 2, spec §3.2.1) on the client: the answer's meaning, the
// flush before the request, the dialog's (undrawn) words, and the link in the notice.

const OK: FlushResult = { ok: true };

/** A fetch that records its calls and answers `status` / `body` (or throws when `status` is null). */
function fakeFetch(status: number | null, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (status === null) throw new TypeError("network down");
    return new Response(body === undefined ? "not json" : JSON.stringify(body), { status });
  };
  return { fetch, calls };
}

test("the answer: 201 / 200 with the new route; a shape refusal with its reason; a screen behind the server is stale; the rest failed", () => {
  const route = { test_route_id: 41, route_number: 3 };
  assert.deepEqual(forkOutcome(201, route), { ok: true, data: route });
  assert.deepEqual(forkOutcome(200, { ...route, extra: 1 }), { ok: true, data: route });
  assert.deepEqual(forkOutcome(201, { test_route_id: 41 }), { ok: false, error: { kind: "failed" } }, "a body that is not a route");
  assert.equal(parseForkResult({ test_route_id: 0, route_number: 3 }), null);
  assert.equal(parseForkResult([route]), null);

  const reason = "מסך: מסלול הפריט חייב להסתיים באותה עמדת סגירה כמו מסלול המארז";
  assert.deepEqual(forkOutcome(409, { error: "x", code: "ITEM_ROUTE_SHAPE", reason, package_route_number: 1 }), { ok: false, error: { kind: "shape", reason } });
  assert.deepEqual(forkOutcome(409, { error: "x", code: "PACKAGE_ROUTE_SHAPE", reason: " " }), { ok: false, error: { kind: "shape", reason: null } });
  for (const [status, code] of [[409, "LINE_NOT_ON_ROUTE"], [400, "KIT_LINE_NOT_FOUND"], [404, "ROUTE_NOT_FOUND"], [404, "ITEM_TYPE_NOT_FOUND"]] as const) {
    assert.deepEqual(forkOutcome(status, { error: "x", code }), { ok: false, error: { kind: "stale" } }, code);
  }
  for (const [status, body] of [[409, { code: "ROUTE_NUMBER_TAKEN" }], [400, { code: "INVALID_BODY" }], [403, { error: "Forbidden" }], [500, { code: "CONFIG_INVALID" }], [502, null], [null, null]] as const) {
    assert.deepEqual(forkOutcome(status, body), { ok: false, error: { kind: "failed" } }, String(status));
  }
});

test("forkRoute writes every pending autosave first, then POSTs { package_type_id } to …/[id]/fork", async () => {
  const order: string[] = [];
  const { fetch, calls } = fakeFetch(201, { test_route_id: 41, route_number: 3 });
  const out = await forkRoute(
    {
      flushAll: async () => {
        order.push("flush");
        return OK;
      },
      fetch: async (url, init) => {
        order.push("post");
        return fetch(url, init);
      },
    },
    17,
    5,
  );
  assert.deepEqual(out, { ok: true, data: { test_route_id: 41, route_number: 3 } });
  assert.deepEqual(order, ["flush", "post"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, forkUrl(17));
  assert.equal(calls[0].url, "/api/settings/testing-routes/17/fork");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { package_type_id: 5 });
});

test("forkRoute asks nothing of the server when the source route's edits could not be saved — another route's failure does not stop it", async () => {
  for (const flushed of [
    { ok: false, failed: [17], conflicts: [] },
    { ok: false, failed: [], conflicts: [17] },
  ] as FlushResult[]) {
    const { fetch, calls } = fakeFetch(201, { test_route_id: 41, route_number: 3 });
    assert.deepEqual(await forkRoute({ flushAll: async () => flushed, fetch }, 17, 5), { ok: false, error: { kind: "unsaved" } });
    assert.equal(calls.length, 0);
  }
  const { fetch, calls } = fakeFetch(201, { test_route_id: 41, route_number: 3 });
  const other = await forkRoute({ flushAll: async () => ({ ok: false, failed: [9], conflicts: [8] }), fetch }, 17, 5);
  assert.equal(other.ok, true);
  assert.equal(calls.length, 1);
  // A flush that throws counts as unsaved; a network failure or a body that is not JSON as failed.
  assert.deepEqual(await forkRoute({ flushAll: async () => Promise.reject(new Error("x")), fetch }, 17, 5), { ok: false, error: { kind: "unsaved" } });
  assert.deepEqual(await forkRoute({ flushAll: async () => OK, fetch: fakeFetch(null, null).fetch }, 17, 5), { ok: false, error: { kind: "failed" } });
  assert.deepEqual(await forkRoute({ flushAll: async () => OK, fetch: fakeFetch(500, undefined).fetch }, 17, 5), { ok: false, error: { kind: "failed" } });
});

test("the dialog's words (undrawn): the message names the item, the kit and the kits that stay — one kit 'ימשיך', more 'ימשיכו'; each error has its line", () => {
  assert.equal(
    forkConfirmMessage({ item: "מסך", kit: "מארז עמדת עבודה", otherKits: ["מארז ציוד היקפי"], routeNumber: 1 }),
    "ייווצר מסלול חדש של מסך עם אותן עמדות ואותם שדות, ומארז עמדת עבודה יעבור אליו. מארז ציוד היקפי ימשיך במסלול 1. " + FORK_UNDRAWN_TEXT.tail,
  );
  assert.equal(
    forkConfirmMessage({ item: "מסך", kit: "מארז עמדת עבודה", otherKits: ["מארז מחשב", "מארז ציוד היקפי"], routeNumber: 2 }),
    "ייווצר מסלול חדש של מסך עם אותן עמדות ואותם שדות, ומארז עמדת עבודה יעבור אליו. מארז מחשב, מארז ציוד היקפי ימשיכו במסלול 2. " + FORK_UNDRAWN_TEXT.tail,
  );
  assert.equal(
    forkConfirmMessage({ item: "מסך", kit: "מארז עמדת עבודה", otherKits: [], routeNumber: 1 }),
    "ייווצר מסלול חדש של מסך עם אותן עמדות ואותם שדות, ומארז עמדת עבודה יעבור אליו. " + FORK_UNDRAWN_TEXT.tail,
  );

  assert.equal(forkErrorText({ kind: "unsaved" }), FORK_UNDRAWN_TEXT.unsaved);
  assert.equal(forkErrorText({ kind: "shape", reason: "מסך: מסלול הפריט ריק" }), FORK_UNDRAWN_TEXT.shapePrefix + "מסך: מסלול הפריט ריק");
  assert.equal(forkErrorText({ kind: "shape", reason: null }), FORK_UNDRAWN_TEXT.failed);
  assert.equal(forkErrorText({ kind: "stale" }), FORK_UNDRAWN_TEXT.stale);
  assert.equal(forkErrorText({ kind: "failed" }), FORK_UNDRAWN_TEXT.failed);
  assert.equal(FORK_TEXT.link, "צור מסלול נפרד למארז הזה", "artboard 2");
});

test("the notice ends with the link only when the host passes `fork` (a kit context); the text is artboard 2's either way", () => {
  const text = sharedNoticeText(1, "מסך", ["מארז ציוד היקפי"]);
  const render = (fork?: Parameters<typeof SharedRouteNotice>[0]["fork"]) =>
    renderToStaticMarkup(
      createElement(DraftStoreProvider, { context: null }, createElement(SharedRouteNotice, { routeNumber: 1, item: "מסך", kits: ["מארז ציוד היקפי"], fork })),
    );

  const plain = render();
  assert.match(plain, /role="note"/);
  assert.ok(plain.includes(text));
  assert.ok(!plain.includes(FORK_TEXT.link));
  assert.ok(!plain.includes("<button"));

  const withFork = render({ routeId: 17, packageTypeId: 5, kitName: "מארז עמדת עבודה", onForked: () => {} });
  assert.ok(withFork.includes(text + " <button"), "the link follows the text, after a space");
  assert.match(withFork, /<button type="button" class="sfe-notice__link" aria-haspopup="dialog">צור מסלול נפרד למארז הזה<\/button>/);
  assert.ok(!withFork.includes(FORK_UNDRAWN_TEXT.title), "the dialog is closed until the link is pressed");
});
