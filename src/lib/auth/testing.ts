// Integration tests only: run withAuth-wrapped route handlers in-process with a chosen session.
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Replaces the root auth.ts in require.cache with a module whose auth() answers `current()` (null =
 * signed out). Must run before anything loads auth.ts (withAuth imports it): tsx loads the suites
 * and the route modules as CommonJS, so the cache entry is what every later require of auth.ts gets.
 */
export function stubSession(current: () => unknown): void {
  const req = createRequire(path.resolve(process.cwd(), "package.json"));
  const authPath = req.resolve("./auth.ts");
  const CjsModule = req("node:module") as typeof import("node:module");
  const stub = new CjsModule(authPath);
  stub.filename = authPath;
  stub.loaded = true;
  stub.exports = { auth: async () => current(), handlers: {}, signIn: () => {}, signOut: () => {} };
  req.cache[authPath] = stub;
}
