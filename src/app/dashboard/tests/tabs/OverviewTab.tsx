"use client";

// §8.1 — the morning screen: is the floor moving, where is it stuck, which
// customer will call.
//
// Top to bottom: the job-health strip (§16.5.1 — on an isolated LAN this
// dashboard is the only alerting path, so the verdict is pinned above
// everything else), the live station board, then a fixed 230px row of two
// small widgets (the 14-day average-times chart was removed on 2026-11-26 —
// the זמנים ממוצעים tab is where times are read).
//
// `משלוחים בסיכון` ranks by completion ASCENDING — a shipment has no due date,
// so "at risk" means "least advanced", and the card's ⓘ says so — and a shipment whose
// completion is `null` is NOT at the top of that list: null means nothing was
// routed yet, which is an absence of work rather than a failure of it. Those
// rows sort last.
//
// NO WIDGET SPEAKS BEFORE ITS ENDPOINT DOES. Until the status and shipment
// endpoints answer, the donut and the at-risk list are skeletons — not "0
// פעילים" and not "יום שקט" — and when one fails its card shows the error band
// with a retry, never a calm empty state.

import * as React from "react";

import { Skeleton } from "@/components/ui";
import { ArrowForward } from "@/components/ui/icons";
import DataCard, { IgnoredFiltersPill, Legend } from "../_components/DataCard";
import DenseTable from "../_components/DenseTable";
import JobHealthStrip from "../_components/JobHealthStrip";
import { FillBar } from "../_components/LoadBar";
import StatusDonut from "../_components/charts/StatusDonut";
import { STATE_COLOR, stateColor } from "../_components/charts/palette";
import {
  completionTone,
  describeIgnoredFilters,
  formatClock,
  formatPercent,
  isNil,
  toneMark,
  toneText,
} from "../_lib/format";
import { SHARED_QUEUE_NOTE, stationColumns, stationHistoryTarget, stationsEmpty } from "./stationColumns";
import type { TabProps } from "./tabTypes";
import CardInfo from "../_components/CardInfo";
import { EXPLAIN } from "../_lib/explain";

export default function OverviewTab({ api, data, openHistory }: TabProps) {
  const stations = data.get("stationsLive");
  const status = data.get("status");
  const shipments = data.get("shipments");
  const jobs = data.get("jobs");

  const ignored = describeIgnoredFilters(stations.meta.ignoredFilters);
  // No useMemo: the React Compiler memoises this, and a hand-written dependency
  // array on a value derived from `stations.data` is what it refuses to preserve.
  const columns = stationColumns({ rows: stations.data ?? [], full: false });

  // "Not answered yet" covers the first load AND the instant before the first
  // fetch starts; "failed" is an answer with no rows behind it.
  const statusPending = status.data === null && !status.error;
  const statusFailed = status.data === null && !!status.error;
  const shipmentsPending = shipments.data === null && !shipments.error;
  const shipmentsFailed = shipments.data === null && !!shipments.error;

  const slices = status.data ?? [];
  const activeTotal = slices.reduce((sum, slice) => sum + slice.count, 0);
  const asOf = slices[0]?.asOf ?? null;

  const atRisk = React.useMemo(
    () =>
      [...(shipments.data ?? [])]
        .sort((a, b) => {
          if (isNil(a.completionPercentage) && isNil(b.completionPercentage)) return 0;
          if (isNil(a.completionPercentage)) return 1;
          if (isNil(b.completionPercentage)) return -1;
          return a.completionPercentage - b.completionPercentage;
        })
        .slice(0, 5),
    [shipments.data],
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <JobHealthStrip payload={jobs.data} error={jobs.error} loading={jobs.loading} />

      <DataCard
        panel
        title={<>עומס לפי עמדה · עכשיו<CardInfo explain={EXPLAIN.stationLoad} /></>}
        right={
          <>
            <Legend
              items={[
                { color: STATE_COLOR.testing, label: "בבדיקה" },
                { color: STATE_COLOR.queued, label: "בתור של סוג העמדה" },
              ]}
            />
            {ignored && <IgnoredFiltersPill text={ignored.text} />}
          </>
        }
        note={SHARED_QUEUE_NOTE}
        error={stations.error}
        onRetry={data.refresh}
        style={{ flex: 1, minHeight: 0 }}
      >
        <DenseTable
          columns={columns}
          rows={stations.data}
          rowKey={(row) => row.stationId}
          loading={stations.loading}
          defaultSort={{ key: "queue", dir: "desc" }}
          onRowClick={(row) => openHistory(stationHistoryTarget(row))}
          empty={stationsEmpty(api.clearFilters)}
        />
      </DataCard>

      <div className="dash-bottom" style={{ height: 230, flexShrink: 0, display: "flex", gap: 10 }}>
        <DataCard
          chart
          title={<>התפלגות סטטוסים<CardInfo explain={EXPLAIN.statusDonut} /></>}
          right={
            asOf ? (
              <span style={{ fontSize: "var(--text-micro)", color: "var(--color-ink-muted-48)" }}>
                נכון ל-{formatClock(asOf)}
              </span>
            ) : null
          }
          error={status.error}
          onRetry={data.refresh}
          style={{ width: 280, flexShrink: 0, padding: "12px 14px" }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <StatusDonut
              data={slices}
              size={88}
              total={statusFailed ? null : activeTotal}
              centreLabel="פעילים"
              compact
              loading={statusPending}
            />
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 5 }}>
              {statusPending &&
                [0, 1, 2].map((i) => <Skeleton key={i} variant="text" height={12} width="100%" />)}
              {slices.map((slice) => (
                <div
                  key={slice.stateKey}
                  style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "var(--text-fine)" }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: stateColor(slice.stateKey),
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1 }}>{slice.statusName}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {formatPercent(slice.percentage, 1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </DataCard>

        <DataCard
          chart
          title={<>משלוחים בסיכון<CardInfo explain={EXPLAIN.atRisk} /></>}
          right={
            <button type="button" onClick={() => api.setTab("shipments")} className="dash-link">
              הכל
              <ArrowForward fontSize={13} aria-hidden />
            </button>
          }
          error={shipments.error}
          onRetry={data.refresh}
          style={{ flex: 1, minWidth: 0, padding: "12px 14px" }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            {shipmentsPending &&
              [0, 1, 2, 3, 4].map((i) => (
                <div key={i} aria-hidden>
                  <Skeleton variant="text" height={12} width="80%" />
                  <Skeleton variant="rounded" height={5} width="100%" style={{ marginTop: 4 }} />
                </div>
              ))}
            {/* The calm sentence only when the endpoint really answered "none". */}
            {!shipmentsPending && !shipmentsFailed && atRisk.length === 0 && (
              <div style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>
                אין משלוחים פתוחים. יום שקט.
              </div>
            )}
            {atRisk.map((shipment) => {
              const tone = completionTone(shipment.completionPercentage);
              return (
                <button
                  key={shipment.shipmentId}
                  type="button"
                  className="dash-risk-row"
                  onClick={() =>
                    openHistory({
                      kind: "shipment",
                      id: shipment.shipmentId,
                      title: shipment.shipmentCode,
                      meta: shipment.customerCode,
                    })
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      fontSize: "var(--text-fine)",
                      gap: 8,
                    }}
                  >
                    <span style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {shipment.shipmentCode} · {shipment.customerCode}
                    </span>
                    <span style={{ color: toneText(tone), fontWeight: 600, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                      {formatPercent(shipment.completionPercentage)}
                    </span>
                  </div>
                  <FillBar
                    pct={shipment.completionPercentage ?? 0}
                    color={toneMark(tone)}
                    height={5}
                    style={{ marginTop: 4 }}
                  />
                </button>
              );
            })}
          </div>
        </DataCard>
      </div>
    </div>
  );
}
