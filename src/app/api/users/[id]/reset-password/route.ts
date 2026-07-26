// User-management API — set a temporary password (forces change at next login).
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { resetPassword, getUsername, AdminError } from "@/lib/keycloak-admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromReq(req: NextRequest): string {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean); // api / users / <id> / reset-password
  const i = parts.indexOf("users");
  return i >= 0 ? (parts[i + 1] ?? "") : "";
}

export const PUT = withAuth(
  async (req: NextRequest) => {
    const id = idFromReq(req);
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.password !== "string" || body.password.length < 6) {
      return NextResponse.json({ error: "הסיסמה חייבת להכיל לפחות 6 תווים" }, { status: 400 });
    }
    try {
      const targetUsername = await getUsername(id);
      if (targetUsername.startsWith("service-account-")) {
        return NextResponse.json({ error: "לא ניתן לפעול על חשבון שירות" }, { status: 400 });
      }
      // Admin-driven reset is ALWAYS temporary → the user must set a new one at
      // login. Any client-supplied `temporary:false` is ignored on purpose.
      await resetPassword(id, body.password, true);
      return NextResponse.json({ ok: true });
    } catch (e) {
      const status = e instanceof AdminError ? e.status : 502;
      const message = e instanceof AdminError ? e.message : "הפעולה נכשלה. נסה שוב.";
      if (!(e instanceof AdminError)) console.error("reset-password error", e);
      return NextResponse.json({ error: message }, { status });
    }
  },
  { role: "manager" },
);
