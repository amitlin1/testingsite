"use client";
import * as React from "react";

/* =========================================================================
   DataTable — THE standard table for the app (Shifthouse look).
   Flat white card, parchment header, hairline dividers, row hover (#fafafc),
   one Action Blue. Use this for every table so they all look identical.

   Requires: import "@/styles/shifthouse.css" once in the app (done in layout).

   How to make your table match the rest of the system:
     <DataTable
       rows={rows}
       getRowKey={(r) => r.id}
       onRowClick={(r) => openDetail(r)}      // optional — adds hover cursor
       loading={loading}                       // optional — shows skeletons
       columns={[
         { key: "name",   header: "שם",    cell: (r) => r.name, bold: true, nowrap: true },
         { key: "qty",    header: "כמות",  cell: (r) => r.qty, nums: true, align: "center" },
         { key: "status", header: "סטטוס", cell: (r) => <StatusPill label={r.status} active={r.isActive} /> },
         { key: "prog",   header: "התקדמות", width: 180, cell: (r) => <ProgressCell pct={p} text={t} /> },
         { key: "act",    header: "פעולות", align: "center", width: 120,
           cell: (r) => <RowActions><IconAction title="ערוך" onClick={() => edit(r)}><Pencil size={16}/></IconAction></RowActions> },
       ]}
     />

   Cell helpers exported here — use them so status/progress/actions look uniform:
     • <StatusPill label active/>       — neutral pill, blue dot = active, grey = other. Never green/orange.
     • <ProgressCell pct text/>         — single-blue bar; completion = full fill.
     • <RowActions><IconAction/></...>  — flat icon buttons for an actions column.
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
  /** Highlight a row as selected (master-detail tables) — blue tint + edge. */
  rowSelected?: (row: T) => boolean;
  minWidth?: number;
  /** Cap the body height and keep the header pinned (for long lists). */
  maxHeight?: number | string;
  stickyHeader?: boolean;
  loading?: boolean;
  loadingRows?: number;
  empty?: React.ReactNode;
  /** Render without the outer card (bg/border/radius) — for embedding inside
      an existing card/tile/dialog. The table look (header/rows) stays. */
  plain?: boolean;
};

const alignMap = { start: "right", center: "center", end: "left" } as const;

export default function DataTable<T>({
  columns, rows, getRowKey, onRowClick, rowSelected, minWidth = 960,
  maxHeight, stickyHeader = maxHeight != null, loading = false, loadingRows = 8, empty, plain = false,
}: Props<T>) {
  const fill = maxHeight != null;
  const cardStyle: React.CSSProperties = plain
    ? { display: "flex", flexDirection: "column", height: maxHeight != null ? "100%" : undefined, maxHeight, overflow: "hidden" }
    : { background: "#fff", border: "1px solid #e0e0e0", borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight };
  return (
    <div style={cardStyle}>
      <div className="shx-scroll" style={{ overflowX: "auto", overflowY: fill ? "auto" : undefined, flex: fill ? 1 : undefined, minHeight: fill ? 0 : undefined }}>
        <table className={"shx-table" + (stickyHeader ? " shx-table--sticky" : "")} style={{ minWidth }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={"shx-th" + (c.align === "center" ? " shx-th--center" : "")}
                  style={{ width: c.width, textAlign: c.align ? alignMap[c.align] : "right" }}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: loadingRows }).map((_, i) => (
                  <tr key={`sk-${i}`} className="shx-row">
                    {columns.map((c) => (
                      <td key={c.key} className="shx-td">
                        <span style={{ display: "block", height: 14, borderRadius: 5, background: "linear-gradient(90deg,#eee,#f5f5f7,#eee)", backgroundSize: "200% 100%", animation: "shx-shimmer 1.4s infinite" }} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, i) => (
                  <tr
                    key={getRowKey(row, i)}
                    className={"shx-row" + (onRowClick ? " shx-row--clickable" : "")}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    style={rowSelected?.(row) ? { background: "#f3f8ff", borderInlineStart: "3px solid #0066cc" } : undefined}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className="shx-td"
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
      {!loading && rows.length === 0 && (
        <div style={{ textAlign: "center", padding: "56px 0", color: "#7a7a7a" }}>
          {empty ?? <div style={{ fontSize: 15 }}>לא נמצאו נתונים.</div>}
        </div>
      )}
      <style>{`@keyframes shx-shimmer { 0% { background-position:200% 0; } 100% { background-position:-200% 0; } }`}</style>
    </div>
  );
}

/* Neutral status pill — dot is Action Blue for the active state, muted ink
   otherwise. Never green/orange (Shifthouse: one blue, status is cased). */
export function StatusPill({ label, active = false }: { label: React.ReactNode; active?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#1d1d1f", background: "#f5f5f7", border: "1px solid #e0e0e0", borderRadius: 9999, padding: "4px 10px", whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: active ? "#0066cc" : "#7a7a7a" }} />
      {label}
    </span>
  );
}

/* Single-blue progress. Completion is the fill reaching 100%, not a colour.
   `pct` accepts null: a ratio whose denominator is 0 has no percentage, and an
   empty bar is the honest drawing of that — never a bar drawn at 0%. */
export function ProgressCell({ pct, text }: { pct: number | null; text: string }) {
  const done = pct !== null && pct >= 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 5, borderRadius: 9999, background: done ? "#dbe9fb" : "#f0f0f0", overflow: "hidden", minWidth: 80 }}>
        <div style={{ height: "100%", width: `${pct === null ? 0 : Math.min(pct, 100)}%`, background: "#0066cc", borderRadius: 9999 }} />
      </div>
      <span style={{ fontSize: 12, color: "#7a7a7a", fontVariantNumeric: "tabular-nums", minWidth: 30 }}>{text}</span>
    </div>
  );
}

/* Row action buttons (edit / delete …) — flat icon buttons matching the app.
   Pass lucide icons. Use inside an align:"center" actions column. */
export function RowActions({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "center" }}>{children}</div>;
}

export function IconAction({ title, danger, disabled, onClick, children }: { title?: string; danger?: boolean; disabled?: boolean; onClick?: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick?.(e); }}
      className="shx-icon-btn"
      style={{ ...(danger ? { color: "#bf3535" } : {}), ...(disabled ? { opacity: 0.4, cursor: "not-allowed" } : {}) }}
    >
      {children}
    </button>
  );
}
