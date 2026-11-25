// Tiny env-gated debug logger for the auth flow. Set AUTH_DEBUG=1 to enable.
//
// Quiet by default so production logs aren't spammed; turn it on in staging to
// trace refresh decisions (auth:jwt-cb / auth:refresh-token) and middleware
// verdicts. Callers pass an already-scoped tag like "auth:jwt-cb".
const ON = process.env.AUTH_DEBUG === "1";

export function authDebug(scope: string, msg: string, data?: unknown): void {
  if (!ON) return;
  if (data !== undefined) console.log(`[${scope}] ${msg}`, data);
  else console.log(`[${scope}] ${msg}`);
}

export function authStartupBanner(
  scope: string,
  data: Record<string, unknown>,
): void {
  if (!ON) return;
  console.log(`[${scope}] startup`, data);
}
