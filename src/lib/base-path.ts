// Single source of truth for the basePath. PORTABLE — copy verbatim.
//
// Convention: the ENV carries the NAME only ("myapp"), without a leading slash;
// code adds the slash via normalizeBasePath(). Next's <Link>/useRouter auto-
// prepend basePath, but anywhere code builds a URL MANUALLY (native fetch,
// window.location.href) Next won't — so route those through withBasePath().

/**
 * Normalize a basePath string from env:
 *   ""            → ""            (root-mounted)
 *   "myapp"       → "/myapp"      (bare name — preferred convention)
 *   "/myapp"      → "/myapp"      (already-prefixed — accepted)
 *   undefined     → ""
 */
export function normalizeBasePath(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw.startsWith("/") ? raw : "/" + raw;
}

/** Client-side basePath. Reads NEXT_PUBLIC_BASE_PATH (baked at build). */
export const BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

/**
 * Prepend basePath to a path. Pass-through for absolute URLs and for paths that
 * already include basePath (idempotent).
 *   withBasePath("/api/auth/session") → "/myapp/api/auth/session"
 *   withBasePath("/myapp/foo")        → "/myapp/foo"  (idempotent)
 *   withBasePath("http://x/y")        → "http://x/y"  (pass-through)
 */
export function withBasePath(path: string): string {
  if (!BASE_PATH) return path;
  if (/^https?:\/\//i.test(path) || path.startsWith("//")) return path;
  if (!path.startsWith("/")) return path;
  if (path === BASE_PATH || path.startsWith(BASE_PATH + "/")) return path;
  return BASE_PATH + path;
}
