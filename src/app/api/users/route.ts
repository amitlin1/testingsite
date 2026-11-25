// User-management API — list + create. Manager-only (withAuth). Talks to Keycloak
// via the server-only admin client; the browser never sees the admin secret.
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { getAdminUsers, createManagedUser, adminErrorResponse } from "@/lib/keycloak-admin";
import { ACCESS } from "@/lib/auth/roles";
import { HttpError } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { parseNewUser } from "@/lib/users/rules";

export const runtime = "nodejs";

const INVALID_USER = "פרטי המשתמש אינם תקינים";

export const GET = withAuth(
  async (req: NextRequest) => {
    const search = req.nextUrl.searchParams.get("search") || undefined;
    try {
      return NextResponse.json({ users: await getAdminUsers(search) });
    } catch (e) {
      return adminErrorResponse(e, "טעינת המשתמשים נכשלה");
    }
  },
  { role: ACCESS.usersAdmin },
);

export const POST = withAuth(
  async (req: NextRequest) => {
    try {
      const input = parseNewUser(await readJsonObject(req, INVALID_USER));
      if (!input) throw new HttpError(400, INVALID_USER);
      return NextResponse.json({ id: await createManagedUser(input) }, { status: 201 });
    } catch (e) {
      return adminErrorResponse(e, "יצירת המשתמש נכשלה");
    }
  },
  { role: ACCESS.usersAdmin },
);
