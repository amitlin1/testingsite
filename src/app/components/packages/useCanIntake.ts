"use client";
import { useSession } from "next-auth/react";
import { ACCESS, can } from "@/lib/auth/roles";

/** May the signed-in user take boxes in? False until the session is known. */
export function useCanIntake(): boolean {
  const { data: session } = useSession();
  return can(session?.roles, ACCESS.intake);
}
