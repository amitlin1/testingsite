// A main role's bundle — what everyone holding the role may do — set from the managers' role editor
// ("מה כל תפקיד יכול לעשות" on the users page). Manager-only. PUT { perms: [key…] } is the whole
// bundle (rules: parseBundle); the role's users get it at their next token refresh, and what was
// taken away from one user alone (no-…) stays.
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS, isAppRole, permissionByKey } from "@/lib/auth/roles";
import { HttpError } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { adminErrorResponse, getRoleBundles, setRoleBundle } from "@/lib/keycloak-admin";
import { parseBundle } from "@/lib/users/rules";

export const runtime = "nodejs";

/** PUT → { bundles }: every role's bundle as Keycloak holds it after the change. */
export const PUT = withAuth<{ role: string }>(
  async (req: NextRequest, { params: { role } }) => {
    if (!isAppRole(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });
    try {
      const parsed = parseBundle(role, await readJsonObject(req, "רשימת ההרשאות אינה תקינה"));
      if ("error" in parsed) throw new HttpError(400, parsed.error);
      await setRoleBundle(role, parsed.keys.map(permissionByKey));
      return NextResponse.json({ bundles: await getRoleBundles() });
    } catch (e) {
      return adminErrorResponse(e, "שמירת ההרשאות של התפקיד נכשלה");
    }
  },
  { perm: ACCESS.usersAdmin },
);
