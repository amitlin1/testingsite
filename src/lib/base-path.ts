// Single source of truth for the basePath.
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

/** Server-side basePath. Reads NEXT_BASE_PATH at runtime (server code only; "" in the browser). */
export const SERVER_BASE_PATH = normalizeBasePath(process.env.NEXT_BASE_PATH);

/** This side's basePath: the server's on the server, the baked one in the browser. */
const SIDE_BASE_PATH = typeof window === "undefined" ? SERVER_BASE_PATH : BASE_PATH;

/** The /login initiator, returning to `callback` afterwards (a path that already carries the basePath). */
export function loginUrl(callback: string): string {
  return `${SIDE_BASE_PATH}/login?callbackUrl=${encodeURIComponent(callback)}`;
}

/**
 * /login's callbackUrl, made safe: a same-app path that is NOT an auth endpoint and NOT /login
 * itself (a stale-session loop can nest a callbackUrl pointing back at /login). Anything else →
 * the app root.
 */
export function safeCallbackUrl(raw: string | null, base: string = SERVER_BASE_PATH): string {
  const safe =
    !!raw &&
    raw.startsWith("/") &&
    !raw.startsWith(`${base}/api/auth`) &&
    !raw.startsWith(`${base}/login`) &&
    !raw.startsWith("/login");
  return safe ? raw : `${base}/`;
}

/** `pathname` without the basePath prefix, when it carries one ("/myapp" → "/"). Idempotent. */
export function stripBasePath(pathname: string, base: string = SERVER_BASE_PATH): string {
  if (!base) return pathname;
  if (pathname === base) return "/";
  if (pathname.startsWith(base + "/")) return pathname.slice(base.length);
  return pathname;
}

/** The "no access" page; `from` = the (basePath-less) path that was refused. */
export function noAuthUrl(from?: string): string {
  return from === undefined ? `${SIDE_BASE_PATH}/no-auth` : `${SIDE_BASE_PATH}/no-auth?from=${encodeURIComponent(from)}`;
}

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
