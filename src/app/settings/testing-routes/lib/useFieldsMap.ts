"use client";
import * as React from "react";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { currentConfigs } from "./draftModel";
import { useDraftSnapshot } from "./draftStore";
import { buildFieldsMap } from "./mapModel";
import type { FieldsMapModel } from "./mapModel";

/** The fields map of `context` with every route's working copy and issues (mapModel). */
export function useFieldsMap(context: FieldsContextJson | null, setVersions?: Readonly<Record<number, number>>): FieldsMapModel | null {
  const { model, summary } = useDraftSnapshot();
  return React.useMemo(
    () => (context ? buildFieldsMap({ context, configs: currentConfigs(model), issues: summary.issuesByRoute, setVersions }) : null),
    [context, model, summary, setVersions],
  );
}
