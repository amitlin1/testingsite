import { test } from "node:test";
import assert from "node:assert/strict";
import type { RouteQuery, StorageLike } from "../routeQuery";
import {
  DEFAULT_ROUTE_QUERY, LAST_ROUTE_STORAGE_KEY, backToMap, encodeTarget, isEditorOpen, normalizeRouteQuery, parseRouteQuery,
  parseTargetParam, readLastRoute, routeQueryHref, routeRefOf, sameRouteQuery, sameTarget, serializeRouteQuery, withEditor,
  withField, withItem, withLastRoute, withLibrary, withRoute, withView, writeLastRoute,
} from "../routeQuery";

const editor = "type=50&route=1&view=map&step=s_moelec00&target=item%3A4&field=f_abcd1234";

test("the editor URL of spec §5.2 round-trips", () => {
  const q = parseRouteQuery(editor);
  assert.deepEqual(q, {
    type: 50, route: 1, view: "map", step: "s_moelec00", target: { item_type_id: 4 }, field: "f_abcd1234", item: null, lib: null, id: null,
  });
  assert.equal(serializeRouteQuery(q), editor);
  assert.equal(isEditorOpen(q), true);
  assert.deepEqual(routeRefOf(q), { type: 50, route: 1 });
});

test("every target form", () => {
  for (const raw of ["box", "each_item", "item", "item:7"]) assert.equal(encodeTarget(parseTargetParam(raw)!), raw);
  for (const bad of [null, "", "items", "item:", "item:0", "item:-1", "item:1.5", "item:99999999999", "type:3", "BOX"]) {
    assert.equal(parseTargetParam(bad), null, String(bad));
  }
  assert.equal(sameTarget({ item_type_id: 3 }, { item_type_id: 3 }), true);
  assert.equal(sameTarget("box", { item_type_id: 3 }), false);
  assert.equal(sameTarget(null, null), true);
});

test("the library URL; parsing accepts URLSearchParams too", () => {
  const q = parseRouteQuery(new URLSearchParams("view=library&lib=lists&id=12"));
  assert.deepEqual(q, { ...DEFAULT_ROUTE_QUERY, view: "library", lib: "lists", id: 12 });
  assert.equal(serializeRouteQuery(q), "view=library&lib=lists&id=12");
  assert.equal(parseRouteQuery("view=library").lib, "sets", "the library opens on sets");
});

test("anything invalid falls back to its default", () => {
  assert.deepEqual(parseRouteQuery(""), DEFAULT_ROUTE_QUERY);
  assert.deepEqual(parseRouteQuery("view=grid&type=x&route=1"), DEFAULT_ROUTE_QUERY, "a bad view → map; a route needs both halves");
  for (const bad of ["type=0&route=1", "type=5&route=-1", "type=5&route=1.5", "type=5&route=3000000000", "type=05x&route=1", "type=5"]) {
    const q = parseRouteQuery(bad);
    assert.equal(q.type, null, bad);
    assert.equal(q.route, null, bad);
  }
  // The editor needs a valid step AND target; field only with them; editor params only in the map.
  assert.equal(parseRouteQuery("type=5&route=1&step=s_moelec00").step, null);
  assert.equal(parseRouteQuery("type=5&route=1&target=box").target, null);
  assert.equal(parseRouteQuery("type=5&route=1&step=bad&target=box").step, null);
  assert.equal(parseRouteQuery("type=5&route=1&field=f_abcd1234").field, null);
  assert.equal(parseRouteQuery("type=5&route=1&step=s_moelec00&target=box&field=f_bad").field, null);
  assert.equal(parseRouteQuery("type=5&route=1&view=steps&step=s_moelec00&target=box").step, null);
  // item only in the steps view, and only with a route.
  assert.equal(parseRouteQuery("type=5&route=1&view=steps&item=7").item, 7);
  assert.equal(parseRouteQuery("type=5&route=1&item=7").item, null, "not in the map");
  assert.equal(parseRouteQuery("view=steps&item=7").item, null, "not without a route");
  assert.equal(parseRouteQuery("type=5&route=1&view=steps&item=0").item, null);
  // lib / id only in the library.
  assert.deepEqual(parseRouteQuery("type=5&route=1&lib=lists&id=3"), { ...DEFAULT_ROUTE_QUERY, type: 5, route: 1 });
  assert.equal(parseRouteQuery("view=library&lib=other&id=x").lib, "sets");
  assert.equal(parseRouteQuery("view=library&lib=other&id=x").id, null);
});

test("serialising is canonical: always the view, never a member the state cannot hold", () => {
  assert.equal(serializeRouteQuery(DEFAULT_ROUTE_QUERY), "view=map");
  const odd: RouteQuery = { ...DEFAULT_ROUTE_QUERY, type: 5, view: "steps", step: "s_moelec00", target: "box", item: 4, lib: "lists", id: 3 };
  assert.equal(serializeRouteQuery(odd), "view=steps");
  assert.equal(routeQueryHref("/settings/testing-routes", parseRouteQuery("route=1&type=5")), "/settings/testing-routes?type=5&route=1&view=map");
  assert.equal(sameRouteQuery(parseRouteQuery("route=1&type=5"), parseRouteQuery("type=5&route=1&view=map")), true);
  assert.deepEqual(normalizeRouteQuery(normalizeRouteQuery(odd)), normalizeRouteQuery(odd));
});

test("transitions: back to the map, another route, another view, the editor, a field, the library", () => {
  const q = parseRouteQuery(editor);
  assert.equal(serializeRouteQuery(backToMap(q)), "type=50&route=1&view=map");
  assert.equal(serializeRouteQuery(withRoute(q, { type: 60, route: 2 })), "type=60&route=2&view=map", "uids belong to a route: the editor closes");
  assert.equal(serializeRouteQuery(withRoute(q, null)), "view=map");
  assert.equal(serializeRouteQuery(withView(q, "steps")), "type=50&route=1&view=steps");
  assert.equal(serializeRouteQuery(withView(q, "map")), "type=50&route=1&view=map", "the map tab leaves the editor");
  assert.equal(serializeRouteQuery(withView(q, "library")), "type=50&route=1&view=library&lib=sets");
  const lib = withLibrary(q, "lists", 4);
  assert.equal(serializeRouteQuery(lib), "type=50&route=1&view=library&lib=lists&id=4");
  assert.equal(serializeRouteQuery(withView(lib, "library")), "type=50&route=1&view=library&lib=lists&id=4", "the open library stays as it is");
  assert.equal(serializeRouteQuery(withRoute(lib, { type: 60, route: 1 })), "type=60&route=1&view=library&lib=lists&id=4");
  const kit = withEditor(backToMap(q), "s_kitopen1", "box");
  assert.equal(serializeRouteQuery(kit), "type=50&route=1&view=map&step=s_kitopen1&target=box");
  assert.equal(serializeRouteQuery(withField(kit, "f_00000001")), "type=50&route=1&view=map&step=s_kitopen1&target=box&field=f_00000001");
  assert.equal(withField(backToMap(q), "f_00000001").field, null, "no field without the editor");
  assert.equal(serializeRouteQuery(withEditor(lib, "s_kitopen1", "each_item")), "type=50&route=1&view=map&step=s_kitopen1&target=each_item");
});

test("the steps view: a template line's route, kept on the same kit, dropped on another", () => {
  const steps = withItem(parseRouteQuery(editor), 7);
  assert.equal(serializeRouteQuery(steps), "type=50&route=1&view=steps&item=7", "withItem opens the steps view");
  assert.equal(serializeRouteQuery(withItem(steps, null)), "type=50&route=1&view=steps", "null = the box");
  assert.equal(serializeRouteQuery(withRoute(steps, { type: 50, route: 1 })), "type=50&route=1&view=steps&item=7");
  assert.equal(serializeRouteQuery(withRoute(steps, { type: 50, route: 2 })), "type=50&route=2&view=steps", "another route starts on the box");
  assert.equal(serializeRouteQuery(withRoute(steps, { type: 60, route: 1 })), "type=60&route=1&view=steps", "another kit has other lines");
  assert.equal(serializeRouteQuery(withView(steps, "map")), "type=50&route=1&view=map");
});

// ---- the last route ---------------------------------------------------------------------------------
function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}

test("the last route: written as JSON, read back, ignored when it is not a route", () => {
  const s = memoryStorage();
  assert.equal(readLastRoute(s), null);
  writeLastRoute({ type: 50, route: 1 }, s);
  assert.equal(s.data[LAST_ROUTE_STORAGE_KEY], '{"type":50,"route":1}');
  assert.deepEqual(readLastRoute(s), { type: 50, route: 1 });
  for (const bad of ["{", "null", "[]", '{"type":"50","route":1}', '{"type":50}', '{"type":0,"route":1}']) {
    assert.equal(readLastRoute(memoryStorage({ [LAST_ROUTE_STORAGE_KEY]: bad })), null, bad);
  }
});

test("a storage that throws (private mode, blocked site data) is ignored", () => {
  const throwing: StorageLike = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(readLastRoute(throwing), null);
  assert.doesNotThrow(() => writeLastRoute({ type: 5, route: 1 }, throwing));
  assert.equal(readLastRoute(null), null);
  assert.doesNotThrow(() => writeLastRoute({ type: 5, route: 1 }, null));
});

test("withLastRoute fills a URL without a route, and never overrides one", () => {
  const last = { type: 60, route: 2 };
  assert.equal(serializeRouteQuery(withLastRoute(parseRouteQuery("view=steps"), last)), "type=60&route=2&view=steps");
  assert.equal(serializeRouteQuery(withLastRoute(parseRouteQuery("type=50&route=1"), last)), "type=50&route=1&view=map");
  assert.deepEqual(withLastRoute(DEFAULT_ROUTE_QUERY, null), DEFAULT_ROUTE_QUERY);
});
