"use client";
import * as React from "react";

/* =========================================================================
   DataTable — the Shifthouse table look, reusable across the app.
   Parchment header (the correct <th> design), hairline row dividers, and the
   row hover that was missing (#fafafc). Flat, RTL, one Action Blue.

   Requires: import "@/styles/shifthouse.css" once in the app.

   Example:
     <DataTable
       columns={[
         { key: "serial", header: "סריאלי", cell: (r) => r.serial, bold: true },
         { key: "status", header: "סטטוס", cell: (r) => <StatusPill .../> },
       ]}
       rows={rows}
       getRowKey={(r) => r.id}
       onRowClick={(r) => openDetail(r)}
       minWidth={960}
     />
   ========================================================================= */

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "start" | "center" | "end";
  width?: number;
  bold?: boolean;
  muted?: boolean;
  nums?: boolean;      // tabular-nums
  nowrap?: boolean;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T, i: number) => React.Key;
  onRowClick?: (row: T) => void;
  minWidth?: number;
  empty?: React.ReactNode;
};

const alignMap = { start: "right", center: "center", end: "left" } as const;

export default function DataTable<T>({ columns, rows, getRowKey, onRowClick, minWidth = 960, empty }: Props<T>) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 16, overflow: "hidden" }}>
      <div className="sh-scroll" style={{ overflowX: "auto" }}>
        <table className="sh-table" style={{ minWidth }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={"sh-th" + (c.align === "center" ? " sh-th--center" : "")}
                  style={{
                    width: c.width,
                    textAlign: c.align ? alignMap[c.align] : "right",
                  }}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={getRowKey(row, i)}
                className={"sh-row" + (onRowClick ? " sh-row--clickable" : "")}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className="sh-td"
                    style={{
                      textAlign: c.align ? alignMap[c.align] : "right",
                      fontWeight: c.bold ? 600 : 400,
                      color: c.muted ? "#7a7a7a" : "#1d1d1f",
                      fontVariantNumeric: c.nums ? "tabular-nums" : undefined,
                      whiteSpace: c.nowrap ? "nowrap" : undefined,
                    }}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <div style={{ textAlign: "center", padding: "56px 0", color: "#7a7a7a" }}>
          {empty ?? <div style={{ fontSize: 15 }}>לא נמצאו פריטים תואמים.</div>}
        </div>
      )}
    </div>
  );
}

/* Neutral status pill — dot is Action Blue for the active state, muted ink
   otherwise. Never green/orange (Shifthouse: one blue, status is cased). */
export function StatusPill({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#1d1d1f", background: "#f5f5f7", border: "1px solid #e0e0e0", borderRadius: 9999, padding: "4px 10px", whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: active ? "#0066cc" : "#7a7a7a" }} />
      {label}
    </span>
  );
}

/* Single-blue progress. Completion is the fill reaching 100%, not a colour. */
export function ProgressCell({ pct, text }: { pct: number; text: string }) {
  const done = pct >= 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 5, borderRadius: 9999, background: done ? "#dbe9fb" : "#f0f0f0", overflow: "hidden", minWidth: 80 }}>
        <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: "#0066cc", borderRadius: 9999 }} />
      </div>
      <span style={{ fontSize: 12, color: "#7a7a7a", fontVariantNumeric: "tabular-nums", minWidth: 30 }}>{text}</span>
    </div>
  );
}
