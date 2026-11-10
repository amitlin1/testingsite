import type { AppRole } from "@/lib/auth/roles";

/**
 * Who takes a box in from its shipment ("קליטה") and undoes that intake — the
 * same roles as the shipments screen. Enforced by the middleware rule on
 * /api/packages/intake (src/lib/routes.ts) and by withAuth on both handlers;
 * the intake buttons hide for everyone else (useCanIntake).
 */
export const INTAKE_ROLES: AppRole[] = ["manager", "storekeeper"];
