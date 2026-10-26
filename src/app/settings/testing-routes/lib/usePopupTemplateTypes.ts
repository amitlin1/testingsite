"use client";
import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import type { PackageRole } from "@/app/lib/popup-templates/schema";

/**
 * The station types that have a popup template (GET /api/settings/popup-templates,
 * docs/popup-templates/PLAN.md §3.6), with its base and — a package template — its role: the cell
 * editor's preview draws their popup as the template's (popupKindOf "template"), and the route's
 * steps flag a package template whose role its step's place does not call for (PLAN §5, step 2.6).
 * One request per page load, shared by every component that mounts; null until it answers, and
 * after a failure (the preview then draws the code's popups, as before).
 */
export type TemplateInfo = { base: string; role: PackageRole | null };

let request: Promise<ReadonlyMap<number, TemplateInfo> | null> | null = null;

function load(): Promise<ReadonlyMap<number, TemplateInfo> | null> {
  request ??= apiFetch("/api/settings/popup-templates")
    .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
    .then((rows: { station_type_id: number; base: string; role?: PackageRole | null }[]) =>
      new Map(rows.map((r) => [r.station_type_id, { base: r.base, role: r.role ?? null }])) as ReadonlyMap<number, TemplateInfo>)
    .catch(() => {
      request = null; // the next editor asks again
      return null;
    });
  return request;
}

export function usePopupTemplateTypes(): ReadonlyMap<number, TemplateInfo> | null {
  const [types, setTypes] = React.useState<ReadonlyMap<number, TemplateInfo> | null>(null);
  React.useEffect(() => {
    let alive = true;
    void load().then((t) => { if (alive) setTypes(t); });
    return () => { alive = false; };
  }, []);
  return types;
}
