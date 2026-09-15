/**
 * Convert pre-package-model rows into packages — docs/packages/PLAN.md §8.
 *
 * Before the package model every top-level items row was a product that might
 * carry "accessories" (rows pointing at it). Now every item lives inside a
 * PACKAGE: a row of a package type (item_types.is_package) with its own route.
 * This script builds that box above each legacy group — the old parent and
 * its accessories, or a standalone item — and re-ids every row into the new
 * 16-digit format (1 CCC ddMMyy NNNN SS; the box ends in 00).
 *
 * It is only safe for rows nobody has worked on: the group must sit at step 1,
 * status 2 (waiting), with no results, no station history, no research and
 * no attached files. Anything else is reported and left alone. Ledger rows of
 * the old ids are erased with metrics_forget_item and the new rows get a
 * fresh `legacy_import` → queued event, so their waiting clocks start at the
 * conversion (PLAN.md §8: nothing measured on them is worth keeping).
 *
 * Usage:
 *   node -r dotenv/config scripts/convert-legacy-to-packages.mjs --map map.json          # dry run
 *   node -r dotenv/config scripts/convert-legacy-to-packages.mjs --map map.json --apply  # convert
 *   (append dotenv_config_path=.env.development to pick the env file)
 *
 * map.json: { "<legacy top-level item_type_id>": <package item_type_id>, ... }
 *   — which package type a legacy product of each type becomes. Package types
 *   and their contents (settings → מארזים) must exist first: an item's route
 *   number comes from the contents line of its type (else 1) and must fit the
 *   package route, exactly as the intake form enforces.
 *
 * --apply converts every group that passed validation and lists the rest;
 * add --strict to refuse the whole run when any group fails. The old → new id
 * mapping is written to convert-legacy-<timestamp>.json next to this script.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// --- id format (mirrors src/app/lib/packages/ids.ts) ------------------------
const ID_LEADING_DIGIT = "1";
const MAX_CUSTOMER_ID = 999;
const MAX_DAILY_PACKAGES = 9999;
const MAX_PACKAGE_SEQ = 99;

function packageIdBase(customerId, datePart, counter) {
  if (!Number.isInteger(customerId) || customerId < 1 || customerId > MAX_CUSTOMER_ID) {
    throw new Error(`customer id ${customerId} does not fit the 3-digit id field`);
  }
  if (!Number.isInteger(counter) || counter < 1 || counter > MAX_DAILY_PACKAGES) {
    throw new Error(`daily package counter ${counter} does not fit the 4-digit id field`);
  }
  if (!/^\d{6}$/.test(datePart)) throw new Error(`date part "${datePart}" must be ddMMyy`);
  return `${ID_LEADING_DIGIT}${String(customerId).padStart(3, "0")}${datePart}${String(counter).padStart(4, "0")}`;
}
const packageIdOf = (base) => `${base}00`;
const itemIdOf = (base, seq) => `${base}${String(seq).padStart(2, "0")}`;

// --- cli ----------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const apply = flag("--apply");
const strict = flag("--strict");
const mapPath = opt("--map");
if (!mapPath) {
  console.error("missing --map <file.json>  ({ \"<legacy item_type_id>\": <package item_type_id> })");
  process.exit(2);
}
const typeMap = new Map(
  Object.entries(JSON.parse(fs.readFileSync(mapPath, "utf8"))).map(([k, v]) => [Number(k), Number(v)]),
);

// --- route rules (mirrors src/app/lib/packages/route-rules.ts) --------------
function checkPackageRoute(steps, packageLevel, routeNumber) {
  if (!steps) return `package type has no route ${routeNumber}`;
  if (steps.length === 0) return "package route is empty";
  if (!packageLevel.has(steps[0])) return "package route must start at a package-level station type";
  if (!packageLevel.has(steps[steps.length - 1])) return "package route must end at a package-level station type";
  if (steps.slice(1, -1).some((s) => packageLevel.has(s))) return "package route has a package-level step in the middle";
  return null;
}
function checkItemRoute(steps, pkgSteps, packageLevel, routeNumber) {
  if (!steps) return `item type has no route ${routeNumber}`;
  if (steps.length === 0) return "item route is empty";
  if (steps[0] !== pkgSteps[0]) return "item route must start at the package's opening station type";
  if (steps[steps.length - 1] !== pkgSteps[pkgSteps.length - 1]) return "item route must end at the package's closing station type";
  if (steps.slice(1, -1).some((s) => packageLevel.has(s))) return "item route has a package-level step in the middle";
  return null;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

  // --- reference data ---------------------------------------------------------
  const packageLevel = new Set(
    (await q(`SELECT test_station_type_id FROM test_stations_type WHERE package_level`)).map((r) => r.test_station_type_id),
  );
  const types = new Map(
    (await q(`SELECT item_type_id, TRIM(item_type_desc) AS d, is_package FROM item_types`)).map((r) => [
      r.item_type_id,
      { desc: r.d, isPackage: r.is_package },
    ]),
  );
  const routes = new Map(); // `${type}:${route}` -> steps
  for (const r of await q(`SELECT item_type_id, route_number, route_steps FROM testing_routes`)) {
    routes.set(`${r.item_type_id}:${r.route_number}`, r.route_steps ?? []);
  }
  const contents = new Map(); // packageType -> lines
  for (const r of await q(
    `SELECT package_type_id, item_type_id, quantity, makat, model, manufacturer_name, manufacturer_no,
            manufacturer_sku, route_number, sort_order
       FROM package_contents ORDER BY package_type_id, sort_order, id`,
  )) {
    if (!contents.has(r.package_type_id)) contents.set(r.package_type_id, []);
    contents.get(r.package_type_id).push(r);
  }

  // --- legacy groups ----------------------------------------------------------
  // A legacy top is a row with no package that is NOT of a package type: the
  // old "parent" (with rows pointing at it) or a standalone item.
  const tops = await q(`
    SELECT i.item_id::text AS item_id, i.customer_id, i.item_type_id, i.shipment_id, i.serial_no, i.makat,
           i.model, i.manufacturer_name, i.manufacturer_no,
           s.makat AS shipment_makat,
           ir.current_status, ir.current_route_step, ir.is_finished, ir.route_number,
           ir.created_at, ir.queue_start_time,
           to_char(ir.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jerusalem', 'DDMMYY') AS date_part,
           to_char(ir.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS date_key
      FROM items i
      JOIN item_types t ON t.item_type_id = i.item_type_id
      LEFT JOIN item_routes ir ON ir.item_id = i.item_id
      LEFT JOIN shipments s ON s.id = i.shipment_id
     WHERE i.package_id IS NULL AND NOT t.is_package
     ORDER BY i.item_id`);

  const groups = [];
  for (const top of tops) {
    const children = await q(
      `SELECT i.item_id::text AS item_id, i.customer_id, i.item_type_id, i.shipment_id, i.serial_no, i.makat,
              i.model, i.manufacturer_name, i.manufacturer_no,
              ir.current_status, ir.current_route_step, ir.is_finished, ir.route_number,
              ir.created_at, ir.queue_start_time
         FROM items i LEFT JOIN item_routes ir ON ir.item_id = i.item_id
        WHERE i.package_id = $1::bigint
        ORDER BY i.package_seq, i.item_id`,
      [top.item_id],
    );
    groups.push({ top, children, rows: [top, ...children], problems: [] });
  }

  // --- validation -------------------------------------------------------------
  for (const g of groups) {
    const ids = g.rows.map((r) => r.item_id);
    const pkgType = typeMap.get(g.top.item_type_id);
    if (pkgType == null) {
      g.problems.push(`no mapping for legacy type ${g.top.item_type_id} (${types.get(g.top.item_type_id)?.desc ?? "?"})`);
    } else if (!types.get(pkgType)?.isPackage) {
      g.problems.push(`mapped type ${pkgType} is not a package type`);
    }
    if (g.rows.length > MAX_PACKAGE_SEQ) g.problems.push(`${g.rows.length} rows — a package holds at most ${MAX_PACKAGE_SEQ}`);
    if (g.top.customer_id > MAX_CUSTOMER_ID) g.problems.push(`customer ${g.top.customer_id} does not fit the id`);

    for (const r of g.rows) {
      if (r.current_status == null) g.problems.push(`${r.item_id}: no item_routes row`);
      else if (r.current_status !== 2 || r.current_route_step !== 1 || r.is_finished) {
        g.problems.push(`${r.item_id}: touched (status ${r.current_status}, step ${r.current_route_step}${r.is_finished ? ", finished" : ""})`);
      }
      if (types.get(r.item_type_id)?.isPackage) g.problems.push(`${r.item_id}: is of a package type`);
    }

    const [touched] = await q(
      `SELECT (SELECT count(*) FROM test_results       WHERE item_id = ANY($1::bigint[])) AS results,
              (SELECT count(*) FROM item_route_history WHERE item_id = ANY($1::bigint[])) AS history,
              (SELECT count(*) FROM research_history   WHERE item_id = ANY($1::bigint[])) AS research,
              (SELECT count(*) FROM file_objects WHERE entity_type = 'item_attachment'
                  AND entity_id = ANY($2::text[]) AND status <> 'deleted')                 AS files`,
      [ids, ids],
    );
    for (const [k, v] of Object.entries(touched)) if (Number(v) > 0) g.problems.push(`${v} ${k} row(s) exist`);

    if (pkgType != null && types.get(pkgType)?.isPackage) {
      const pkgSteps = routes.get(`${pkgType}:1`);
      const pkgProblem = checkPackageRoute(pkgSteps, packageLevel, 1);
      if (pkgProblem) g.problems.push(pkgProblem);
      else {
        const lines = contents.get(pkgType) ?? [];
        for (const r of g.rows) {
          const line = lines.find((l) => l.item_type_id === r.item_type_id);
          const routeNumber = line?.route_number ?? 1;
          r.new_route_number = routeNumber;
          const p = checkItemRoute(routes.get(`${r.item_type_id}:${routeNumber}`), pkgSteps, packageLevel, routeNumber);
          if (p) g.problems.push(`${r.item_id} (${types.get(r.item_type_id)?.desc}): ${p}`);
        }
      }
    }
  }

  const valid = groups.filter((g) => g.problems.length === 0);
  const invalid = groups.filter((g) => g.problems.length > 0);

  console.log(`legacy groups: ${groups.length}  convertible: ${valid.length}  blocked: ${invalid.length}`);
  for (const g of invalid) {
    console.log(`\n- ${g.top.item_id} (${types.get(g.top.item_type_id)?.desc}, ${g.rows.length} row(s)) BLOCKED:`);
    for (const p of g.problems) console.log(`    ${p}`);
  }
  for (const g of valid) {
    console.log(
      `\n- ${g.top.item_id} (${types.get(g.top.item_type_id)?.desc}, ${g.rows.length} row(s)) -> package type ${typeMap.get(g.top.item_type_id)} (${types.get(typeMap.get(g.top.item_type_id))?.desc}), intake ${g.top.date_key}`,
    );
  }

  if (!apply) {
    console.log("\ndry run — nothing written. Add --apply to convert.");
    await pool.end();
    return;
  }
  if (strict && invalid.length > 0) {
    console.error(`\n--strict: ${invalid.length} blocked group(s), refusing to convert anything.`);
    await pool.end();
    process.exit(1);
  }

  // --- apply --------------------------------------------------------------------
  const mapping = [];
  for (const g of valid) {
    const client = await pool.connect();
    const pkgType = typeMap.get(g.top.item_type_id);
    const pkgSteps = routes.get(`${pkgType}:1`);
    try {
      await client.query("BEGIN");

      // The box is dated by the ORIGINAL intake day, and numbered after that
      // day's counter, so its id reads like every other id of that day.
      const counterRows = await client.query(
        `INSERT INTO daily_counters (date_key, counter) VALUES ($1::date, 1)
         ON CONFLICT (date_key) DO UPDATE SET counter = daily_counters.counter + 1
         RETURNING counter`,
        [g.top.date_key],
      );
      const counter = Number(counterRows.rows[0].counter);
      const base = packageIdBase(g.top.customer_id, g.top.date_part, counter);
      const packageId = packageIdOf(base);

      const stationFor = async (typeId) => {
        const r = await client.query(
          `SELECT test_station_id FROM test_stations
            WHERE test_station_type_id = $1 AND status <> 3
            ORDER BY (status = 2) DESC, test_station_id LIMIT 1`,
          [typeId],
        );
        return r.rows[0]?.test_station_id ?? null;
      };

      await client.query(
        `INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model, manufacturer_name,
                            manufacturer_no, shipment_id, package_id, package_seq, package_next_seq, template_snapshot)
         VALUES ($1::bigint, $2, $3, NULL, $4, '', '', '', $5, NULL, NULL, $6, $7::jsonb)`,
        [
          packageId, g.top.customer_id, pkgType, (g.top.shipment_makat ?? g.top.makat ?? "").trim(),
          g.top.shipment_id, g.rows.length + 1, JSON.stringify(contents.get(pkgType) ?? []),
        ],
      );
      await client.query(
        `INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step, test_station_id,
                                  created_at, is_finished, queue_start_time, route_number)
         VALUES ($1::bigint, $2, 2, 1, $3, $4, false, $5, 1)`,
        [packageId, pkgType, await stationFor(pkgSteps[0]), g.top.created_at, g.top.queue_start_time ?? g.top.created_at],
      );

      const newIds = [];
      for (let i = 0; i < g.rows.length; i++) {
        const r = g.rows[i];
        const seq = i + 1;
        const newId = itemIdOf(base, seq);
        const steps = routes.get(`${r.item_type_id}:${r.new_route_number}`);
        await client.query(
          `INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model, manufacturer_name,
                              manufacturer_no, shipment_id, package_id, package_seq)
           VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8, $9, $10::bigint, $11)`,
          [
            newId, r.customer_id, r.item_type_id, r.serial_no, r.makat, r.model, r.manufacturer_name,
            r.manufacturer_no ?? "", r.shipment_id, packageId, seq,
          ],
        );
        await client.query(
          `INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step, test_station_id,
                                    created_at, is_finished, queue_start_time, route_number)
           VALUES ($1::bigint, $2, 2, 1, $3, $4, false, $5, $6)`,
          [newId, r.item_type_id, await stationFor(steps[0]), r.created_at, r.queue_start_time ?? r.created_at, r.new_route_number],
        );
        newIds.push({ old: r.item_id, new: newId, seq });
      }

      // Ledger: the old ids are erased, the new rows are born now.
      for (const r of g.rows) await client.query(`SELECT metrics_forget_item($1::bigint)`, [r.item_id]);
      await client.query(
        `SELECT metrics_record($1, $2::bigint, 'queued', 1, NULL, $3::int, NULL, NULL, 'legacy_import')`,
        [`legacy_import:${packageId}`, packageId, pkgSteps[0]],
      );
      for (const n of newIds) {
        const r = g.rows[n.seq - 1];
        const steps = routes.get(`${r.item_type_id}:${r.new_route_number}`);
        await client.query(
          `SELECT metrics_record($1, $2::bigint, 'queued', 1, NULL, $3::int, NULL, NULL, 'legacy_import')`,
          [`legacy_import:${n.new}`, n.new, steps[0]],
        );
      }

      // Old rows: routes first, then the rows that point at the old parent,
      // then the parent.
      const oldIds = g.rows.map((r) => r.item_id);
      await client.query(`DELETE FROM item_routes WHERE item_id = ANY($1::bigint[])`, [oldIds]);
      await client.query(`DELETE FROM items WHERE item_id = ANY($1::bigint[]) AND package_id IS NOT NULL`, [oldIds]);
      await client.query(`DELETE FROM items WHERE item_id = $1::bigint`, [g.top.item_id]);

      await client.query("COMMIT");
      mapping.push({ legacyTop: g.top.item_id, packageId, items: newIds });
      console.log(`converted ${g.top.item_id} -> package ${packageId} (${newIds.length} item(s))`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`FAILED ${g.top.item_id}: ${err.message}`);
      mapping.push({ legacyTop: g.top.item_id, error: err.message });
    } finally {
      client.release();
    }
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(here, `convert-legacy-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ appliedAt: new Date().toISOString(), map: Object.fromEntries(typeMap), groups: mapping }, null, 2));
  console.log(`\nid mapping written to ${out}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
