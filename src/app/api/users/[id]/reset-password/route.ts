// User-management API — set a temporary password (forces change at next login).
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { HttpError } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { resetPassword, getUsername, adminErrorResponse } from "@/lib/keycloak-admin";
import { MIN_PASSWORD_LENGTH, isServiceAccount, isUserId } from "@/lib/users/rules";

export const runtime = "nodejs";

export const PUT = withAuth<{ id: string }>(
  async (req: NextRequest, { params: { id } }) => {
    if (!isUserId(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const tooShort = `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים`;
    try {
      const { password } = await readJsonObject(req, tooShort);
      if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, tooShort);
      if (isServiceAccount(await getUsername(id))) {
        return NextResponse.json({ error: "לא ניתן לפעול על חשבון שירות" }, { status: 400 });
      }
      // Admin-driven reset is ALWAYS temporary → the user must set a new one at
      // login. Any client-supplied `temporary:false` is ignored on purpose.
      await resetPassword(id, password, true);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return adminErrorResponse(e, "הפעולה נכשלה. נסה שוב.");
    }
  },
  { role: ACCESS.usersAdmin },
);
