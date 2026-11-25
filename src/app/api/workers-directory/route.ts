// Directory of pickable people, backed by Keycloak — replaces the old local
// `workers` table (/api/workers, /api/settings/workers) as the data source
// for every "who did this" picker (shipment attribution, testing-station
// roster). Any authenticated user, unlike /api/users which is manager-only:
// a tester picking a storekeeper on a shipment form isn't managing accounts.
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { adminErrorResponse, getWorkersDirectory } from "@/lib/keycloak-admin";

export const runtime = "nodejs";

export const GET = withAuth(async () => {
  try {
    return NextResponse.json(await getWorkersDirectory());
  } catch (e) {
    return adminErrorResponse(e, "טעינת רשימת העובדים נכשלה");
  }
});
