"use client";

// §8.5 — shipment progress. Sorted by completion ASCENDING: the problems come
// first, which is the whole point of the tab.
//
// TWO RATIOS, TWO MEANINGS, AND NEITHER DIVIDES BY `shipments.amount` for the
// work figure:
//
//   התקדמות   completionPercentage = finished_runs / routed_runs. The same
//             formula as customers and item types — one denominator everywhere.
//   במסלול    itemsInRoutesPercentage = routed_units / amount. COVERAGE against
//             the declared stock, a separate number under a separate name.
//
// `סה״כ` is the declared amount: displayed, never divided into for the first
// ratio. Both ratios are `number | null` and a null prints as an em dash — a
// shipment that declared nothing has no coverage to report, and "0%" would be a
// claim about work nobody asked for.

import * as React from "react";

import DataCard, { IgnoredFiltersPill } from "@/app/components/dashboard/DataCard";
import DenseTable, { type Column } from "@/app/components/dashboard/DenseTable";
import { ProgressCell } from "@/app/components/dashboard/LoadBar";
import type { ShipmentWire } from "@/app/lib/dashboard/api-types";
import {
  completionTone,
  describeIgnoredFilters,
  formatCount,
  formatPercent,
  formatShortDate,
} from "@/app/lib/dashboard/format";
import type { TabProps } from "./tabTypes";

export function shipmentColumns(): Array<Column<ShipmentWire>> {
  return [
    {
      key: "code",
      header: "משלוח",
      sortValue: (r) => r.shipmentCode,
      render: (r) => (
        <span style={{ fontWeight: 600, color: "var(--color-primary)" }}>{r.shipmentCode}</span>
      ),
    },
    {
      key: "customer",
      header: "לקוח",
      sortValue: (r) => r.customerName,
      render: (r) => <span style={{ fontSize: 12.5 }}>{r.customerName}</span>,
    },
    {
      key: "date",
      header: "תאריך",
      numeric: true,
      secondary: true,
      sortValue: (r) => new Date(r.shipmentDate).getTime() || null,
      render: (r) => (
        <span style={{ fontSize: 12.5, color: "var(--color-ink-muted-48)" }}>
          {formatShortDate(r.shipmentDate)}
        </span>
      ),
    },
    {
      key: "total",
      header: "סה״כ",
      numeric: true,
      sortValue: (r) => r.totalItems,
      render: (r) => formatCount(r.totalItems),
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
      key: "research",
      header: "במחקר",
      numeric: true,
      sortValue: (r) => r.itemsInResearch + r.itemsWaitingForResearch,
      render: (r) => formatCount(r.itemsInResearch + r.itemsWaitingForResearch),
    },
    {
      key: "done",
      header: "הסתיימו",
      numeric: true,
      sortValue: (r) => r.itemsFinished,
      render: (r) => <span style={{ fontWeight: 600 }}>{formatCount(r.itemsFinished)}</span>,
    },
    {
      key: "progress",
      header: "התקדמות",
      width: "22%",
      sortValue: (r) => r.completionPercentage,
      render: (r) => (
        <ProgressCell value={r.completionPercentage} tone={completionTone(r.completionPercentage)} />
      ),
    },
    {
      key: "inRoutes",
      header: "במסלול",
      numeric: true,
      sortValue: (r) => r.itemsInRoutesPercentage,
      render: (r) => (
        <span style={{ fontSize: 12.5, color: "var(--color-ink-muted-48)" }}>
          {formatPercent(r.itemsInRoutesPercentage)}
        </span>
      ),
    },
  ];
}

export default function ShipmentsTab({ api, data, openHistory }: TabProps) {
  const shipments = data.get<ShipmentWire[]>("shipments");
  const rows = shipments.data ?? [];
  const ignored = describeIgnoredFilters(
    shipments.meta.ignoredFilters ?? rows[0]?._new_ignoredFilters ?? null,
  );

  return (
    <DataCard
      panel
      title="התקדמות משלוחים פתוחים"
      right={
        <>
          <span style={{ fontSize: 11.5, color: "var(--color-ink-muted-48)" }}>
            ״במסלול״ = פריטים שכבר נפתח להם מסלול בדיקה
          </span>
          {ignored && <IgnoredFiltersPill text={ignored.text} />}
        </>
      }
      error={shipments.error}
      onRetry={data.refresh}
      style={{ flex: 1, minHeight: 0 }}
    >
      <DenseTable
        columns={shipmentColumns()}
        rows={shipments.data}
        rowKey={(row) => row.shipmentId}
        loading={shipments.loading}
        defaultSort={{ key: "progress", dir: "asc" }}
        onRowClick={(row) =>
          openHistory({
            kind: "shipment",
            id: row.shipmentId,
            title: row.shipmentCode,
            meta: row.customerName,
          })
        }
        empty={{
          text: "אין משלוחים פתוחים. יום שקט.",
          action: {
            label: "הצג גם משלוחים שנשלחו",
            onClick: () => api.setFilter("showAllHistory", true),
          },
        }}
      />
    </DataCard>
  );
}
