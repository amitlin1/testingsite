// User-management API — list + create. Manager-only (withAuth). Talks to Keycloak
// via the server-only admin client; the browser never sees the admin secret.
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { getAdminUsers, createManagedUser, AdminError } from "@/lib/keycloak-admin";
import { APP_ROLES } from "@/lib/auth/roles";

export const runtime = "nodejs";

const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/;
const EMPNO_RE = /^\d{1,32}$/;

export const GET = withAuth(
  async (req: NextRequest) => {
    const search = req.nextUrl.searchParams.get("search") || undefined;
    try {
      const users = await getAdminUsers(search);
      return NextResponse.json({ users });
    } catch (e) {
      console.error("list users error", e);
      return NextResponse.json({ error: "טעינת המשתמשים נכשלה" }, { status: 502 });
    }
  },
  { role: "manager" },
);

export const POST = withAuth(
  async (req: NextRequest) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const role = body?.role;
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const temporaryPassword =
      typeof body?.temporaryPassword === "string" ? body.temporaryPassword : "";
    const employeeNumber =
      typeof body?.employeeNumber === "string" ? body.employeeNumber.trim() : "";
    if (
      !USERNAME_RE.test(username) ||
      temporaryPassword.length < 6 ||
      typeof role !== "string" ||
      !(APP_ROLES as readonly string[]).includes(role) ||
      (employeeNumber !== "" && !EMPNO_RE.test(employeeNumber))
    ) {
      return NextResponse.json({ error: "פרטי המשתמש אינם תקינים" }, { status: 400 });
    }
    try {
      const id = await createManagedUser({
        username,
        firstName: typeof body?.firstName === "string" ? body.firstName.trim().slice(0, 100) : undefined,
        lastName: typeof body?.lastName === "string" ? body.lastName.trim().slice(0, 100) : undefined,
        employeeNumber: employeeNumber || undefined,
        role: role as (typeof APP_ROLES)[number],
        temporaryPassword,
        mustChangePassword: body?.mustChangePassword !== false,
      });
      return NextResponse.json({ id }, { status: 201 });
    } catch (e) {
      const status = e instanceof AdminError ? e.status : 502;
      const message = e instanceof AdminError ? e.message : "יצירת המשתמש נכשלה";
      if (!(e instanceof AdminError)) console.error("create user error", e);
      return NextResponse.json({ error: message }, { status });
    }
  },
  { role: "manager" },
);
