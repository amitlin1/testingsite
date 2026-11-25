"use client";

// Client-side providers boundary.
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
// sitting idle never reaches an expired token. Every SESSION_REFETCH_SECONDS
// (lib/auth/timing.ts: the realm's 900s access-token lifetime less the refresh
// leeway, 840s) the provider polls /api/auth/session, which re-runs the jwt
// callback and refreshes the access token while it is still valid.
// It is also what surfaces session.error to the shell's idle-tab redirect effect.

import * as React from "react";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BASE_PATH } from "@/lib/base-path";
import { SESSION_REFETCH_SECONDS } from "@/lib/auth/timing";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { Toaster } from "@/components/ui/Toast";

const AUTH_BASE = `${BASE_PATH}/api/auth`;

// React Query: the list screens (packages, testing, settings) read through it so a filter
// change, a refocus or a mutation refreshes the data without a full reload.
// One client per browser tab, created lazily so SSR never shares it.
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(makeQueryClient);
  return (
    <SessionProvider basePath={AUTH_BASE} refetchInterval={SESSION_REFETCH_SECONDS}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
