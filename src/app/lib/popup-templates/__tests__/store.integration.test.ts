// Integration suite for the popup-template store (docs/popup-templates/PLAN.md, step 1.2), against a
// real database: save (create, new versions, conflicts, content issues, the base rules), the photo
// groups a template's photo components own (created, linked, deactivated, taken), and delete
// (groups released, the numbering carries on).
//
// Runs ONLY when TEST_DATABASE_URL points at a throwaway database carrying the popup-templates
// migration; without it the suite is skipped. DATABASE_URL is pointed at it before the store (and
// the Prisma client) load. It holds the ledger suites' advisory lock for its life — they TRUNCATE
// test_stations_type, which would cascade into its fixture — and removes its own rows at the end.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { PopupTemplateConfig } from "../schema";
import { closingTemplate, openingTemplate, photoStationTemplate, verdictStationTemplate } from "../templates";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
const LEDGER_TRUNCATE_LOCK = 526050825;

/** Fixture station types — ids far above the seeded ones. */
const ITEM_TYPE = 9101;
const OTHER_TYPE = 9102;
const PACKAGE_TYPE = 9103;
/** An existing group no template owns yet, as photo groups 3 / 4 are today. */
const LEGACY_CODE = "it_legacy_grp";
const ACTOR = { username: "templates-suite", name: "Templates Suite" };

type Store = typeof import("../store");

describe("popup-template store", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set" }, () => {
  let pool: Pool;
  let lock: import("pg").PoolClient;
  let store: Store;
  let disconnect: () => Promise<void>;
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

  async function cleanup() {
    await q("DELETE FROM photo_types WHERE test_station_type_id IN ($1, $2, $3) OR code = $4 OR code LIKE 'k\\_%'", [ITEM_TYPE, OTHER_TYPE, PACKAGE_TYPE, LEGACY_CODE]);
    await q("DELETE FROM test_stations_type WHERE test_station_type_id IN ($1, $2, $3)", [ITEM_TYPE, OTHER_TYPE, PACKAGE_TYPE]);
  }

  before(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    lock = await pool.connect();
    await lock.query("SELECT pg_advisory_lock($1)", [LEDGER_TRUNCATE_LOCK]);
    store = await import("../store");
    const { prisma } = await import("../../prisma");
    disconnect = () => prisma.$disconnect();
  });

  after(async () => {
    if (pool) await cleanup();
    if (disconnect) await disconnect();
    if (lock) {
      await lock.query("SELECT pg_advisory_unlock($1)", [LEDGER_TRUNCATE_LOCK]);
      lock.release();
    }
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    await cleanup();
    await q(
      `INSERT INTO test_stations_type (test_station_type_id, test_type_desc, package_level) VALUES
         ($1, 'TPL ITEM', false), ($2, 'TPL OTHER', false), ($3, 'TPL PACKAGE', true)`,
      [ITEM_TYPE, OTHER_TYPE, PACKAGE_TYPE],
    );
    await q("INSERT INTO photo_types (code, photo_type_desc, sort_order, is_active) VALUES ($1, 'legacy', 99, true)", [LEGACY_CODE]);
  });

  const save = (typeId: number, config: PopupTemplateConfig, expected: number | null, base: "item" | "package" = "item") =>
    store.saveTemplate(typeId, { base, config, expectedVersion: expected }, ACTOR);
  const rejects = async (p: Promise<unknown>, status: number, code: string) => {
    await assert.rejects(p, (e: unknown) => e instanceof store.TemplateStoreError && e.status === status && e.code === code, code);
  };
  const group = async (code: string) =>
    (await q<{ test_station_type_id: number | null; component_id: string | null; is_active: boolean; photo_type_desc: string }>(
      "SELECT test_station_type_id, component_id, is_active, photo_type_desc FROM photo_types WHERE code = $1", [code]))[0];

  it("creates, versions and reads a template; a stale editor is refused", async () => {
    assert.equal(await store.getTemplate(ITEM_TYPE), null);
    const v1 = await save(ITEM_TYPE, verdictStationTemplate(), null);
    assert.equal(v1.version, 1);
    assert.equal(v1.updated_by, ACTOR.username);
    assert.deepEqual((await store.getTemplate(ITEM_TYPE))?.config, v1.config);

    const v2 = await save(ITEM_TYPE, verdictStationTemplate(), 1);
    assert.equal(v2.version, 2);
    await rejects(save(ITEM_TYPE, verdictStationTemplate(), 1), 409, "TEMPLATE_CONFLICT");
    await rejects(save(OTHER_TYPE, verdictStationTemplate(), 3), 409, "TEMPLATE_CONFLICT");

    const versions = await q<{ version: number }>("SELECT version FROM station_popup_template_versions WHERE test_station_type_id = $1 ORDER BY version", [ITEM_TYPE]);
    assert.deepEqual(versions.map((r) => r.version), [1, 2]);
    assert.deepEqual((await store.listTemplateSummaries()).filter((s) => s.station_type_id === ITEM_TYPE).map((s) => [s.base, s.version]), [["item", 2]]);
  });

  it("refuses content issues and the wrong base", async () => {
    const bad = verdictStationTemplate();
    bad.steps[1].components.pop();
    await rejects(save(ITEM_TYPE, bad, null), 422, "TEMPLATE_INVALID");
    await rejects(save(PACKAGE_TYPE, verdictStationTemplate(), null), 409, "BASE_MISMATCH");
    await rejects(save(ITEM_TYPE, verdictStationTemplate(), null, "package"), 409, "BASE_MISMATCH");
    await rejects(save(PACKAGE_TYPE, verdictStationTemplate(), null, "package"), 422, "TEMPLATE_INVALID");
    await rejects(save(PACKAGE_TYPE, closingTemplate(), null, "package"), 409, "PACKAGE_BASE_NOT_YET");
    await rejects(save(9999, verdictStationTemplate(), null), 404, "STATION_TYPE_NOT_FOUND");
    assert.equal(await store.getTemplate(ITEM_TYPE), null, "nothing was written");
  });

  it("saves an opening template; its box and item photo components own their groups", async () => {
    const cfg = openingTemplate(LEGACY_CODE, "k_itemgrp01");
    const saved = await save(PACKAGE_TYPE, cfg, null, "package");
    assert.deepEqual([saved.base, saved.version, saved.config.role], ["package", 1, "opening"]);
    assert.deepEqual(saved.config.item_flow, cfg.item_flow, "the item flow is kept as sent");
    const boxPhoto = cfg.steps[1].components.find((c) => c.kind === "photo")!;
    const itemPhoto = cfg.item_flow![1].components.find((c) => c.kind === "photo")!;
    const box = await group(LEGACY_CODE);
    const items = await group("k_itemgrp01");
    assert.deepEqual([box.test_station_type_id, box.component_id, box.is_active], [PACKAGE_TYPE, boxPhoto.id, true]);
    assert.deepEqual([items.test_station_type_id, items.component_id, items.is_active], [PACKAGE_TYPE, itemPhoto.id, true]);
  });

  it("a photo component owns its group: links an existing one, creates a new one, keeps both named", async () => {
    const linked = await save(ITEM_TYPE, photoStationTemplate(LEGACY_CODE), null);
    const photo = linked.config.steps[1].components[0];
    let g = await group(LEGACY_CODE);
    assert.deepEqual([g.test_station_type_id, g.component_id, g.is_active], [ITEM_TYPE, photo.id, true]);
    assert.equal(g.photo_type_desc, "TPL ITEM · תיעוד בתמונות");

    // The same group for another type's component is taken.
    await rejects(save(OTHER_TYPE, photoStationTemplate(LEGACY_CODE), null), 409, "PHOTO_CODE_TAKEN");
    // Within the type it moves to the component that names it now (a re-seed mints new ids).
    const reseeded = await save(ITEM_TYPE, photoStationTemplate(LEGACY_CODE), 1);
    assert.equal((await group(LEGACY_CODE)).component_id, reseeded.config.steps[1].components[0].id);
    await save(ITEM_TYPE, linked.config, 2);

    // A new photo component with its own code: a new group.
    const cfg = linked.config;
    const fresh = { ...photo, id: "k_newphoto", photo_code: "k_newphoto", title: "צילום נוסף" };
    cfg.steps[1].components.splice(1, 0, fresh);
    await save(ITEM_TYPE, cfg, 3);
    g = await group("k_newphoto");
    assert.deepEqual([g.test_station_type_id, g.component_id, g.is_active, g.photo_type_desc], [ITEM_TYPE, "k_newphoto", true, "TPL ITEM · צילום נוסף"]);

    // The first photo component leaves the template: its group stays linked, inactive.
    cfg.steps[1].components.splice(0, 1);
    await save(ITEM_TYPE, cfg, 4);
    g = await group(LEGACY_CODE);
    assert.deepEqual([g.test_station_type_id, g.component_id, g.is_active], [ITEM_TYPE, photo.id, false]);
  });

  it("delete: the code's popup again, the groups released, the numbering carries on", async () => {
    await save(ITEM_TYPE, photoStationTemplate(LEGACY_CODE), null);
    await save(ITEM_TYPE, photoStationTemplate(LEGACY_CODE), 1);
    await store.deleteTemplate(ITEM_TYPE);
    assert.equal(await store.getTemplate(ITEM_TYPE), null);
    const g = await group(LEGACY_CODE);
    assert.deepEqual([g.test_station_type_id, g.component_id, g.is_active], [null, null, true]);
    await rejects(store.deleteTemplate(ITEM_TYPE), 404, "TEMPLATE_NOT_FOUND");

    const again = await save(ITEM_TYPE, verdictStationTemplate(), null);
    assert.equal(again.version, 3, "versions 1-2 are kept, so the next is 3");
  });
});
