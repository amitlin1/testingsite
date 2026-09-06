"use client";

// §8.7 — the state of the floor at one instant, and how it moved.
//
// `הסתיים` IS NOT A SLICE, and the card says so in words. A terminal interval
// stays open forever, so counting it makes the donut a grey 99% circle and
// scans all of history to get there. The cumulative finished count is closed
// route_runs — a different metric, from a different query, on a different
// scale — and it is not smuggled onto this chart.
//
// THE INSTANT PROBED IS THE END OF THE SELECTED WINDOW. That is what finally
// makes the date picker mean something here: "what did the floor look like at
// the end of last Tuesday" is answerable. `_new_asOf` is stamped by the server
// and shown, so a screenshot can be dated.
//
// Labels come from `metric_state.label_he` on the wire — never a hardcoded
// status-names map — and `סטטוס לא ממופה` keeps its own amber slice.

import * as React from "react";

import DataCard from "@/app/components/dashboard/DataCard";
import StatusDonut, { stateColor } from "@/app/components/dashboard/charts/StatusDonut";
import StatusTrendChart from "@/app/components/dashboard/charts/StatusTrendChart";
import { ChartBody } from "@/app/components/dashboard/charts/chartConfig";
import type { StatusHistoryWire, StatusWire } from "@/app/lib/dashboard/api-types";
import { formatClock, formatCount, formatPercent } from "@/app/lib/dashboard/format";
import { EmptyChart } from "./TimesTab";
import type { TabProps } from "./tabTypes";

export const DONUT_NOTE =
  "״הסתיים״ אינו פלח בעוגה — פריט שהסתיים נמדד כמצטבר של מסלולים שנסגרו, מטריקה נפרדת";

export default function StatusTab({ data }: TabProps) {
  const status = data.get<StatusWire[]>("status");
  const history = data.get<StatusHistoryWire[]>("statusHistory");

  const slices = status.data ?? [];
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const asOf = slices[0]?._new_asOf ?? null;

  return (
    <div className="dash-bottom" style={{ flex: 1, minHeight: 0, display: "flex", gap: 10 }}>
      <DataCard
        chart
        error={status.error}
        onRetry={data.refresh}
        style={{
          width: 320,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: "14px 16px",
        }}
      >
        <StatusDonut data={slices} size={184} total={total} centreLabel="פריטים פעילים" />
        <div
          style={{
            fontSize: 11.5,
            color: "var(--color-ink-muted-48)",
            textAlign: "center",
            maxWidth: 260,
            textWrap: "pretty",
          }}
        >
          {DONUT_NOTE}
        </div>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 9 }}>
          {slices.map((slice, index) => (
            <div
              key={slice._new_stateKey}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: stateColor(slice._new_stateKey, index),
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{slice.statusName}</span>
              <span style={{ color: "var(--color-ink-muted-48)", fontVariantNumeric: "tabular-nums" }}>
                {formatCount(slice.count)}
              </span>
              <span style={{ fontWeight: 600, width: 46, textAlign: "start", fontVariantNumeric: "tabular-nums" }}>
                {formatPercent(slice.percentage, 1)}
              </span>
            </div>
          ))}
          {asOf && (
            <div style={{ fontSize: 11, color: "var(--color-ink-muted-48)", textAlign: "center" }}>
              נכון ל-{formatClock(asOf)}
            </div>
          )}
        </div>
      </DataCard>

      <DataCard
        chart
        title="מגמת סטטוסים · 14 ימים"
        right={
          <span style={{ fontSize: 11.5, color: "var(--color-ink-muted-48)" }}>
            כל עמודה = הפריטים הפעילים בסוף היום · ללא ״הסתיים״
          </span>
        }
        error={history.error}
        onRetry={data.refresh}
        style={{ flex: 1, minWidth: 0 }}
      >
        <ChartBody style={{ marginTop: 12 }}>
          {history.data && history.data.length > 0 ? (
            <StatusTrendChart data={history.data} />
          ) : (
            <EmptyChart loading={history.loading} />
          )}
        </ChartBody>
      </DataCard>
    </div>
  );
}
