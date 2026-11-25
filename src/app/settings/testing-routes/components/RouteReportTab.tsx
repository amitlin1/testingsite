"use client";
import * as React from "react";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { routeOfTypeLabel } from "@/app/lib/station-fields/labels";
import ReportTemplatesPanel, { type ReportRoute } from "@/app/components/item-report/ReportTemplatesPanel";
import { sortedLines } from "../lib/fieldsContext";

/**
 * "דוח PDF" — the report templates of the kit's item routes. A report is per ITEM, so the rows are
 * the template lines' routes, each once; the kit's box gets no report.
 */
function routesOf(context: FieldsContextJson): ReportRoute[] {
  const seen = new Set<number>();
  const out: ReportRoute[] = [];
  for (const line of sortedLines(context)) {
    if (!line.route || seen.has(line.route.route.test_route_id)) continue;
    seen.add(line.route.route.test_route_id);
    out.push({ test_route_id: line.route.route.test_route_id, label: routeOfTypeLabel(line.route_number, line.item_type_desc) });
  }
  return out;
}

export default function RouteReportTab({ context, loading }: { context: FieldsContextJson | null; loading: boolean }) {
  const routes = React.useMemo(() => (context ? routesOf(context) : null), [context]);
  return <ReportTemplatesPanel routes={routes} loading={loading} />;
}
