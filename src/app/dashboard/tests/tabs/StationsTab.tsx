"use client";

// §8.3 — the live station board.
//
// Two things about this screen are not cosmetic:
//
//  - THE LIVE HALF CARRIES NO FILTER BLOCK. Q3 is the state of the LAB, not of
//    one customer's slice, so a customer / shipment / item-type / worker /
//    serial filter cannot be honoured against the counts inside a row. The
//    route names them in `X-Metrics-Ignored-Filters` and this card shows that
//    as the amber pill. A silently dropped filter is the failure class the
//    metrics rewrite exists to kill.
//  - `בתור (סוג)` HAS NO TOTAL. The column repeats one number across the rows
//    of a station type, so a footer sum would be a multiple of the truth. The
//    table therefore renders no total row at all, and the note says why.

import * as React from "react";

import DataCard, { IgnoredFiltersPill } from "@/app/components/dashboard/DataCard";
import DenseTable from "@/app/components/dashboard/DenseTable";
import type { StationWire } from "@/app/lib/dashboard/api-types";
import { describeIgnoredFilters } from "@/app/lib/dashboard/format";
import { SHARED_QUEUE_NOTE, stationColumns } from "./stationColumns";
import type { TabProps } from "./tabTypes";

export default function StationsTab({ api, data, openHistory }: TabProps) {
  const live = data.get<StationWire[]>("stationsLive");
  const prev = data.get<StationWire[]>("stationsPrev");
  const ignored = describeIgnoredFilters(live.meta.ignoredFilters);

  // No useMemo: the React Compiler memoises this on its own inferred deps.
  const columns = stationColumns({
    rows: live.data ?? [],
    previous: prev.data,
    previousPending: prev.loading,
    full: true,
  });

  return (
    <DataCard
      panel
      title="עומס וניצולת לפי עמדה"
      right={
        <>
          <span style={{ fontSize: 11.5, color: "var(--color-ink-muted-48)" }}>
            שעות עבודה נטו בתקופה · שעות הפעילות אינן נחשפות בשירות ולכן לא מוצג אחוז ניצולת
          </span>
          {ignored && <IgnoredFiltersPill text={ignored.text} />}
        </>
      }
      note={SHARED_QUEUE_NOTE}
      error={live.error}
      onRetry={data.refresh}
      style={{ flex: 1, minHeight: 0 }}
    >
      <DenseTable
        columns={columns}
        rows={live.data}
        rowKey={(row) => row.stationId}
        loading={live.loading}
        defaultSort={{ key: "queue", dir: "desc" }}
        // A row click opens the station's history; the overlay's own CTA is the
        // route into the slow-items tab for that station.
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
  );
}
