"use client";

// Client-side providers boundary. PORTABLE.
//
// PITFALL: do NOT pass a `session` prop to <SessionProvider>. In v5, passing it
// prevents the refreshed token from persisting and re-runs the refresh effect on
// every navigation. The provider fetches the session from the server on its own.
//
// basePath: SessionProvider must be told the basePath explicitly — it does NOT
// inherit Next's. Without it the client polls /api/auth/session (no prefix) and
// 404s through the reverse proxy. (Root mount → BASE_PATH is "".)
//
// PROACTIVE TIMER REFRESH (refetchInterval): the primary defence so a user
// sitting idle never reaches an expired token. Every SESSION_REFETCH_SECONDS the
// provider polls /api/auth/session, which re-runs the jwt callback and refreshes
// the access token while it is still valid. Set this ~1 min UNDER the access-
// token lifetime so each poll lands inside the jwt callback's refresh window.
// Our realm's access token lifetime is 15 min (900s), so 840s = 14 min.
// It is also what surfaces session.error to the shell's idle-tab redirect effect.

import * as React from "react";
import { SessionProvider } from "next-auth/react";
import { BASE_PATH } from "@/lib/base-path";

const SESSION_REFETCH_SECONDS = 14 * 60; // 840s — accessTokenTTL(900s) - ~60s
const AUTH_BASE = `${BASE_PATH}/api/auth`;

// Dev-mode flag delivered from the SERVER at runtime (root layout reads
// process.env.IS_DEV). Deliberately NOT NEXT_PUBLIC_IS_DEV (that would bake in
// at build time); through this context it's a pure runtime switch.
const DevModeContext = React.createContext(false);

/** Client hook — true when the server is running with IS_DEV=1. */
export function useIsDev(): boolean {
  return React.useContext(DevModeContext);
}

export function Providers({
  children,
  isDev = false,
}: {
  children: React.ReactNode;
  isDev?: boolean;
}) {
  return (
    <SessionProvider basePath={AUTH_BASE} refetchInterval={SESSION_REFETCH_SECONDS}>
      <DevModeContext.Provider value={isDev}>{children}</DevModeContext.Provider>
    </SessionProvider>
  );
}
