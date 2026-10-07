// Fill a DEVELOPMENT database with demo data for the package model
// (docs/packages/PLAN.md): package-level station types, package types with
// their templates, routes that obey the route-shape rules, shipments that
// declare package types, and ~16 boxes spread over every package state —
// queued at opening, opening in test, items mid-route, an item in research,
// waiting for its items (status 6), ready to close, and closed.
//
//   # the app has to be running (npm run dev) against a DB that already has
//   # the 20260915120000_package_model migration, then from the repo root:
//   node scripts/seed-packages-demo.mjs --confirm
//   node scripts/seed-packages-demo.mjs --confirm --api http://localhost:3000
//
// Everything goes through the app's own HTTP APIs — the same calls the screens
// and scripts/e2e-packages/02-flow.mjs make — so routing, the readiness gate
// and the metrics ledger are produced by the system itself, never faked.
//
// Reference data is idempotent (matched by name, created when missing). The
// boxes are not: every run adds a new set, tagged with makat "DEMO-*" and
// serials carrying the run tag. Undo = restore the DB backup taken before.
//
// Auth follows scripts/seed-dev-dataset.js: an Auth.js session cookie is
// minted offline with AUTH_SECRET (taken from the environment, else from
// .env.local), so the app must share that secret. Refuses any API base that
// is not localhost unless --allow-remote.

import fs from "node:fs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

if (!flag("--confirm")) {
  console.log("Nothing done. Re-run with --confirm (see the header of this file).");
  process.exit(0);
}

const API_BASE = opt("--api", process.env.SEED_API_BASE || "http://localhost:3000").replace(/\/$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API_BASE) && !flag("--allow-remote")) {
  console.error(`refusing: ${API_BASE} is not localhost (pass --allow-remote if you really mean it)`);
  process.exit(1);
}

function readEnvFile(path) {
  if (!fs.existsSync(path)) return {};
  const out = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}
const fileEnv = readEnvFile(".env.local");
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || fileEnv.AUTH_SECRET || fileEnv.NEXTAUTH_SECRET;
if (!AUTH_SECRET) {
  console.error("AUTH_SECRET is not set (environment or .env.local)");
  process.exit(1);
}

// ---- reference data ----------------------------------------------------------
// Station types by key. OPEN / CLOSE are package-level: every package route and
// every item route inside a package starts at OPEN and ends at CLOSE.
const STATION_TYPES = [
  { key: "OPEN", desc: "פתיחת מארז", package_level: true, stale_after_minutes: 30 },
  { key: "ELEC", desc: "חשמל", package_level: false, stale_after_minutes: 30 },
  { key: "MECH", desc: "מכניקה", package_level: false, stale_after_minutes: 30 },
  { key: "VIS", desc: "בדיקה ויזואלית", package_level: false, stale_after_minutes: 30 },
  { key: "RES", desc: "מעבדת מחקר", package_level: false, stale_after_minutes: 0 },
  { key: "CLOSE", desc: "סגירת מארז", package_level: true, stale_after_minutes: 60 },
];
const STATIONS = [
  { type: "OPEN", desc: "עמדת פתיחה 1" },
  { type: "OPEN", desc: "עמדת פתיחה 2" },
  { type: "ELEC", desc: "עמדת חשמל 1" },
  { type: "ELEC", desc: "עמדת חשמל 2" },
  { type: "MECH", desc: "עמדת מכניקה 1" },
  { type: "MECH", desc: "עמדת מכניקה 2" },
  { type: "VIS", desc: "עמדה ויזואלית 1" },
  { type: "VIS", desc: "עמדה ויזואלית 2" },
  { type: "RES", desc: "מעבדת מחקר 1", is_research: true },
  { type: "CLOSE", desc: "עמדת סגירה 1" },
];
// Item types that go inside boxes, with the route they run in a box. The
// route number is found (same steps) or allocated, never overwritten — the
// existing routes of these types keep serving legacy items.
const ITEM_TYPES = [
  { key: "pc", desc: "מחשב", steps: ["OPEN", "ELEC", "VIS", "CLOSE"], makat: "PC-7040", model: "OptiPlex 7040", manufacturer: "Dell", serial: "PC" },
  { key: "mouse", desc: "עכבר", steps: ["OPEN", "VIS", "CLOSE"], makat: "MS-210", model: "M90", manufacturer: "Logitech", serial: "MS" },
  { key: "kbd", desc: "מקלדת", steps: ["OPEN", "MECH", "VIS", "CLOSE"], makat: "KB-320", model: "K120", manufacturer: "Logitech", serial: "KB" },
  { key: "mon", desc: "מסך", steps: ["OPEN", "ELEC", "MECH", "VIS", "CLOSE"], makat: "MN-240", model: "P2419H", manufacturer: "Dell", serial: "MN" },
];
const PACKAGE_TYPES = [
  { key: "pcKit", desc: "מארז מחשב", contents: [["pc", 1], ["mouse", 1], ["kbd", 1]] },
  { key: "station", desc: "מארז עמדת עבודה", contents: [["pc", 1], ["mon", 2], ["kbd", 1], ["mouse", 1]] },
  { key: "periph", desc: "מארז ציוד היקפי", contents: [["mouse", 2], ["kbd", 2]] },
];
// The boxes: package type + the state the run leaves it in.
const BOXES = [
  ["pcKit", "queue"], ["station", "queue"], ["periph", "queue"],
  ["pcKit", "openTest"],
  ["pcKit", "inRoute"], ["station", "inRoute"], ["periph", "inRoute"],
  ["station", "research"],
  ["pcKit", "waitItems"], ["station", "waitItems"],
  ["pcKit", "readyClose"], ["periph", "readyClose"],
  ["pcKit", "done"], ["station", "done"], ["periph", "done"], ["pcKit", "done"],
];
const WORKERS = [
  { id: 4101, name: "אורי בן-דוד" }, { id: 4102, name: "נועה שגב" },
  { id: 4103, name: "רם אזולאי" }, { id: 4104, name: "מיכל בר-ששת" },
];
const STOREKEEPERS = [{ id: 4201, name: "דנה פרץ" }, { id: 4202, name: "עומר שלו" }];

// ---- plumbing ------------------------------------------------------------------
let seed = 20260923;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const uuid = () => crypto.randomUUID();
const tag = Date.now().toString(36).slice(-5).toUpperCase();
const failures = [];

let cookie = null;
async function mintSession() {
  const { encode } = await import("next-auth/jwt");
  const now = Math.floor(Date.now() / 1000);
  return encode({
    secret: AUTH_SECRET, salt: "authjs.session-token", maxAge: 86400,
    token: {
      sub: "seed-packages", name: "Seed Packages", email: "seed@example.local",
      preferred_username: "seedpackages", employee_number: "9001",
      roles: ["manager", "mashan", "tester"],
      access_token: "seed", expires_at: (now + 86400) * 1000,
      refresh_expires_at: (now + 86400) * 1000, iat: now, exp: now + 86400,
    },
  });
}

async function api(method, path, body, { expect = [200, 201], quiet = false } = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { "content-type": "application/json", cookie: `authjs.session-token=${cookie}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  const ok = expect.includes(res.status);
  if (!ok && !quiet) {
    failures.push(`${method} ${path} -> ${res.status}`);
    console.log(`  !! ${method} ${path} -> ${res.status} ${text.slice(0, 240)}`);
  }
  return { ok, status: res.status, json };
}
const must = async (...args) => {
  const r = await api(...args);
  if (!r.ok) throw new Error(`${args[0]} ${args[1]} failed (${r.status}) — see above`);
  return r.json;
};
const trim = (s) => (s == null ? "" : String(s).trim());

// ---- phase 1: reference data ---------------------------------------------------
const ref = { type: {}, stations: {}, research: null, itemType: {}, route: {}, pkgType: {} };

async function ensureReference() {
  console.log("\n=== reference data ===");

  const types = await must("GET", "/api/settings/test-stations-type");
  for (const t of STATION_TYPES) {
    const hit = types.find((r) => trim(r.test_type_desc) === t.desc);
    if (hit) {
      if (hit.package_level !== t.package_level) {
        throw new Error(`station type "${t.desc}" exists with package_level=${hit.package_level}; expected ${t.package_level}. Rename it or adjust STATION_TYPES.`);
      }
      ref.type[t.key] = hit.test_station_type_id;
      continue;
    }
    const created = await must("POST", "/api/settings/test-stations-type", {
      test_type_desc: t.desc, package_level: t.package_level, stale_after_minutes: t.stale_after_minutes,
    });
    ref.type[t.key] = created.test_station_type_id;
    console.log(`  + station type ${t.desc}`);
  }

  const stations = await must("GET", "/api/settings/test-stations");
  for (const s of STATIONS) {
    const typeId = ref.type[s.type];
    let hit = stations.find((r) => trim(r.test_station_desc) === s.desc);
    if (!hit) {
      hit = await must("POST", "/api/settings/test-stations", {
        test_station_type_id: typeId, test_station_desc: s.desc, status: 2, is_research: !!s.is_research,
      });
      console.log(`  + station ${s.desc}`);
    }
    const entry = { id: hit.test_station_id, typeId, desc: s.desc };
    if (s.is_research) ref.research = entry;
    else (ref.stations[typeId] ??= []).push(entry);
  }

  const itemTypes = await must("GET", "/api/settings/item-types");
  const routes = await must("GET", "/api/settings/testing-routes");
  for (const t of ITEM_TYPES) {
    let hit = itemTypes.find((r) => trim(r.item_type_desc) === t.desc);
    if (hit?.is_package) throw new Error(`item type "${t.desc}" is a package type`);
    if (!hit) {
      hit = await must("POST", "/api/settings/item-types", { item_type_desc: t.desc });
      console.log(`  + item type ${t.desc}`);
    }
    ref.itemType[t.key] = hit.item_type_id;
    const steps = t.steps.map((k) => ref.type[k]);
    const mine = routes.filter((r) => r.item_type_id === hit.item_type_id);
    const same = mine.find((r) => JSON.stringify(r.route_steps) === JSON.stringify(steps));
    if (same) { ref.route[t.key] = same.route_number; continue; }
    const routeNumber = 1 + Math.max(0, ...mine.map((r) => r.route_number));
    await must("POST", "/api/settings/testing-routes", { item_type_id: hit.item_type_id, route_number: routeNumber, route_steps: steps });
    ref.route[t.key] = routeNumber;
    console.log(`  + route ${t.desc} #${routeNumber}: ${t.steps.join(" → ")}`);
  }

  for (const p of PACKAGE_TYPES) {
    let hit = itemTypes.find((r) => trim(r.item_type_desc) === p.desc);
    if (hit && !hit.is_package) throw new Error(`item type "${p.desc}" exists but is not a package type`);
    if (!hit) {
      hit = await must("POST", "/api/settings/item-types", { item_type_desc: p.desc, is_package: true, default_route_number: 1 });
      console.log(`  + package type ${p.desc}`);
    }
    const id = hit.item_type_id;
    const pkgSteps = [ref.type.OPEN, ref.type.CLOSE];
    const pkgRoute = routes.find((r) => r.item_type_id === id && r.route_number === 1);
    if (!pkgRoute) {
      await must("POST", "/api/settings/testing-routes", { item_type_id: id, route_number: 1, route_steps: pkgSteps });
    } else if (JSON.stringify(pkgRoute.route_steps) !== JSON.stringify(pkgSteps)) {
      throw new Error(`package type "${p.desc}" route #1 is ${JSON.stringify(pkgRoute.route_steps)}, expected ${JSON.stringify(pkgSteps)}`);
    }
    const saved = await must("PUT", `/api/settings/item-types/${id}/contents`, {
      default_route_number: 1,
      lines: p.contents.map(([k, quantity], i) => {
        const t = ITEM_TYPES.find((x) => x.key === k);
        return {
          item_type_id: ref.itemType[k], quantity, route_number: ref.route[k], sort_order: i,
          makat: t.makat, model: t.model, manufacturer_name: t.manufacturer,
        };
      }),
    });
    const warnings = [...saved.package_route_warnings, ...saved.lines.map((l) => l.route_warning).filter(Boolean)];
    if (warnings.length) throw new Error(`package type "${p.desc}" has route warnings: ${warnings.join("; ")}`);
    ref.pkgType[p.key] = id;
  }
  console.log(`  station types ${Object.keys(ref.type).length}, item types ${ITEM_TYPES.length}, package types ${PACKAGE_TYPES.length} — all routes valid`);
}

// ---- phase 2: shipments ----------------------------------------------------------
async function createShipments() {
  console.log("\n=== shipments ===");
  const customers = await must("GET", "/api/settings/customers");
  if (!customers.length) throw new Error("no customers — add one in Settings first");
  const sources = (await api("GET", "/api/settings/sources")).json || [];

  // Three shipments; boxes are dealt round-robin so each declares what it holds.
  const plan = [0, 1, 2].map(() => new Map());
  BOXES.forEach(([key], i) => {
    const m = plan[i % 3];
    m.set(key, (m.get(key) ?? 0) + 1);
  });
  const out = [];
  for (let k = 0; k < plan.length; k++) {
    const customer = customers[k % customers.length];
    const date = new Date(Date.now() - (plan.length - k) * 86400000);
    const lines = [...plan[k]].map(([key, quantity]) => ({ item_type_id: ref.pkgType[key], quantity, makat: `DEMO-${key}` }));
    const recv = pick(STOREKEEPERS);
    const send = pick(WORKERS);
    const created = await must("POST", "/api/shipments", {
      shipment_code: `DEMO-${tag}-${k + 1}`, customer_id: customer.id, shipment_date: date.toISOString(),
      makat: lines[0].makat, amount: lines.reduce((n, l) => n + l.quantity, 0),
      recieving_worker_id: recv.id, recieving_worker_name: recv.name,
      sending_worker_id: send.id, sending_worker_name: send.name,
      source_id: sources[0]?.source_id ?? null, poc_details: `Demo POC ${k + 1}`,
      shipment_items: lines,
    });
    out.push({ id: created.id, customerId: customer.id });
    console.log(`  + shipment DEMO-${tag}-${k + 1} (${trim(customer.name)}): ${lines.map((l) => `${l.quantity}×${l.makat}`).join(", ")}`);
  }
  return out;
}

// ---- phase 3: boxes and their walks ------------------------------------------------
let serialNo = 0;
const station = (typeId, n = 0) => ref.stations[typeId][n % ref.stations[typeId].length];
const view = async (pkgId) => (await must("GET", `/api/packages/${pkgId}`)).package;

async function createBox(pkgKey, ship) {
  const p = PACKAGE_TYPES.find((x) => x.key === pkgKey);
  const items = [];
  for (const [k, quantity] of p.contents) {
    const t = ITEM_TYPES.find((x) => x.key === k);
    for (let q = 0; q < quantity; q++) {
      items.push({
        itemType: ref.itemType[k], routeNumber: ref.route[k], serialNumber: `${t.serial}-${tag}-${String(++serialNo).padStart(3, "0")}`,
        makat: t.makat, model: t.model, manufacturer: t.manufacturer,
      });
    }
  }
  const created = await must("POST", "/api/packages", {
    customer: ship.customerId, shipment: ship.id, packageType: ref.pkgType[pkgKey], routeNumber: 1,
    makat: `DEMO-${pkgKey}`, model: p.desc, manufacturer: "Demo",
    items,
  });
  return String(created.packageId);
}

async function startTest(itemId, stationId, w) {
  return must("POST", "/api/testing/start-test", { itemId: Number(itemId), stationId, actionUuid: uuid(), workerId: w.id, workerName: w.name });
}

/** Opening or closing: group start on the box, a result per item, then the box — one SubmitID. */
async function packageStep(pkgId, kind) {
  const typeKey = kind === "opening" ? "OPEN" : "CLOSE";
  const st = station(ref.type[typeKey]);
  const w = pick(WORKERS);
  let v = await view(pkgId);
  await startTest(pkgId, st.id, w);
  const submit = uuid();
  const base = { StationID: st.id, WorkerID: w.id, WorkerName: w.name, SubmitID: submit, Result: 1, Passed: true };
  for (const it of v.items) {
    await must("POST", "/api/testing/results", { ...base, ItemID: Number(it.item_id), Details: kind === "opening" ? { opening: true, package_id: pkgId } : { closing: true, packed: true } });
  }
  await must("POST", "/api/testing/results", {
    ...base, ItemID: Number(pkgId),
    Details: kind === "opening" ? { opening: true, itemCount: v.items.length } : { closing: true, packed: v.items.map((i) => i.item_id), decisions: [] },
  });
  return view(pkgId);
}

async function itemDetail(itemId) {
  const d = (await must("GET", `/api/items/${itemId}`)).item;
  const step = d.current_route_step ?? 1;
  return { step, steps: d.route_steps, stepType: d.route_steps?.[step - 1] };
}

/** One regular step for one item. Returns false when the item already stands before closing. */
async function advance(itemId, { research = false } = {}) {
  const { step, steps, stepType } = await itemDetail(itemId);
  if (!stepType || stepType === ref.type.CLOSE) return false;
  const st = station(stepType, Math.floor(rand() * 2));
  const w = pick(WORKERS);
  await startTest(itemId, st.id, w);
  await must("POST", "/api/testing/results", {
    ItemID: Number(itemId), StationID: st.id, CurrentRouteStep: step, RouteStepsLength: steps.length,
    WorkerID: w.id, WorkerName: w.name, SubmitID: uuid(), Result: 1, Passed: true,
    ...(research ? { sendToResearch: true, Comments: "חריגה בבדיקה — הועבר למחקר" } : {}),
  });
  return true;
}
async function walkToClosing(itemId) {
  for (let guard = 0; guard < 10 && (await advance(itemId)); guard++);
}

async function runBoxes(ships) {
  console.log("\n=== boxes ===");
  const leaveInTest = []; // started last, so nothing else queues behind them
  const made = [];
  for (let i = 0; i < BOXES.length; i++) {
    const [pkgKey, scenario] = BOXES[i];
    const pkgId = await createBox(pkgKey, ships[i % ships.length]);
    made.push({ pkgId, scenario });

    if (scenario === "queue") { /* waits at opening */ }
    else if (scenario === "openTest") leaveInTest.push(() => startTest(pkgId, station(ref.type.OPEN, 1).id, pick(WORKERS)));
    else {
      const v = await packageStep(pkgId, "opening");
      const items = v.items.map((it) => String(it.item_id));
      if (scenario === "inRoute") {
        for (const id of items) if (rand() < 0.5) await advance(id);
        const first = items[0];
        leaveInTest.push(async () => {
          const { stepType } = await itemDetail(first);
          if (stepType && stepType !== ref.type.CLOSE) await startTest(first, station(stepType, 1).id, pick(WORKERS));
        });
      } else if (scenario === "research") {
        await advance(items[0], { research: true });
        for (const id of items.slice(1)) await walkToClosing(id);
      } else if (scenario === "waitItems") {
        for (const id of items.slice(1)) await walkToClosing(id);
      } else {
        for (const id of items) await walkToClosing(id);
        if (scenario === "done") await packageStep(pkgId, "closing");
      }
    }
    process.stdout.write(`  ${pkgId}  ${PACKAGE_TYPES.find((p) => p.key === pkgKey).desc.padEnd(16)} ${scenario}\n`);
  }
  for (const fn of leaveInTest) await fn();
  return made;
}

// ---- verify ---------------------------------------------------------------------------
const EXPECTED = { queue: "queue", openTest: "test", inRoute: "waitItems", research: "waitItems", waitItems: "waitItems", readyClose: "readyClose", done: "done" };

async function verify(made) {
  console.log("\n=== verify ===");
  const counts = {};
  for (const { pkgId, scenario } of made) {
    const v = await view(pkgId);
    counts[v.status] = (counts[v.status] ?? 0) + 1;
    if (v.status !== EXPECTED[scenario]) {
      failures.push(`box ${pkgId} (${scenario}) ended as ${v.status}, expected ${EXPECTED[scenario]}`);
      console.log(`  !! ${pkgId} (${scenario}) is ${v.status}, expected ${EXPECTED[scenario]}`);
    }
  }
  console.log("  boxes by state:", JSON.stringify(counts));
}

try {
  cookie = await mintSession();
  const probe = await api("GET", "/api/settings/item-types", undefined, { quiet: true });
  if (!probe.ok || !Array.isArray(probe.json)) {
    throw new Error(`the app at ${API_BASE} did not accept the session (status ${probe.status}) — is it running, with the same AUTH_SECRET?`);
  }
  await ensureReference();
  const ships = await createShipments();
  const made = await runBoxes(ships);
  await verify(made);
} catch (e) {
  failures.push(e.message);
  console.error(`\nFAILED: ${e.message}`);
}
console.log(failures.length ? `\n${failures.length} problem(s):\n  ${failures.join("\n  ")}` : `\nDone — run tag ${tag}. Open ${API_BASE}/packages`);
process.exit(failures.length ? 1 : 0);
