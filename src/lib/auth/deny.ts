// The JSON refusals an /api request gets from the middleware and from withAuth — one body each.
// apiFetch (lib/api/client.ts) keys its refresh-and-retry off this 401: it must stay a JSON 401,
// never a redirect. A 403 is a valid session without the permission, never an expiry.
import { NextResponse } from "next/server";
import type { Permission } from "@/lib/auth/roles";

export const unauthorized = (): NextResponse => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/** `required`: the Keycloak role that grants what was refused (perm-…). */
export const forbidden = (perm: Permission): NextResponse =>
  NextResponse.json({ error: "Forbidden", required: perm.role }, { status: 403 });
