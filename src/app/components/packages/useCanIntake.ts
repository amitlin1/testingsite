"use client";
import { useSession } from "next-auth/react";
import { ACCESS, hasAnyRole } from "@/lib/auth/roles";

/** May the signed-in user take boxes in? False until the session is known. */
export function useCanIntake(): boolean {
  const { data: session } = useSession();
  return hasAnyRole(session?.roles ?? [], ACCESS.intake);
}
