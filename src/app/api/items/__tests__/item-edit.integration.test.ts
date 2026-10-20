// PUT /api/items/[id] — makat, model, manufacturer and manufacturer number are OPTIONAL: an item
// takes its box's (the shipment certificate's), which may leave any of them empty, so an edit that
// clears them (or never sends them) saves. Only customer, type and — for an item — the serial are
// required. And a malformed id is a 400, never a 500.
//
// Runs ONLY when TEST_DATABASE_URL points at a throwaway database (the write-path harness).
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as H from "../../../lib/metrics/__tests__/write-path-helpers";

const BLANK = { makat: "", model: "", manufacturer: "", manufacturerNo: "" };

describe(
  "item edit — makat / model / manufacturer may be empty; malformed ids answer 400",
  { skip: H.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set — item-edit integration suite skipped" },
  () => {
    let GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

    before(async () => {
      await H.setup();
      GET = (await import("../[id]/route")).GET;
    });
    after(async () => {
      await H.teardown();
    });
    beforeEach(async () => {
      await H.resetDb();
    });

    const details = (itemId: number) =>
      H.one<{ makat: string; model: string; manufacturer_name: string; manufacturer_no: string; serial_no: string | null }>(
        `SELECT makat, TRIM(model) AS model, TRIM(manufacturer_name) AS manufacturer_name, manufacturer_no, serial_no
           FROM items WHERE item_id = $1`,
        [itemId],
      );
    const read = (id: string) => GET(new Request(`http://localhost/api/items/${id}`), { params: Promise.resolve({ id }) });

    it("a plain item: every optional detail cleared — saves, stored empty, reads back", async () => {
      await H.seedItem({ itemId: 7101 });
      const r = await H.updateItem(7101, { customer: H.CUSTOMER_ID, itemType: H.ITEM_TYPE_ONE_STEP, serialNumber: "SN-7101", ...BLANK });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(await details(7101), { makat: "", model: "", manufacturer_name: "", manufacturer_no: "", serial_no: "SN-7101" });
      const got = await read("7101");
      assert.equal(got.status, 200);
    });

    it("a plain item: the optional details not sent at all — saves", async () => {
      await H.seedItem({ itemId: 7102 });
      const r = await H.updateItem(7102, { customer: H.CUSTOMER_ID, itemType: H.ITEM_TYPE_ONE_STEP, serialNumber: "SN-7102" });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(await details(7102), { makat: "", model: "", manufacturer_name: "", manufacturer_no: "", serial_no: "SN-7102" });
    });

    it("whitespace-only details are stored empty", async () => {
      await H.seedItem({ itemId: 7103 });
      const r = await H.updateItem(7103, { customer: H.CUSTOMER_ID, itemType: H.ITEM_TYPE_ONE_STEP, serialNumber: "SN-7103", makat: "   ", model: "", manufacturer: "" });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal((await details(7103)).makat, "");
    });

    it("an item inside a box, and the box itself, save with the details empty", async () => {
      const kit = await H.h().prisma.$transaction((tx: any) =>
        H.h().createPackage(tx, {
          customer: H.CUSTOMER_ID, shipment: H.SHIPMENT_ID, packageType: H.ITEM_TYPE_PACKAGE_CLOSE,
          items: [{ itemType: H.ITEM_TYPE_IN_BOX, serialNumber: "SN-BOX-1", makat: "MK-1", model: "MODEL", manufacturer: "MFR" }],
        }),
      );
      const [item] = kit.itemIds as number[];
      let r = await H.updateItem(item, { customer: H.CUSTOMER_ID, itemType: H.ITEM_TYPE_IN_BOX, serialNumber: "SN-BOX-1", ...BLANK });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(await details(item), { makat: "", model: "", manufacturer_name: "", manufacturer_no: "", serial_no: "SN-BOX-1" });

      r = await H.updateItem(kit.packageId, { customer: H.CUSTOMER_ID, itemType: H.ITEM_TYPE_PACKAGE_CLOSE, serialNumber: "", ...BLANK });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal((await details(kit.packageId)).makat, "");
    });

    it("what IS required still is: customer and type (400), an item's serial (400)", async () => {
      await H.seedItem({ itemId: 7104 });
      let r = await H.updateItem(7104, { itemType: H.ITEM_TYPE_ONE_STEP, serialNumber: "SN-7104", ...BLANK });
      assert.equal(r.status, 400);
      r = await H.updateItem(7104, { customer: H.CUSTOMER_ID, serialNumber: "SN-7104", ...BLANK });
      assert.equal(r.status, 400);
      r = await H.updateItem(7104, { customer: H.CUSTOMER_ID, itemType: H.ITEM_TYPE_ONE_STEP, serialNumber: "", ...BLANK });
      assert.equal(r.status, 400, JSON.stringify(r.body));
    });

    it("a malformed id is a 400 on GET / PUT / DELETE — never a 500", async () => {
      const mod = await import("../[id]/route");
      for (const id of ["undefined", "abc", "1.5", "", "12x", "-3"]) {
        const ctx = { params: Promise.resolve({ id }) };
        const body = JSON.stringify({ customer: H.CUSTOMER_ID, itemType: H.ITEM_TYPE_ONE_STEP, serialNumber: "x" });
        const put = await mod.PUT(new Request(`http://localhost/api/items/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body }), ctx);
        const del = await mod.DELETE(new Request(`http://localhost/api/items/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" }), ctx);
        const get = await mod.GET(new Request(`http://localhost/api/items/${id}`), ctx);
        assert.deepEqual([get.status, put.status, del.status], [400, 400, 400], `id "${id}"`);
      }
      // "itemId-sourceId" (the barcode format) still reads.
      await H.seedItem({ itemId: 7105 });
      assert.equal((await read("7105-2")).status, 200);
    });
  },
);
