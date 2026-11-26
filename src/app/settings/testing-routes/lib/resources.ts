"use client";
import * as React from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { getJson } from "@/lib/api/client";
import type { FieldSetJson, OptionListJson } from "@/app/lib/station-fields/admin-types";
import { API, parseFieldSets, parseOptionLists, parseRouteRows, parseTemplateTypes } from "./wire";
import type { RouteRowJson, TemplateInfo } from "./wire";

/**
 * The lists the screen reads from other endpoints, each one React Query entry: every component that
 * reads a list reads the same answer, and a reload from any of them reaches all. A list is read once
 * and kept (no refetch on focus, no retry); `reload()` asks again and keeps the data on screen while
 * it does. A failed read is the error state, never an empty list.
 *
 *   useOptionLists()          the shared option lists (archived ones are not listed)
 *   useFieldSets()            the field sets (archived ones are not listed)
 *   useRoutes()               every testing route: the pickers, the header's count, the usage chips
 *   usePopupTemplateTypes()   the station types with a popup template (docs/features/popup-templates/PLAN.md
 *                             §3.6): the preview draws their popup as the template's, the steps tab
 *                             flags a role the step's place does not call for
 */

/** The query keys, for a screen that writes one of these lists (the popup templates screen). */
export const RESOURCE_KEY = {
  optionLists: ["testing-routes", "option-lists"],
  fieldSets: ["testing-routes", "field-sets"],
  routes: ["testing-routes", "routes"],
  popupTemplates: ["testing-routes", "popup-templates"],
} as const;

export type ResourceState<T> =
  | { status: "loading" }
  | { status: "error"; retrying: boolean }
  | { status: "ready"; data: T; reloading: boolean };

const LOADING = { status: "loading" } as const;

export type ResourceData<T> = { state: ResourceState<T>; data: T | null; reload: () => Promise<boolean> };

/** `retryOnMount`: a new reader asks again after a failure. */
function useResource<T>(queryKey: QueryKey, url: string, parse: (body: unknown) => T, retryOnMount = false): ResourceData<T> {
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        return parse(await getJson<unknown>(url));
      } catch (e) {
        console.error("Load failed: " + url, e);
        throw e;
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    retryOnMount,
    refetchOnWindowFocus: false,
  });
  const { data, isError, isFetching, refetch } = query;
  const state = React.useMemo(
    (): ResourceState<T> =>
      data !== undefined
        ? { status: "ready", data, reloading: isFetching }
        : isError
          ? { status: "error", retrying: isFetching }
          : LOADING,
    [data, isError, isFetching],
  );
  // One request at a time: a reload while one is under way shares it.
  const reload = React.useCallback(async () => !(await refetch({ cancelRefetch: false })).isError, [refetch]);
  return { state, data: data ?? null, reload };
}

export const useOptionLists = (): ResourceData<OptionListJson[]> =>
  useResource(RESOURCE_KEY.optionLists, API.optionLists, parseOptionLists);
export const useFieldSets = (): ResourceData<FieldSetJson[]> => useResource(RESOURCE_KEY.fieldSets, API.fieldSets, parseFieldSets);
export const useRoutes = (): ResourceData<RouteRowJson[]> => useResource(RESOURCE_KEY.routes, API.routes, parseRouteRows);

/** null until it answers, and after a failure (the preview then draws the code's popups). */
export function usePopupTemplateTypes(): ReadonlyMap<number, TemplateInfo> | null {
  return useResource(RESOURCE_KEY.popupTemplates, API.popupTemplates, parseTemplateTypes, true).data;
}

/** Names of the field sets by id (the cell's set Tag, the publish dialog's set lines). */
export function useFieldSetNames(): Readonly<Record<number, string>> {
  const { data } = useFieldSets();
  return React.useMemo(() => Object.fromEntries((data ?? []).map((s) => [s.id, s.name])), [data]);
}

/** The latest version of every field set by id — marks a cell holding an older one. */
export function useFieldSetVersions(): Readonly<Record<number, number>> {
  const { data } = useFieldSets();
  return React.useMemo(() => Object.fromEntries((data ?? []).map((s) => [s.id, s.version])), [data]);
}
