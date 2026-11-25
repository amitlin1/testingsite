"use client";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * A list a screen shows and edits, read through React Query. `loading` until the first rows
 * arrive; `failed` when that read failed — a failed read is not an empty list (the screen shows
 * its own band and a retry, never "nothing here yet"); `reload` reads again; `update` patches the
 * cached rows after a save, so a successful write needs no second read.
 */
export function useListQuery<T>(queryKey: QueryKey, read: () => Promise<T[]>) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey, queryFn: read });
  const failed = query.isError && query.data === undefined && !query.isFetching;
  return {
    rows: query.data ?? [],
    loading: query.data === undefined && !failed,
    failed,
    reload: () => query.refetch(),
    update: (patch: (rows: T[]) => T[]) => queryClient.setQueryData<T[]>(queryKey, (prev) => patch(prev ?? [])),
  };
}
