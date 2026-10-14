// Publish the demo station-field configuration (route-fields spec §7.2 session 1c
// item 11, §9.1) on the routes scripts/seed-packages-demo.mjs builds, so the
// worker popups of artboards 14–18 show their fields:
//
//   - kit "מארז עמדת עבודה", route 1 — the opening step: the box, every item and
//     the "מסך" items (artboards 15 and 16); the closing step: the box, every item
//     and the "מסך" items (artboards 17 and 18);
//   - the "מחשב" route that kit's template runs — its package_contents line names
//     the route number, never assumed to be 1 — at the "חשמל" step: the five
//     fields of artboard 14.
//
// Field names, options, tones, "required" and note modes are copied from those
// artboards' scripts. They give the kit's "מחשב" and "מקלדת" items no fields of
// their own type, so those items get the every-item fields only.
//
//   # the app has to be running (npm run dev) against a DB that has the
//   # 20261013120000_route_station_fields migration, after
//   # node scripts/seed-packages-demo.mjs --confirm; then from the repo root:
//   node scripts/seed-station-fields-demo.mjs --confirm
//   node scripts/seed-station-fields-demo.mjs --confirm --api http://localhost:3000
//
// Everything goes through the app's own HTTP APIs — the draft and publish
// endpoints of the routes screen (PUT …/[id]/fields/draft with base_rev, then
// POST …/fields/publish with apply_mode "new_only"). A box taken in AFTER this
// run freezes the new version; one taken in before keeps today's popups (spec
// §1.5). Run scripts/seed-packages-demo.mjs again for boxes that show fields.
//
// Idempotent: step uids are read from the routes and field / option ids are
// derived from a hash of route + step + label, so a re-run builds the same
// config, and nothing is published when the published version already equals
// it. Steps of these routes that the demo does not cover keep their published
// config; a pending draft on a route that has to be published is replaced.
//
// Auth as in scripts/seed-packages-demo.mjs: an Auth.js session cookie is minted
// offline with AUTH_SECRET (taken from the environment, else from .env.local),
// so the app must share that secret. Refuses any API base that is not localhost
// unless --allow-remote.

import { createHash } from "node:crypto";
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

// ---- the demo configuration ------------------------------------------------------
// Names as scripts/seed-packages-demo.mjs creates them.
const KIT = "מארז עמדת עבודה";
const KIT_ROUTE_NUMBER = 1;
const PC = "מחשב";
const SCREEN = "מסך";
const OPEN = "פתיחת מארז";
const CLOSE = "סגירת מארז";
const ELEC = "חשמל";

// Options are [label, tone] as in the artboard scripts. Note modes: the
// artboards' 'fail' is "required_on_fail", their 'opt' is "optional"; every
// "אורך מרבי" there is the default 1000, so note_max is left out.
const choice = (label, required, notes, options) => ({ type: "choice_row", label, required, notes, options });
const CONDITION = [["ללא פגמים", "pass"], ["שריטות קלות", "warn"], ["שבר/סדק", "fail"], ["לכלוך", "warn"]];
const PRESENCE = [["קיים", "pass"], ["חסר", "fail"], ["פגום", "fail"], ["הוחלף", "warn"]];
const NOT_CHECKED = ["לא נבדק", "neutral"];

/** Artboards 15 / 16 — the opening wizard. `types` = item-type groups by item type name. */
const OPENING = {
  box: [
    choice("שלמות הקופסה", true, "required_on_fail", CONDITION),
    choice("מדבקת המארז", true, "required_on_fail", [["קריאה", "pass"], ["קריאה חלקית", "warn"], ["לא קריאה", "fail"], ["חסרה", "fail"]]),
    choice("חותמת ביטחון", false, "optional", [["שלמה", "pass"], ["פגומה", "fail"], ["חסרה", "fail"], ["לא רלוונטי", "neutral"]]),
  ],
  each_item: [
    choice("התאמת מק״ט לרשום", true, "required_on_fail", [["תואם", "pass"], ["לא תואם", "fail"], ["חסר מק״ט", "fail"], NOT_CHECKED]),
    choice("מצב חיצוני", true, "required_on_fail", CONDITION),
  ],
  types: {
    [SCREEN]: [
      choice("מעמד", true, "optional", PRESENCE),
      choice("כבל DisplayPort", false, "optional", PRESENCE),
    ],
  },
};

/** Artboards 17 / 18 — the closing wizard. */
const CLOSING = {
  box: [
    choice("ריפוד פנימי", true, "required_on_fail", [["תקין", "pass"], ["חלקי", "warn"], ["חסר", "fail"], ["לא נדרש", "neutral"]]),
    choice("תיעוד מצורף", false, "optional", [["קיים", "pass"], ["חסר", "fail"], ["הוחלף", "warn"], ["לא רלוונטי", "neutral"]]),
  ],
  each_item: [choice("מצב חיצוני בסגירה", true, "required_on_fail", CONDITION)],
  types: {
    [SCREEN]: [choice("מגן מסך", false, "optional", [["הודבק", "pass"], ["חסר", "warn"], ["פגום", "fail"], ["לא נדרש", "neutral"]])],
  },
};

/** Artboard 14 — the default dialog at the "חשמל" step of the kit's "מחשב" route. */
const ELECTRICAL = [
  choice("נורית מתח", true, "required_on_fail", [["תקין", "pass"], ["מהבהבת", "warn"], ["לא דולקת", "fail"], NOT_CHECKED]),
  choice("הפעלה ו-POST", true, "required_on_fail", [["עולה תקין", "pass"], ["עולה עם שגיאה", "warn"], ["לא עולה", "fail"], NOT_CHECKED]),
  choice("מאוורר ספק הכוח", false, "optional", [["מסתובב תקין", "pass"], ["רעש חריג", "warn"], ["לא מסתובב", "fail"], NOT_CHECKED]),
  { type: "number", label: "התנגדות הארקה", required: true, notes: "optional", unit: "Ω", max: 0.1, out_of_range_fail: true },
  { type: "pass_fail", label: "בדיקת בידוד", required: true, notes: "required_on_fail" },
];

const PUBLISH_NOTE = "scripts/seed-station-fields-demo.mjs";

// ---- plumbing ------------------------------------------------------------------
const failures = [];

let cookie = null;
async function mintSession() {
  const { encode } = await import("next-auth/jwt");
  const now = Math.floor(Date.now() / 1000);
  return encode({
    secret: AUTH_SECRET, salt: "authjs.session-token", maxAge: 86400,
    token: {
      sub: "seed-station-fields", name: "Seed Station Fields", email: "seed@example.local",
      preferred_username: "seedstationfields", employee_number: "9002",
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

/** The pure station-fields module (src/app/lib/station-fields/validate.ts) — the checks the
 *  draft and publish endpoints run, so a bad config fails here, before anything is written. */
async function loadValidate() {
  const { require: tsxRequire } = await import("tsx/cjs/api");
  return tsxRequire("../src/app/lib/station-fields/validate.ts", import.meta.url);
}

/** prefix + 8 chars of [a-z0-9] from a hash of `key` — the same key always gives the same id
 *  (rejection sampling over the digest bytes keeps all 36 characters equally likely). */
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function stableId(prefix, key) {
  let out = "";
  for (let round = 0; out.length < 8; round++) {
    for (const b of createHash("sha256").update(`${round}:${key}`).digest()) {
      if (b >= 252) continue;
      out += ID_ALPHABET[b % 36];
      if (out.length === 8) break;
    }
  }
  return prefix + out;
}

/** Field definitions with their ids: a field's id hashes `key` (route, step, group) and its
 *  label; an option's id hashes the field id and the option's label. */
function withIds(key, defs) {
  return defs.map(({ options, ...field }) => {
    const id = stableId("f_", `${key}|${field.label}`);
    if (!options) return { id, ...field };
    return { id, ...field, options: options.map(([label, tone]) => ({ id: stableId("o_", `${id}|${label}`), label, tone })) };
  });
}

/** JSON with every object's keys sorted: two configs are equal when these strings are. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// ---- phase 1: the routes and their steps ---------------------------------------
async function routeOf(itemTypeId, routeNumber, what) {
  const rows = await must("GET", `/api/settings/testing-routes?itemTypeId=${itemTypeId}&routeNumber=${routeNumber}`);
  const route = rows[0];
  if (!route) throw new Error(`${what} has no route ${routeNumber}`);
  if (!Array.isArray(route.step_uids) || route.step_uids.length !== route.route_steps.length) {
    throw new Error(`${what} route ${routeNumber} (#${route.test_route_id}) has no step uids — save it once in the routes screen`);
  }
  return route;
}

async function loadRoutes() {
  console.log("\n=== routes ===");
  const types = await must("GET", "/api/settings/test-stations-type");
  const itemTypes = await must("GET", "/api/settings/item-types");
  const kit = itemTypes.find((r) => trim(r.item_type_desc) === KIT);
  if (!kit?.is_package) throw new Error(`no package type "${KIT}" — run node scripts/seed-packages-demo.mjs --confirm first`);
  const contents = await must("GET", `/api/settings/item-types/${kit.item_type_id}/contents`);
  const lineOf = (desc) => contents.lines.find((l) => trim(l.item_type_desc) === desc);
  const pcLine = lineOf(PC);
  if (!pcLine) throw new Error(`"${KIT}" has no "${PC}" line in its contents`);

  const kitRoute = await routeOf(kit.item_type_id, KIT_ROUTE_NUMBER, `"${KIT}"`);
  const pcRoute = await routeOf(pcLine.item_type_id, pcLine.route_number, `"${PC}"`);

  /** The step of `route` whose station type is named `typeName` (its first occurrence). */
  const stepOf = (route, typeName) => {
    const type = types.find((t) => trim(t.test_type_desc) === typeName);
    const i = type ? route.route_steps.indexOf(type.test_station_type_id) : -1;
    if (i < 0) throw new Error(`route #${route.test_route_id} has no "${typeName}" step`);
    return {
      uid: route.step_uids[i],
      station_type_id: type.test_station_type_id,
      station_label: trim(type.test_type_desc),
      scope: type.package_level ? "package" : "item",
      position: i + 1,
    };
  };
  const steps = { open: stepOf(kitRoute, OPEN), close: stepOf(kitRoute, CLOSE), elec: stepOf(pcRoute, ELEC) };
  const shown = [
    [kitRoute, `"${KIT}" route ${kitRoute.route_number}`, [steps.open, steps.close]],
    [pcRoute, `"${PC}" route ${pcRoute.route_number} (the kit's line)`, [steps.elec]],
  ];
  for (const [route, label, list] of shown) {
    console.log(`  #${route.test_route_id} ${label}: ${list.map((s) => `step ${s.position} ${s.station_label} ${s.uid}`).join(" · ")}`);
  }

  /** Item-type groups: the kit's own contents line gives the item type id. */
  const typeGroups = (byName) => Object.entries(byName).map(([desc, defs]) => {
    const line = lineOf(desc);
    if (!line) throw new Error(`"${KIT}" has no "${desc}" line in its contents`);
    return [{ item_type_id: line.item_type_id }, `type:${desc}`, defs];
  });
  return { kitRoute, pcRoute, steps, typeGroups };
}

/** One step's config: `groups` = [target, key name, field definitions]. */
function stepConfig(routeKey, step, groups) {
  return {
    uid: step.uid,
    station_type_id: step.station_type_id,
    station_label: step.station_label,
    scope: step.scope,
    groups: groups.map(([target, name, defs]) => ({ target, fields: withIds(`${routeKey}|${step.station_label}|${name}`, defs) })),
  };
}

// ---- phase 2: drafts --------------------------------------------------------------
/** Saves the draft of every route whose published config differs from the demo's; returns
 *  what publish needs ({ route, rev, config }) for those routes only. */
async function saveDrafts(V, plans) {
  console.log("\n=== drafts ===");
  const out = [];
  for (const plan of plans) {
    const id = plan.route.test_route_id;
    const view = await must("GET", `/api/settings/testing-routes/${id}/fields`);
    // The demo's steps over the published config: other steps of the route stay as published.
    const base = view.published ?? { schema: 1, steps: {} };
    const config = V.parseRouteFieldsConfig({ schema: 1, steps: { ...base.steps, ...Object.fromEntries(plan.steps.map((s) => [s.uid, s])) } });
    const issues = V.lintRouteFieldsConfig(config);
    for (const issue of issues) console.log(`  ${issue.level === "error" ? "!!" : "  "} #${id} ${issue.code}: ${issue.message}`);
    if (issues.some((issue) => issue.level === "error")) throw new Error(`route #${id}: the config has errors that block publishing`);
    const fields = plan.steps.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.fields.length, 0), 0);
    const shared = view.shared_with?.length ? ` · run by ${view.shared_with.map((k) => trim(k.desc)).join(", ")}` : "";
    if (view.published && canonical(config) === canonical(view.published)) {
      const pending = view.draft ? " (a pending draft was left as it is)" : "";
      console.log(`  = #${id} ${plan.label}: ${fields} fields — already published as version ${view.published_version}${pending}${shared}`);
      continue;
    }
    const replaced = view.draft ? ", replacing the pending draft" : "";
    const saved = await must("PUT", `/api/settings/testing-routes/${id}/fields/draft`, { config, base_rev: view.draft_rev });
    console.log(`  + #${id} ${plan.label}: ${fields} fields — draft rev ${saved.draft_rev} over version ${view.published_version}${replaced}${shared}`);
    out.push({ route: plan.route, label: plan.label, rev: saved.draft_rev, config });
  }
  return out;
}

// ---- phase 3: publish and read back -------------------------------------------------
async function publish(drafts) {
  console.log("\n=== publish ===");
  if (drafts.length === 0) {
    console.log("  no change — the published configuration already equals the demo; nothing was published");
    return;
  }
  const res = await must("POST", "/api/settings/testing-routes/fields/publish", {
    route_ids: drafts.map((d) => d.route.test_route_id),
    base_revs: Object.fromEntries(drafts.map((d) => [d.route.test_route_id, d.rev])),
    apply_mode: "new_only",
    note: PUBLISH_NOTE,
  });
  for (const d of drafts) {
    const id = d.route.test_route_id;
    const view = await must("GET", `/api/settings/testing-routes/${id}/fields`);
    const same = view.published && canonical(view.published) === canonical(d.config);
    if (!same || view.published_version !== res.versions[id]) {
      failures.push(`route #${id}: the published version does not read back as the demo config`);
    }
    console.log(`  ${same ? "+" : "!!"} #${id} ${d.label}: version ${res.versions[id]}${same ? "" : " — does NOT read back as the demo config"}`);
  }
  console.log(`  batch ${res.publish_batch} · apply_mode new_only`);
}

try {
  const V = await loadValidate();
  cookie = await mintSession();
  const probe = await api("GET", "/api/settings/item-types", undefined, { quiet: true });
  if (probe.status >= 500) {
    throw new Error(`the app at ${API_BASE} could not read the item types (status ${probe.status}) — see its server log (database?)`);
  }
  if (!probe.ok || !Array.isArray(probe.json)) {
    throw new Error(`the app at ${API_BASE} did not accept the session (status ${probe.status}) — is it running, with the same AUTH_SECRET?`);
  }
  const { kitRoute, pcRoute, steps, typeGroups } = await loadRoutes();
  const kitKey = `${KIT}#${kitRoute.route_number}`;
  const pcKey = `${PC}#${pcRoute.route_number}`;
  const drafts = await saveDrafts(V, [
    {
      route: kitRoute,
      label: `"${KIT}" route ${kitRoute.route_number}`,
      steps: [
        stepConfig(kitKey, steps.open, [["box", "box", OPENING.box], ["each_item", "each_item", OPENING.each_item], ...typeGroups(OPENING.types)]),
        stepConfig(kitKey, steps.close, [["box", "box", CLOSING.box], ["each_item", "each_item", CLOSING.each_item], ...typeGroups(CLOSING.types)]),
      ],
    },
    {
      route: pcRoute,
      label: `"${PC}" route ${pcRoute.route_number}`,
      steps: [stepConfig(pcKey, steps.elec, [["item", "item", ELECTRICAL]])],
    },
  ]);
  await publish(drafts);
} catch (e) {
  failures.push(e.message);
  console.error(`\nFAILED: ${e.message}`);
}
console.log(failures.length
  ? `\n${failures.length} problem(s):\n  ${failures.join("\n  ")}`
  : `\nDone. Boxes taken in from now on show the fields: node scripts/seed-packages-demo.mjs --confirm --api ${API_BASE}`);
process.exit(failures.length ? 1 : 0);
