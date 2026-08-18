// Directory of pickable people, backed by Keycloak — replaces the old local
// `workers` table (/api/workers, /api/settings/workers) as the data source
// for every "who did this" picker (shipment attribution, testing-station
// roster). Any authenticated user, unlike /api/users which is manager-only:
// a tester picking a storekeeper on a shipment form isn't managing accounts.
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { getWorkersDirectory } from "@/lib/keycloak-admin";

export const runtime = "nodejs";

export const GET = withAuth(async () => {
  try {
    const workers = await getWorkersDirectory();
    return NextResponse.json(workers);
  } catch (e) {
    console.error("workers-directory error", e);
    return NextResponse.json({ error: "טעינת רשימת העובדים נכשלה" }, { status: 502 });
  }
});
