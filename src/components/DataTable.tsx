"use client";
import * as React from "react";
import { Skeleton } from "@/components/ui";
import { TONE_DOT, type StatusTone } from "@/app/lib/status-tones";

/* =========================================================================
   DataTable — THE standard table for the app (Shifthouse look).
   Flat white card, parchment header, hairline dividers, row hover (var(--color-surface-pearl)),
   one Action Blue. Use this for every table so they all look identical.

   Styles: the shared .sh-table rules in components/ui/ui.css.

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
  /** Rows that have nothing to open (e.g. a sent shipment) — no pointer, no
      focus stop, no click. Defaults to every row when onRowClick is set. */
  rowClickable?: (row: T) => boolean;
  /** Highlight a row as selected (master-detail tables) — blue tint. */
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

export default function DataTable<T>({
  columns, rows, getRowKey, onRowClick, rowClickable, rowSelected, minWidth = 960,
  maxHeight, stickyHeader = maxHeight != null, loading = false, loadingRows = 8, empty, plain = false,
}: Props<T>) {
  const fill = maxHeight != null;
  const cardStyle: React.CSSProperties = plain
    ? { display: "flex", flexDirection: "column", height: maxHeight != null ? "100%" : undefined, maxHeight, overflow: "hidden" }
    : { background: "var(--color-canvas)", border: "1px solid var(--color-hairline)", borderRadius: "var(--r-card)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight };
  return (
    <div style={cardStyle}>
      <div className="shx-scroll" style={{ overflowX: "auto", overflowY: fill ? "auto" : undefined, flex: fill ? 1 : undefined, minHeight: fill ? 0 : undefined }}>
        <table className={"sh-table" + (stickyHeader ? " sh-table--sticky" : "")} style={{ minWidth }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width, textAlign: c.align ?? "start" }}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: loadingRows }).map((_, i) => (
                  <tr key={`sk-${i}`} aria-hidden>
                    {columns.map((c) => (
                      <td key={c.key}>
                        <Skeleton height={14} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, i) => {
                  // A clickable row is also a keyboard stop: Enter / Space opens it.
                  const clickable = !!onRowClick && (rowClickable ? rowClickable(row) : true);
                  return (
                  <tr
                    key={getRowKey(row, i)}
                    className={clickable ? "sh-row--clickable" : undefined}
                    aria-selected={rowSelected ? rowSelected(row) : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onRowClick!(row) : undefined}
                    onKeyDown={clickable ? (e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick!(row); }
                    } : undefined}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        style={{
                          textAlign: c.align ?? "start",
                          fontWeight: c.bold ? 600 : 400,
                          color: c.muted ? "var(--color-ink-muted-48)" : "var(--color-ink)",
                          fontVariantNumeric: c.nums ? "tabular-nums" : undefined,
                          whiteSpace: c.nowrap ? "nowrap" : undefined,
                        }}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && (
        <div style={{ textAlign: "center", padding: "56px 0", color: "var(--color-ink-muted-48)" }}>
          {empty ?? <div style={{ fontSize: 15 }}>לא נמצאו נתונים.</div>}
        </div>
      )}
    </div>
  );
}

/* Neutral status pill: ink text, the status shown by its dot. Pass `tone`
   (toneOfStatus) so every screen colours a status the same way; `active`
   is the older blue-or-grey switch. */
export function StatusPill({ label, active = false, tone }: { label: React.ReactNode; active?: boolean; tone?: StatusTone }) {
  const dot = tone ? TONE_DOT[tone] : active ? "var(--color-primary)" : "var(--color-ink-muted-48)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--color-ink)", background: "var(--color-canvas-parchment)", border: "1px solid var(--color-hairline)", borderRadius: 9999, padding: "4px 10px", whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
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
      <div style={{ flex: 1, height: 5, borderRadius: 9999, background: done ? "var(--color-primary-border)" : "var(--color-divider-soft)", overflow: "hidden", minWidth: 80 }}>
        <div style={{ height: "100%", width: `${pct === null ? 0 : Math.min(pct, 100)}%`, background: "var(--color-primary)", borderRadius: 9999 }} />
      </div>
      <span style={{ fontSize: 12, color: "var(--color-ink-muted-48)", fontVariantNumeric: "tabular-nums", minWidth: 30 }}>{text}</span>
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
      className={"sh-iconbtn sh-iconbtn--small" + (danger ? " sh-iconbtn--error" : "")}
    >
      {children}
    </button>
  );
}
