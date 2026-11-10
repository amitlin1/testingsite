"use client";
import { useSession } from "next-auth/react";
import { hasAnyRole } from "@/lib/auth/roles";
import { INTAKE_ROLES } from "@/app/lib/packages/roles";

/** May the signed-in user take boxes in? False until the session is known. */
export function useCanIntake(): boolean {
  const { data: session } = useSession();
  return hasAnyRole(session?.roles ?? [], INTAKE_ROLES);
}
