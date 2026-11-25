// The settings lookup writes own the unique-name rule and the refusal texts (src/app/lib/lookups.ts):
// a name another row has is refused on create and on edit alike, with code NAME_TAKEN (the screens
// show it on the field), and a row other records still use is refused with the screens' Hebrew text.
//
// Drives the real handlers, which are not wrapped in withAuth (authentication lives in the
// middleware). Runs ONLY when TEST_DATABASE_URL points at a throwaway database.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as H from "@/test-support/db-harness";
import { NAME_TAKEN } from "../contract";

type Json = Record<string, unknown>;
type Ctx = { params: Promise<{ id: string }> };
type Post = (req: Request) => Promise<Response>;
type WithId = (req: Request, ctx: Ctx) => Promise<Response>;

const ctx = (id: number): Ctx => ({ params: Promise.resolve({ id: String(id) }) });
const put = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const del = (path: string) => new Request(`http://localhost${path}`, { method: "DELETE" });
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as Json });

const MARK = "settings-writes suite";

describe(
  "settings lookup writes: the unique name and the refusals",
  { skip: H.skipReason() },
  () => {
    let postSource: Post;
    let putSource: WithId;
    let postCustomer: Post;
    let putCustomer: WithId;
    let deleteStationType: WithId;

    before(async () => {
      await H.setup();
      postSource = (await import("../../../api/settings/sources/route")).POST;
      putSource = (await import("../../../api/settings/sources/[id]/route")).PUT;
      postCustomer = (await import("../../../api/settings/customers/route")).POST;
      putCustomer = (await import("../../../api/settings/customers/[id]/route")).PUT;
      deleteStationType = (await import("../../../api/settings/test-stations-type/[id]/route")).DELETE;
    });
    after(async () => {
      try {
        await H.q("DELETE FROM sources WHERE source_desc LIKE $1", [`${MARK}%`]);
      } finally {
        await H.teardown();
      }
    });
    beforeEach(async () => {
      await H.resetDb();
      await H.q("DELETE FROM sources WHERE source_desc LIKE $1", [`${MARK}%`]);
    });

    it("a source name another source has is refused on create and on edit, case-blind", async () => {
      const first = await read(await postSource(H.jsonRequest("/api/settings/sources", { source_desc: `${MARK} A` })));
      assert.equal(first.status, 200);
      const second = await read(await postSource(H.jsonRequest("/api/settings/sources", { source_desc: `${MARK} B` })));
      assert.equal(second.status, 200);

      const again = await read(await postSource(H.jsonRequest("/api/settings/sources", { source_desc: `${MARK} a` })));
      assert.deepEqual([again.status, again.body.code], [400, NAME_TAKEN]);
      assert.equal(again.body.error, "מקור בשם זה כבר קיים במערכת");

      // An edit to the other row's name: the same refusal.
      const id = second.body.source_id as number;
      const rename = await read(await putSource(put(`/api/settings/sources/${id}`, { source_desc: ` ${MARK} A ` }), ctx(id)));
      assert.deepEqual([rename.status, rename.body.code], [400, NAME_TAKEN]);

      // Its own name, re-saved, is not a clash.
      const same = await read(await putSource(put(`/api/settings/sources/${id}`, { source_desc: `${MARK} B` }), ctx(id)));
      assert.deepEqual([same.status, same.body.source_desc], [200, `${MARK} B`]);
    });

    it("no two customers share a name, on create and on edit", async () => {
      const taken = await read(
        await postCustomer(H.jsonRequest("/api/settings/customers", { name: "integration", customer_code: "902" })),
      );
      assert.deepEqual([taken.status, taken.body.code], [400, NAME_TAKEN]);

      const created = await read(
        await postCustomer(H.jsonRequest("/api/settings/customers", { name: "OTHER", customer_code: "903" })),
      );
      assert.equal(created.status, 200);
      const id = created.body.id as number;
      const rename = await read(
        await putCustomer(put(`/api/settings/customers/${id}`, { name: "INTEGRATION", customer_code: "903" }), ctx(id)),
      );
      assert.deepEqual([rename.status, rename.body.code], [400, NAME_TAKEN]);
    });

    it("a station type that still has stations is refused with the screen's text", async () => {
      const refused = await read(await deleteStationType(del(`/api/settings/test-stations-type/${H.TYPE_FUNC}`), ctx(H.TYPE_FUNC)));
      assert.deepEqual(refused, { status: 409, body: { error: "לא ניתן למחוק כי קיימות עמדות משויכות. מחק או העבר אותן קודם." } });
    });
  },
);
