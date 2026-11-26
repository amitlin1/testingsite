// A user's permissions — what their main role's bundle gives them, and the ones taken away from them
// alone (their no-… roles; roles.ts). Manager-only. The main role itself changes through
// PUT /api/users/[id].
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS, permissionByKey } from "@/lib/auth/roles";
import { HttpError } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { adminErrorResponse, getUserPermissions, getUsername, setUserDenied } from "@/lib/keycloak-admin";
import { isServiceAccount, isUserId, parseDenied } from "@/lib/users/rules";

export const runtime = "nodejs";

const INVALID = "רשימת ההרשאות אינה תקינה";

/** GET → { role, effective: every realm role the user's token carries, denied: [key…] }. */
export const GET = withAuth<{ id: string }>(
  async (_req: NextRequest, { params: { id } }) => {
    if (!isUserId(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    try {
      if (isServiceAccount(await getUsername(id))) {
        return NextResponse.json({ error: "לא ניתן לפעול על חשבון שירות" }, { status: 400 });
      }
      return NextResponse.json(await getUserPermissions(id));
    } catch (e) {
      return adminErrorResponse(e, "טעינת ההרשאות נכשלה");
    }
  },
  { perm: ACCESS.usersAdmin },
);

/** PUT { denied: [key…] } → exactly these permissions are taken away from the user. */
export const PUT = withAuth<{ id: string }>(
  async (req: NextRequest, { params: { id } }) => {
    if (!isUserId(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    try {
      const denied = parseDenied(await readJsonObject(req, INVALID));
      if (!denied) throw new HttpError(400, INVALID);
      if (isServiceAccount(await getUsername(id))) {
        return NextResponse.json({ error: "לא ניתן לפעול על חשבון שירות" }, { status: 400 });
      }
      await setUserDenied(id, denied.map(permissionByKey));
      return NextResponse.json(await getUserPermissions(id));
    } catch (e) {
      return adminErrorResponse(e, "שמירת ההרשאות נכשלה");
    }
  },
  { perm: ACCESS.usersAdmin },
);
