"use client";

// §8.9 — performance by item type.
//
// `מסלולים` IS NOT `סה״כ`. `totalItems` is the routed population — a count of
// route runs — and emphatically not `SUM(shipments.amount)`, which is an
// inventory number summed once per shipment LINE and 0 wherever nobody filled it
// in. The declared amount is its own column, `הוצהרו`, with an em dash when it
// is null.
//
// Grouped by item type the unit is the route RUN, never a distinct unit_id: an
// accessory shares its parent's unit but carries its own type, so unit_id
// undercounts by roughly 4x. `routed_units` is deliberately not on this
// endpoint at all.
//
// THIS SCREEN SENDS NO DATES. Q7 has no window, so the request carries none and
// the card says as much on screen — a range control that silently means nothing
// is worse than no control.

import * as React from "react";

import DataCard, { IgnoredFiltersPill, NeutralPill } from "../_components/DataCard";
import DenseTable, { type Column } from "../_components/DenseTable";
import { ProgressCell } from "../_components/LoadBar";
import TwinDuration from "../_components/TwinDuration";
import type { ItemTypeView } from "@/app/lib/dashboard/contract";
import {
  completionTone,
  describeIgnoredFilters,
  formatCount,
  formatMinutes,
  workTwin,
} from "../_lib/format";
import type { TabProps } from "./tabTypes";
import CardInfo from "../_components/CardInfo";
import { EXPLAIN } from "../_lib/explain";

export default function ItemTypesTab({ api, data, openHistory }: TabProps) {
  const types = data.get("types");
  const ignored = describeIgnoredFilters(types.meta.ignoredFilters);

  const columns: Array<Column<ItemTypeView>> = [
    {
      key: "name",
      header: "סוג פריט",
      sortValue: (r) => r.itemTypeDesc,
      render: (r) => <span style={{ fontWeight: 600 }}>{r.itemTypeDesc}</span>,
    },
    {
      key: "routes",
      header: "מסלולים",
      numeric: true,
      sortValue: (r) => r.totalItems,
      render: (r) => formatCount(r.totalItems),
    },
    {
      key: "declared",
      header: "הוצהרו",
      numeric: true,
      secondary: true,
      sortValue: (r) => r.declaredAmount,
      render: (r) => (
        <span style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>
          {formatCount(r.declaredAmount)}
        </span>
      ),
    },
    {
      key: "queue",
      header: "בתור",
      numeric: true,
      sortValue: (r) => r.itemsInQueue,
      render: (r) => formatCount(r.itemsInQueue),
    },
    {
      key: "test",
      header: "בבדיקה",
      numeric: true,
      sortValue: (r) => r.itemsInTest,
      render: (r) => formatCount(r.itemsInTest),
    },
    {
      key: "done",
      header: "הסתיימו",
      numeric: true,
      sortValue: (r) => r.itemsFinished,
      render: (r) => formatCount(r.itemsFinished),
    },
    {
      key: "completion",
      header: "אחוז השלמה",
      width: "24%",
      sortValue: (r) => r.completionPercentage,
      render: (r) => (
        <ProgressCell value={r.completionPercentage} tone={completionTone(r.completionPercentage)} />
      ),
    },
    {
      key: "avg",
      header: "זמן ממוצע · ברוטו",
      numeric: true,
      sortValue: (r) => r.routeTurnaroundWallMinutes,
      // The work twin is printed under the wall figure (§16.1).
      render: (r) => (
        <TwinDuration
          value={formatMinutes(r.routeTurnaroundWallMinutes)}
          twin={workTwin(r.routeTurnaroundWallMinutes, r.routeTurnaroundWorkMinutes)}
        />
      ),
    },
  ];

  return (
    <DataCard
      panel
      title={<>ביצועים לפי סוג פריט<CardInfo explain={EXPLAIN.types} /></>}
      right={
        <>
          <span style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>
            מזהה איזה דגם מייצר את רוב התור
          </span>
          <NeutralPill text="המסך אינו תלוי בטווח התאריכים" />
          {ignored && <IgnoredFiltersPill text={ignored.text} />}
        </>
      }
      error={types.error}
      onRetry={data.refresh}
      style={{ flex: 1, minHeight: 0 }}
    >
      <DenseTable
        columns={columns}
        rows={types.data}
        rowKey={(row) => row.itemTypeId}
        loading={types.loading}
        defaultSort={{ key: "queue", dir: "desc" }}
        onRowClick={(row) =>
          openHistory({
            kind: "type",
            id: row.itemTypeId,
            title: row.itemTypeDesc,
          })
        }
        empty={{
          text: "אין סוגי פריט שמתאימים למסננים האלה.",
          action: { label: "נקה את המסננים", onClick: api.clearFilters },
        }}
      />
    </DataCard>
  );
}
