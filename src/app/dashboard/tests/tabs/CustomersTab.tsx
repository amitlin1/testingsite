"use client";

// §8.8 — performance by customer.
//
// THE COLUMN IS `השלמה`, NOT `אחוז הצלחה`. `successPercentage` is
// finished_runs / routed_runs — completion. Real pass/fail success is a
// different metric that is not on this screen at all, and the field keeps its
// old name only because the wire contract has not been renamed yet. The label
// must not repeat the lie.
//
// `במסלול %` used to be locked at 100 because a LEFT JOIN had decayed into an
// INNER. It is real coverage now: a value under 100 is information, not a bug.
//
// EVERY CUSTOMER IS RETURNED, including all-zero rows, and they are not
// filtered out here. A customer with nothing routed reads as an em dash in both
// ratios — "0%" would be a claim about work never asked for.
//
// The date picker filters the `_new_window*` half only: the Q7 half (routed,
// finished, live counts) is a state query with no window by design, which is
// why the trend column compares the WINDOW's steps and not the standing totals.

import * as React from "react";

import DataCard, { IgnoredFiltersPill } from "@/app/components/dashboard/DataCard";
import DenseTable, { type Column } from "@/app/components/dashboard/DenseTable";
import { ProgressCell } from "@/app/components/dashboard/LoadBar";
import TrendCell from "@/app/components/dashboard/TrendCell";
import type { CustomerWire } from "@/app/lib/dashboard/api-types";
import {
  completionTone,
  describeIgnoredFilters,
  formatCount,
  formatMinutes,
  formatPercent,
} from "@/app/lib/dashboard/format";
import type { TabProps } from "./tabTypes";

export default function CustomersTab({ api, data, openHistory }: TabProps) {
  const customers = data.get<CustomerWire[]>("customers");
  const prev = data.get<CustomerWire[]>("customersPrev");
  const ignored = describeIgnoredFilters(customers.meta.ignoredFilters);
  const prevById = React.useMemo(
    () => new Map((prev.data ?? []).map((r) => [r.customerId, r])),
    [prev.data],
  );

  const columns: Array<Column<CustomerWire>> = [
    {
      key: "name",
      header: "לקוח",
      sortValue: (r) => r.customerName,
      render: (r) => <span style={{ fontWeight: 600 }}>{r.customerName}</span>,
    },
    {
      key: "code",
      header: "קוד",
      secondary: true,
      sortValue: (r) => r.customerCode,
      render: (r) => (
        <span
          style={{
            fontSize: 12.5,
            color: "var(--color-ink-muted-48)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {r.customerCode}
        </span>
      ),
    },
    {
      key: "total",
      header: "סה״כ פריטים",
      numeric: true,
      sortValue: (r) => r.totalItems,
      render: (r) => formatCount(r.totalItems),
    },
    {
      key: "coverage",
      header: "במסלול",
      numeric: true,
      sortValue: (r) => r.itemsInRoutesPercentage,
      render: (r) => (
        <span style={{ color: "var(--color-ink-muted-48)" }}>
          {formatPercent(r.itemsInRoutesPercentage)}
        </span>
      ),
    },
    {
      key: "done",
      header: "הסתיימו",
      numeric: true,
      sortValue: (r) => r.finishedItems,
      render: (r) => formatCount(r.finishedItems),
    },
    {
      key: "success",
      header: "השלמה",
      width: "20%",
      sortValue: (r) => r.successPercentage,
      render: (r) => (
        <ProgressCell value={r.successPercentage} tone={completionTone(r.successPercentage)} />
      ),
    },
    {
      key: "avg",
      header: "זמן ממוצע · ברוטו",
      numeric: true,
      sortValue: (r) => r.averageTimeMinutes,
      render: (r) => (
        <span
          title={
            r._new_averageTimeWorkMinutes === null
              ? undefined
              : `נטו ${formatMinutes(r._new_averageTimeWorkMinutes)}`
          }
        >
          {formatMinutes(r.averageTimeMinutes)}
        </span>
      ),
    },
    {
      key: "trend",
      header: "מגמה",
      numeric: true,
      render: (r) => (
        <TrendCell
          current={r._new_windowStepsProcessed}
          previous={prevById.get(r.customerId)?._new_windowStepsProcessed}
          pending={prev.loading || prev.data == null}
        />
      ),
    },
  ];

  return (
    <DataCard
      panel
      title="ביצועים לפי לקוח"
      right={
        <>
          <span style={{ fontSize: 11.5, color: "var(--color-ink-muted-48)" }}>
            ״השלמה״ = מסלולים שנסגרו מתוך מה שנפתח לו מסלול · לקוח בלי מסלולים מוצג כ־־־ ולא כאפס
          </span>
          {ignored && <IgnoredFiltersPill text={ignored.text} />}
        </>
      }
      error={customers.error}
      onRetry={data.refresh}
      style={{ flex: 1, minHeight: 0 }}
    >
      <DenseTable
        columns={columns}
        rows={customers.data}
        rowKey={(row) => row.customerId}
        loading={customers.loading}
        defaultSort={{ key: "success", dir: "asc" }}
        onRowClick={(row) =>
          openHistory({
            kind: "customer",
            id: row.customerId,
            title: row.customerName,
            meta: row.customerCode,
          })
        }
        empty={{
          text: "אין לקוחות שמתאימים למסננים האלה.",
          action: { label: "נקה את המסננים", onClick: api.clearFilters },
        }}
      />
    </DataCard>
  );
}
