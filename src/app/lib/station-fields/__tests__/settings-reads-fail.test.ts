import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Route-fields spec §11 rule 12: no settings endpoint answers [] or an empty object on a failure —
 * the routes screen would show a failed read as "no item types" / "a new route" / "no fields".
 * The three reads the screen is built from, against a database that cannot be reached: nothing
 * listens on port 1, so every query fails to connect and no database is touched. Each test file runs
 * in its own process, so this DATABASE_URL reaches no other suite.
 */
process.env.DATABASE_URL = "postgresql://nobody:nothing@127.0.0.1:1/none";

async function failedRead(res: Response): Promise<void> {
  assert.equal(res.status, 500);
  const body: unknown = await res.json();
  assert.ok(body !== null && typeof body === "object" && !Array.isArray(body), "an object, never a list");
  assert.equal(typeof (body as { error?: unknown }).error, "string");
}

test("GET /api/settings/item-types: an unreachable database is a real 500 { error }, never []", async (t) => {
  t.mock.method(console, "error", () => {});
  const { GET } = await import("../../../api/settings/item-types/route");
  await failedRead(await GET());
});

test("GET /api/settings/testing-routes: an unreachable database is a real 500 { error }, never []", async (t) => {
  t.mock.method(console, "error", () => {});
  const { GET } = await import("../../../api/settings/testing-routes/route");
  await failedRead(await GET(new Request("http://localhost/api/settings/testing-routes")));
});

test("GET /api/settings/testing-routes/fields-context: an unreachable database is a real 500, never an empty context", async (t) => {
  t.mock.method(console, "error", () => {});
  const { GET } = await import("../../../api/settings/testing-routes/fields-context/route");
  await failedRead(await GET(new Request("http://localhost/api/settings/testing-routes/fields-context?packageTypeId=1&routeNumber=1")));
});
