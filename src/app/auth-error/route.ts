// Self-healing Auth.js error handler (wired via `pages.error` in auth.ts).
//
// The usual error that lands here is `Configuration`, which for our flow almost
// always means a STALE / interrupted PKCE check cookie: the session expired and a
// new login was started, or the user has several tabs each starting their own
// login, so the `pkceCodeVerifier` read on the callback doesn't match. Auth.js
// then dead-ends on a generic "Server error" page.
//
// Instead we self-heal ONCE: clear the stale check cookies and restart a clean
// login (which sets fresh cookies). A short-lived `auth-retry` marker prevents an
// infinite loop — a second failure shows a friendly manual-recovery page.

import { NextRequest, NextResponse } from "next/server";
import { normalizeBasePath } from "@/lib/base-path";

export const runtime = "nodejs";

const BASE = normalizeBasePath(process.env.NEXT_BASE_PATH);

// The transient OAuth "check" cookies Auth.js sets at login-start.
const CHECK_COOKIES = [
  "authjs.pkce.code_verifier",
  "authjs.state",
  "authjs.nonce",
  "__Secure-authjs.pkce.code_verifier",
  "__Secure-authjs.state",
  "__Secure-authjs.nonce",
];

function clearCheckCookies(res: NextResponse) {
  for (const c of CHECK_COOKIES) res.cookies.set(c, "", { maxAge: 0, path: "/" });
}

export function GET(req: NextRequest) {
  const error = req.nextUrl.searchParams.get("error");
  const retried = req.cookies.get("auth-retry")?.value === "1";
  const loginUrl = new URL(`${BASE}/login?callbackUrl=${encodeURIComponent(`${BASE}/`)}`, req.url);

  // First "Configuration" failure → clear the stale check cookies + retry login.
  if (error === "Configuration" && !retried) {
    const res = NextResponse.redirect(loginUrl);
    clearCheckCookies(res);
    res.cookies.set("auth-retry", "1", {
      maxAge: 120,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
    return res;
  }

  // Second failure (or any other error) → do NOT loop. Clear everything and show
  // a friendly recovery page.
  const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>שגיאת התחברות</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f5f7;font-family:Rubik,system-ui,-apple-system,sans-serif;color:#1d1d1f">
  <div style="background:#fff;border:1px solid #e0e0e0;border-radius:18px;padding:32px 30px;max-width:420px;text-align:center">
    <div style="width:54px;height:54px;border-radius:9999px;background:rgba(191,53,53,.1);color:#bf3535;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:26px">!</div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">ההתחברות נכשלה</h1>
    <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 20px">ייתכן שנשמרו עוגיות התחברות ישנות. נקה את עוגיות האתר (או פתח חלון גלישה בסתר) ונסה להתחבר שוב.</p>
    <a href="${BASE}/login" style="display:inline-block;background:#0066cc;color:#fff;text-decoration:none;font-weight:600;padding:12px 26px;border-radius:9999px">נסה שוב</a>
  </div>
</body></html>`;
  const res = new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  clearCheckCookies(res);
  res.cookies.set("auth-retry", "", { maxAge: 0, path: "/" });
  return res;
}
