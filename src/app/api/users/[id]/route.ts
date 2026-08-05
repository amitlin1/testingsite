// User-management API — update (profile / role / enabled) + delete. Manager-only.
import { NextRequest, NextResponse } from "next/server";
import { withAuth, type WithAuthCtx } from "@/lib/auth/withAuth";
import {
  updateUserProfile,
  setUserRole,
  setUserEnabled,
  deleteUser,
  getUsername,
  isLastEnabledManager,
  AdminError,
} from "@/lib/keycloak-admin";
import { APP_ROLES } from "@/lib/auth/roles";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** withAuth passes only (req, ctx); recover the [id] from the path. */
function idFromReq(req: NextRequest): string {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean); // api / users / <id>
  const i = parts.indexOf("users");
  return i >= 0 ? (parts[i + 1] ?? "") : "";
}

/** Map any thrown error to a client-safe response (never leak Keycloak bodies). */
function fail(e: unknown): NextResponse {
  const status = e instanceof AdminError ? e.status : 502;
  const message = e instanceof AdminError ? e.message : "הפעולה נכשלה. נסה שוב.";
  if (!(e instanceof AdminError)) console.error("users API error", e);
  return NextResponse.json({ error: message }, { status });
}

export const PUT = withAuth(
  async (req: NextRequest, ctx: WithAuthCtx) => {
    const id = idFromReq(req);
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "invalid input" }, { status: 400 });

    // Resolve the target once; refuse to touch Keycloak service accounts.
    const targetUsername = await getUsername(id);
    if (targetUsername.startsWith("service-account-")) {
      return NextResponse.json({ error: "לא ניתן לפעול על חשבון שירות" }, { status: 400 });
    }
    const isSelf = !!targetUsername && targetUsername === ctx.session.user.preferredUsername;

    // One body can trip both the role guard and the enabled guard; the answer
    // can't change mid-request, so resolve it at most once.
    let lastManager: boolean | undefined;
    const isLastManager = async () =>
      (lastManager ??= await isLastEnabledManager(id));

    try {
      if (
        typeof body.firstName === "string" ||
        typeof body.lastName === "string" ||
        body.employeeNumber !== undefined
      ) {
        await updateUserProfile(id, {
          firstName: typeof body.firstName === "string" ? body.firstName.trim().slice(0, 100) : undefined,
          lastName: typeof body.lastName === "string" ? body.lastName.trim().slice(0, 100) : undefined,
          employeeNumber:
            body.employeeNumber === undefined
              ? undefined
              : body.employeeNumber
                ? String(body.employeeNumber).trim().slice(0, 32)
                : null,
        });
      }
      if (typeof body.role === "string") {
        if (!(APP_ROLES as readonly string[]).includes(body.role)) {
          return NextResponse.json({ error: "invalid role" }, { status: 400 });
        }
        // Lockout guard: block demoting YOURSELF, or the LAST enabled manager,
        // away from the manager role (would leave 0 managers).
        if (body.role !== "manager") {
          if (isSelf) {
            return NextResponse.json({ error: "לא ניתן להוריד לעצמך את הרשאת המנהל" }, { status: 400 });
          }
          if (await isLastManager()) {
            return NextResponse.json({ error: "לא ניתן להסיר את המנהל האחרון מהמערכת" }, { status: 400 });
          }
        }
        await setUserRole(id, body.role as (typeof APP_ROLES)[number]);
      }
      if (typeof body.enabled === "boolean") {
        if (body.enabled === false) {
          if (isSelf) {
            return NextResponse.json({ error: "לא ניתן להשבית את המשתמש שאיתו אתה מחובר" }, { status: 400 });
          }
          if (await isLastManager()) {
            return NextResponse.json({ error: "לא ניתן להשבית את המנהל האחרון מהמערכת" }, { status: 400 });
          }
        }
        await setUserEnabled(id, body.enabled);
      }
      return NextResponse.json({ ok: true });
    } catch (e) {
      return fail(e);
    }
  },
  { role: "manager" },
);

export const DELETE = withAuth(
  async (req: NextRequest, ctx: WithAuthCtx) => {
    const id = idFromReq(req);
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    try {
      const targetUsername = await getUsername(id);
      if (targetUsername.startsWith("service-account-")) {
        return NextResponse.json({ error: "לא ניתן לפעול על חשבון שירות" }, { status: 400 });
      }
      if (targetUsername && targetUsername === ctx.session.user.preferredUsername) {
        return NextResponse.json({ error: "לא ניתן למחוק את המשתמש שאיתו אתה מחובר" }, { status: 400 });
      }
      if (await isLastEnabledManager(id)) {
        return NextResponse.json({ error: "לא ניתן למחוק את המנהל האחרון מהמערכת" }, { status: 400 });
      }
      await deleteUser(id);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return fail(e);
    }
  },
  { role: "manager" },
);
