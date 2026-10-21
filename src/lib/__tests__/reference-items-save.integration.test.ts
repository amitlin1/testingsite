// Package references (spec: ייחוס מארז) through the real save / delete code and the real
// GET + reference-lookup handlers: a package reference holds one member per content line,
// members are edited only through it, never listed or looked up on their own, and leave
// with it. No images here (an empty upload list never reaches the object store).
//
// Runs ONLY when TEST_DATABASE_URL points at a throwaway, fully migrated database:
//   TEST_DATABASE_URL=postgresql://…/scratch node --import tsx --test src/lib/__tests__/reference-items-save.integration.test.ts
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
const SKIP = TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set — reference-items save suite skipped";

describe("package references", { skip: SKIP }, () => {
  let pool: Pool;
  let save: typeof import("../reference-items-save");
  let list: typeof import("@/app/api/settings/reference-items/route");
  let lookup: typeof import("@/app/api/testing/reference-lookup/route");
  const tag = `t${Date.now() % 1_000_000}`;
  const types = { box: 0, otherBox: 0, pc: 0, mouse: 0, kb: 0 };

  const fields = (sku: string, extra: Record<string, unknown> = {}) => ({
    manufacturer_sku: sku, manufacturer: "HP", name: `שם ${sku}`, reference_weight: "500", notes: "", images: [], ...extra,
  });
  const rows = async (where: string, args: unknown[]) =>
    (await pool.query(`SELECT reference_item_id, item_type_id, manufacturer_sku, parent_reference_id FROM reference_items WHERE ${where} ORDER BY reference_item_id`, args)).rows;
  const rejects = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: unknown) => e instanceof save.ReferenceSaveError && re.test(e.message));

  before(async () => {
    // The app's Prisma client reads DATABASE_URL when first imported.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const mk = async (desc: string, isPackage: boolean) =>
      (await pool.query(`INSERT INTO item_types (item_type_desc, is_package) VALUES ($1, $2) RETURNING item_type_id`, [`${desc} ${tag}`, isPackage])).rows[0].item_type_id as number;
    types.box = await mk("מארז", true);
    types.otherBox = await mk("מארז אחר", true);
    types.pc = await mk("מחשב", false);
    types.mouse = await mk("עכבר", false);
    types.kb = await mk("מקלדת", false);
    save = await import("../reference-items-save");
    list = await import("@/app/api/settings/reference-items/route");
    lookup = await import("@/app/api/testing/reference-lookup/route");
  });

  after(async () => {
    if (!pool) return;
    const ids = Object.values(types).filter(Boolean);
    await pool.query(`DELETE FROM reference_items WHERE item_type_id = ANY($1::int[]) AND parent_reference_id IS NOT NULL`, [ids]);
    await pool.query(`DELETE FROM reference_items WHERE item_type_id = ANY($1::int[])`, [ids]);
    await pool.query(`DELETE FROM item_types WHERE item_type_id = ANY($1::int[])`, [ids]);
    await pool.end();
  });

  let boxId = 0;

  it("creates the box and one member per line, the members pointing at it", async () => {
    boxId = await save.saveReferenceItem(null, {
      item_type_id: types.box, ...fields(`BOX-${tag}`),
      members: [{ item_type_id: types.pc, ...fields(`PC-${tag}`) }, { item_type_id: types.mouse, ...fields(`MS-${tag}`) }],
    });
    const members = await rows("parent_reference_id = $1", [boxId]);
    assert.deepEqual(members.map((m) => m.item_type_id), [types.pc, types.mouse]);
    const [box] = await rows("reference_item_id = $1", [boxId]);
    assert.equal(box.parent_reference_id, null);
  });

  it("lists the package reference with its members, and never a member on its own", async () => {
    const boxes = await (await list.GET(new Request(`http://t/api/settings/reference-items?itemTypeId=${types.box}`))).json();
    assert.equal(boxes.length, 1);
    assert.deepEqual(boxes[0].members.map((m: { manufacturer_sku: string }) => m.manufacturer_sku), [`PC-${tag}`, `MS-${tag}`]);
    const pcs = await (await list.GET(new Request(`http://t/api/settings/reference-items?itemTypeId=${types.pc}`))).json();
    assert.deepEqual(pcs, [], "a member is not a regular reference item of its type");
  });

  it("the box label's lookup brings the members; a member's SKU alone finds nothing", async () => {
    const found = await (await lookup.GET(new Request(`http://t/api/testing/reference-lookup?sku=BOX-${tag}&itemTypeId=${types.box}`))).json();
    assert.equal(found.hasRU, true);
    assert.deepEqual(found.packageMembers.map((m: { item_type_id: number; referenceItem: { manufacturer_sku: string } }) => [m.item_type_id, m.referenceItem.manufacturer_sku]),
      [[types.pc, `PC-${tag}`], [types.mouse, `MS-${tag}`]]);
    const member = await (await lookup.GET(new Request(`http://t/api/testing/reference-lookup?sku=PC-${tag}&itemTypeId=${types.pc}`))).json();
    assert.equal(member.hasRU, false);
  });

  it("an edit updates a kept member, drops the one left out, adds a new one — in one save", async () => {
    const [pc] = await rows("parent_reference_id = $1 AND item_type_id = $2", [boxId, types.pc]);
    const [mouse] = await rows("parent_reference_id = $1 AND item_type_id = $2", [boxId, types.mouse]);
    await save.saveReferenceItem(boxId, {
      item_type_id: types.box, ...fields(`BOX-${tag}`),
      members: [{ item_type_id: types.pc, reference_item_id: pc.reference_item_id, ...fields(`PC2-${tag}`) }, { item_type_id: types.kb, ...fields(`KB-${tag}`) }],
    });
    const members = await rows("parent_reference_id = $1", [boxId]);
    assert.deepEqual(members.map((m) => [m.item_type_id, m.manufacturer_sku]), [[types.pc, `PC2-${tag}`], [types.kb, `KB-${tag}`]]);
    assert.equal(members[0].reference_item_id, pc.reference_item_id, "the kept member is the same row");
    assert.deepEqual(await rows("reference_item_id = $1", [mouse.reference_item_id]), [], "the member left out is gone");
  });

  it("without `members` the members stay as they are", async () => {
    await save.saveReferenceItem(boxId, { item_type_id: types.box, ...fields(`BOX-${tag}`, { name: "שם חדש" }) });
    assert.equal((await rows("parent_reference_id = $1", [boxId])).length, 2);
  });

  it("refuses what the spec rules out, before writing anything", async () => {
    const [pc] = await rows("parent_reference_id = $1 AND item_type_id = $2", [boxId, types.pc]);
    await rejects(save.saveReferenceItem(boxId, { item_type_id: types.box, ...fields(`BOX-${tag}`), members: [{ item_type_id: types.otherBox, ...fields("X") }] }), /סוג מארז/);
    await rejects(save.saveReferenceItem(boxId, { item_type_id: types.box, ...fields(`BOX-${tag}`), members: [{ item_type_id: types.pc, ...fields("A") }, { item_type_id: types.pc, ...fields("B") }] }), /שני פריטי ייחוס/);
    await rejects(save.saveReferenceItem(null, { item_type_id: types.pc, ...fields("R"), members: [{ item_type_id: types.mouse, ...fields("M") }] }), /רק לייחוס של סוג מארז/);
    await rejects(save.saveReferenceItem(boxId, { item_type_id: types.pc, ...fields(`BOX-${tag}`) }), /לא ניתן לשנות/);
    await rejects(save.saveReferenceItem(pc.reference_item_id, { item_type_id: types.pc, ...fields("P") }), /מתוך ייחוס המארז/);
    await rejects(save.saveReferenceItem(boxId, { item_type_id: types.box, ...fields(`BOX-${tag}`, { reference_weight: "0.5kg" }) }), /בגרמים/);
    await rejects(save.saveReferenceItem(boxId, { item_type_id: types.box, ...fields(`BOX-${tag}`), members: [{ item_type_id: types.mouse, ...fields("", { manufacturer_sku: "" }) }] }), /עכבר.*מק״ט/);
    await rejects(save.deleteReferenceItem(pc.reference_item_id), /מתוך ייחוס המארז/);
    const members = await rows("parent_reference_id = $1", [boxId]);
    assert.deepEqual(members.map((m) => m.manufacturer_sku), [`PC2-${tag}`, `KB-${tag}`], "nothing was written");
  });

  it("a regular item still saves as before, its weight a number of grams", async () => {
    const id = await save.saveReferenceItem(null, { item_type_id: types.mouse, ...fields(`REG-${tag}`, { reference_weight: " 90 " }) });
    const { rows: [r] } = await pool.query(`SELECT reference_weight, parent_reference_id FROM reference_items WHERE reference_item_id = $1`, [id]);
    assert.deepEqual(r, { reference_weight: "90", parent_reference_id: null });
  });

  it("deleting the package reference takes its members", async () => {
    const memberIds = (await rows("parent_reference_id = $1", [boxId])).map((m) => m.reference_item_id);
    await save.deleteReferenceItem(boxId);
    assert.deepEqual(await rows("reference_item_id = ANY($1::int[])", [[boxId, ...memberIds]]), []);
  });
});
