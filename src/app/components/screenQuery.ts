/**
 * React Query options for a screen's own read (not a shared lookup): it loads when the screen or
 * dialog mounts and when the screen asks again (a retry button, a save) — no automatic retry, no
 * refetch on focus or reconnect, and nothing kept once it closes, so the next visit shows its
 * loading state and reads fresh. A save marks it stale through its query key.
 */
export const READ_PER_VISIT = {
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  staleTime: 0,
  gcTime: 0,
} as const;
