// User-management API — update (profile / role / enabled) + delete. Manager-only.
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import {
  updateUserProfile,
  setUserRole,
  setUserEnabled,
  deleteUser,
  getUsername,
  isLastEnabledManager,
  adminErrorResponse,
} from "@/lib/keycloak-admin";
import { ACCESS, ADMIN_ROLE, isAppRole } from "@/lib/auth/roles";
import { readJsonObject } from "@/lib/http/request";
import { cleanName, employeeNumberEdit, isSameAccount, isServiceAccount, isUserId } from "@/lib/users/rules";

export const runtime = "nodejs";

const FAILED = "הפעולה נכשלה. נסה שוב.";

export const PUT = withAuth<{ id: string }>(
  async (req: NextRequest, { session, params: { id } }) => {
    if (!isUserId(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    try {
      const body = await readJsonObject(req, "invalid input");
      const targetUsername = await getUsername(id);
      if (isServiceAccount(targetUsername)) {
        return NextResponse.json({ error: "לא ניתן לפעול על חשבון שירות" }, { status: 400 });
      }
      const isSelf = isSameAccount(targetUsername, session.user.preferredUsername);

      // One body can trip both the role guard and the enabled guard; the answer
      // can't change mid-request, so resolve it at most once.
      let lastManager: boolean | undefined;
      const isLastManager = async () =>
        (lastManager ??= await isLastEnabledManager(id));

      if (
        typeof body.firstName === "string" ||
        typeof body.lastName === "string" ||
        body.employeeNumber !== undefined
      ) {
        await updateUserProfile(id, {
          firstName: cleanName(body.firstName),
          lastName: cleanName(body.lastName),
          employeeNumber: employeeNumberEdit(body.employeeNumber),
        });
      }
      if (typeof body.role === "string") {
        if (!isAppRole(body.role)) {
          return NextResponse.json({ error: "invalid role" }, { status: 400 });
        }
        // Lockout guard: block demoting YOURSELF, or the LAST enabled manager,
        // away from the manager role (would leave 0 managers).
        if (body.role !== ADMIN_ROLE) {
          if (isSelf) {
            return NextResponse.json({ error: "לא ניתן להוריד לעצמך את הרשאת המנהל" }, { status: 400 });
          }
          if (await isLastManager()) {
            return NextResponse.json({ error: "לא ניתן להסיר את המנהל האחרון מהמערכת" }, { status: 400 });
          }
        }
        await setUserRole(id, body.role);
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
      return adminErrorResponse(e, FAILED);
    }
  },
  { role: ACCESS.usersAdmin },
);

export const DELETE = withAuth<{ id: string }>(
  async (_req: NextRequest, { session, params: { id } }) => {
    if (!isUserId(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    try {
      const targetUsername = await getUsername(id);
      if (isServiceAccount(targetUsername)) {
        return NextResponse.json({ error: "לא ניתן לפעול על חשבון שירות" }, { status: 400 });
      }
      if (isSameAccount(targetUsername, session.user.preferredUsername)) {
        return NextResponse.json({ error: "לא ניתן למחוק את המשתמש שאיתו אתה מחובר" }, { status: 400 });
      }
      if (await isLastEnabledManager(id)) {
        return NextResponse.json({ error: "לא ניתן למחוק את המנהל האחרון מהמערכת" }, { status: 400 });
      }
      await deleteUser(id);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return adminErrorResponse(e, FAILED);
    }
  },
  { role: ACCESS.usersAdmin },
);
