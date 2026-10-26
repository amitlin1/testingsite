"use client";
import * as React from "react";
import { apiFetch } from "@/lib/api/client";

/**
 * The station types that have a popup template (GET /api/settings/popup-templates,
 * docs/popup-templates/PLAN.md §3.6) — the cell editor's preview draws their popup as the template's
 * (popupKindOf "template"). One request per page load, shared by every editor that mounts; null
 * until it answers, and after a failure (the preview then draws the code's popups, as before).
 */
let request: Promise<ReadonlySet<number> | null> | null = null;

function load(): Promise<ReadonlySet<number> | null> {
  request ??= apiFetch("/api/settings/popup-templates")
    .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
    .then((rows: { station_type_id: number }[]) => new Set(rows.map((r) => r.station_type_id)) as ReadonlySet<number>)
    .catch(() => {
      request = null; // the next editor asks again
      return null;
    });
  return request;
}

export function usePopupTemplateTypes(): ReadonlySet<number> | null {
  const [types, setTypes] = React.useState<ReadonlySet<number> | null>(null);
  React.useEffect(() => {
    let alive = true;
    void load().then((t) => { if (alive) setTypes(t); });
    return () => { alive = false; };
  }, []);
  return types;
}
