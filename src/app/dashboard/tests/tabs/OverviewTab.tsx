"use client";

// §8.1 — the morning screen: is the floor moving, where is it stuck, which
// customer will call.
//
// Top to bottom: the job-health strip (§16.5.1 — on an isolated LAN this
// dashboard is the only alerting path, so the verdict is pinned above
// everything else), the live station board, then a fixed 230px row of three
// small widgets.
//
// `משלוחים בסיכון` ranks by completion ASCENDING, and a shipment whose
// completion is `null` is NOT at the top of that list: null means nothing was
// routed yet, which is an absence of work rather than a failure of it. Those
// rows sort last.

import * as React from "react";

import DataCard, { IgnoredFiltersPill, Legend } from "@/app/components/dashboard/DataCard";
import DenseTable from "@/app/components/dashboard/DenseTable";
import JobHealthStrip from "@/app/components/dashboard/JobHealthStrip";
import StatusDonut, { stateColor } from "@/app/components/dashboard/charts/StatusDonut";
import TimesLineChart, { TIMES_LEGEND } from "@/app/components/dashboard/charts/TimesLineChart";
import { ChartBody } from "@/app/components/dashboard/charts/chartConfig";
import type {
  AverageTimesWire,
  ShipmentWire,
  StationWire,
  StatusWire,
} from "@/app/lib/dashboard/api-types";
import {
  completionTone,
  describeIgnoredFilters,
  formatClock,
  formatPercent,
  isNil,
} from "@/app/lib/dashboard/format";
import type { JobsHealthPayload } from "@/app/lib/metrics/selfcheck";
import { SHARED_QUEUE_NOTE, stationColumns } from "./stationColumns";
import { EmptyChart } from "./TimesTab";
import type { TabProps } from "./tabTypes";

export default function OverviewTab({ api, data, openHistory }: TabProps) {
  const stations = data.get<StationWire[]>("stationsLive");
  const status = data.get<StatusWire[]>("status");
  const shipments = data.get<ShipmentWire[]>("shipments");
  const times = data.get<AverageTimesWire[]>("timesShort");
  const jobs = data.get<JobsHealthPayload>("jobs");

  const ignored = describeIgnoredFilters(stations.meta.ignoredFilters);
  // No useMemo: the React Compiler memoises this, and a hand-written dependency
  // array on a value derived from `stations.data` is what it refuses to preserve.
  const columns = stationColumns({ rows: stations.data ?? [], full: false });

  const slices = status.data ?? [];
  const activeTotal = slices.reduce((sum, slice) => sum + slice.count, 0);
  const asOf = slices[0]?._new_asOf ?? null;

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
        title="עומס לפי עמדה · עכשיו"
        right={
          <>
            <Legend
              items={[
                { color: "var(--dash-ramp-1)", label: "בבדיקה" },
                { color: "var(--dash-ramp-4)", label: "בתור של סוג העמדה" },
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
          onRowClick={(row) =>
            openHistory({
              kind: "station",
              id: row.stationId,
              title: row.stationName,
              meta: row.stationTypeName ? `סוג ${row.stationTypeName}` : undefined,
              live: { oldestQueueAgeMinutes: row._new_oldestQueueAgeWallMinutes },
            })
          }
          empty={{
            text: "אין עמדות שמתאימות למסננים האלה.",
            action: { label: "נקה את המסננים", onClick: api.clearFilters },
          }}
        />
      </DataCard>

      <div className="dash-bottom" style={{ height: 230, flexShrink: 0, display: "flex", gap: 10 }}>
        <DataCard
          chart
          title="זמנים ממוצעים · 14 ימים"
          right={<Legend items={TIMES_LEGEND} />}
          error={times.error}
          style={{ flex: 1, minWidth: 0 }}
        >
          <ChartBody style={{ marginTop: 8 }}>
            {times.data && times.data.length > 0 ? (
              <TimesLineChart data={times.data} granularity="daily" />
            ) : (
              <EmptyChart loading={times.loading} />
            )}
          </ChartBody>
        </DataCard>

        <DataCard
          chart
          title="התפלגות סטטוסים"
          right={
            asOf ? (
              <span style={{ fontSize: 10.5, color: "var(--color-ink-muted-48)" }}>
                נכון ל-{formatClock(asOf)}
              </span>
            ) : null
          }
          error={status.error}
          style={{ width: 230, flexShrink: 0, padding: "12px 14px" }}
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
              total={activeTotal}
              centreLabel="פעילים"
              centreSize={16}
            />
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 5 }}>
              {slices.map((slice, index) => (
                <div
                  key={slice._new_stateKey}
                  style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5 }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: stateColor(slice._new_stateKey, index),
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
          title="משלוחים בסיכון"
          right={
            <button
              type="button"
              onClick={() => api.setTab("shipments")}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontFamily: "inherit",
                fontSize: 11.5,
                color: "var(--color-primary)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              הכל ←
            </button>
          }
          error={shipments.error}
          style={{ width: 250, flexShrink: 0, padding: "12px 14px" }}
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
            {atRisk.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--color-ink-muted-48)" }}>
                אין משלוחים פתוחים. יום שקט.
              </div>
            )}
            {atRisk.map((shipment) => {
              const tone = completionTone(shipment.completionPercentage);
              return (
                <button
                  key={shipment.shipmentId}
                  type="button"
                  onClick={() =>
                    openHistory({
                      kind: "shipment",
                      id: shipment.shipmentId,
                      title: shipment.shipmentCode,
                      meta: shipment.customerName,
                    })
                  }
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    textAlign: "start",
                    fontFamily: "inherit",
                    cursor: "pointer",
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      fontSize: 11.5,
                      gap: 8,
                    }}
                  >
                    <span style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {shipment.shipmentCode} · {shipment.customerName}
                    </span>
                    <span style={{ color: tone, fontWeight: 600, flexShrink: 0 }}>
                      {formatPercent(shipment.completionPercentage)}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 5,
                      background: "var(--color-canvas-parchment)",
                      borderRadius: 3,
                      marginTop: 4,
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "row-reverse",
                    }}
                  >
                    <div
                      style={{
                        width: `${shipment.completionPercentage ?? 0}%`,
                        background: tone,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </DataCard>
      </div>
    </div>
  );
}
