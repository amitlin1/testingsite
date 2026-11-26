// Each main role's bundle as Keycloak holds it — the perm-… roles of its composite (roles.ts) —
// for the "מה כל תפקיד יכול לעשות" panel. Manager-only. A role answered with [] is not a bundle
// yet (the migration script has not run): the panel shows the default bundle.
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { adminErrorResponse, getRoleBundles } from "@/lib/keycloak-admin";

export const runtime = "nodejs";

export const GET = withAuth(
  async () => {
    try {
      return NextResponse.json({ bundles: await getRoleBundles() });
    } catch (e) {
      return adminErrorResponse(e, "טעינת ההרשאות של התפקידים נכשלה");
    }
  },
  { perm: ACCESS.usersAdmin },
);
