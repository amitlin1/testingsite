// The JSON refusals an /api request gets from the middleware and from withAuth — one body each.
// apiFetch (lib/api/client.ts) keys its refresh-and-retry off this 401: it must stay a JSON 401,
// never a redirect. A 403 is a valid session without the role, never an expiry.
import { NextResponse } from "next/server";

export const unauthorized = (): NextResponse => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export const forbidden = (required: readonly string[]): NextResponse =>
  NextResponse.json({ error: "Forbidden", required }, { status: 403 });
