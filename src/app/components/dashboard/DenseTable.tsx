"use client";

// The one table every tab uses (§9): 11.5px header on the parchment, 13px
// cells, tabular numerals in every numeric column, a hairline between rows and
// the scroll on the body — never on the page.
//
// Sorting lives in this component's own state, so the 60s refresh replaces the
// ROWS underneath a sort that stays put (§12.10). Column dropping below 1300px
// is the `col-2nd` class on both the th and the td, never a filtered column
// array — that would renumber the sort indices as the window resized.

import * as React from "react";

import { Skeleton } from "@/components/ui";
import { ArrowDropDown } from "@/components/ui/icons";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** Numeric columns centre and get tabular numerals; text columns start. */
  numeric?: boolean;
  /** Dropped below 1300px (§15). */
  secondary?: boolean;
  width?: string;
  /** Omit to make the column unsortable. `null` sorts last in both directions. */
  sortValue?: (row: T) => number | string | null;
  render: (row: T) => React.ReactNode;
  cellStyle?: (row: T) => React.CSSProperties;
}

export interface DenseTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[] | null;
  rowKey: (row: T) => React.Key;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** §11: one observation and one action. No illustration, no emoji. */
  empty?: { text: string; action?: { label: string; onClick: () => void } };
  /** Rendered as the last row — a totals line. Columns that must never be
   *  summed (the shared type queue) simply pass nothing for their slot. */
  footer?: React.ReactNode;
  skeletonRows?: number;
}

export default function DenseTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  onRowClick,
  defaultSort,
  empty,
  footer,
  skeletonRows = 10,
}: DenseTableProps<T>) {
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(
    defaultSort ?? null,
  );

  const sorted = React.useMemo(() => {
    if (!rows) return null;
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      // A missing value is not a small value: it sorts last whichever way the
      // column is pointing, so "no answer" never masquerades as "worst".
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv), "he") * factor;
      }
      return (av - bv) * factor;
    });
  }, [rows, sort, columns]);

  const toggle = (column: Column<T>) => {
    if (!column.sortValue) return;
    setSort((s) =>
      s?.key === column.key
        ? { key: column.key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: column.key, dir: "desc" },
    );
  };

  return (
    <div className="dash-scroll">
      <table className="dash-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={[
                  column.secondary ? "col-2nd" : "",
                  column.sortValue ? "dash-sortable" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  textAlign: column.numeric ? "center" : "right",
                  ...(column.width ? { width: column.width } : null),
                }}
                onClick={() => toggle(column)}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 2,
                    justifyContent: column.numeric ? "center" : "flex-start",
                  }}
                >
                  {column.header}
                  {sort?.key === column.key && (
                    <ArrowDropDown
                      fontSize={12}
                      style={{ transform: sort.dir === "asc" ? "rotate(180deg)" : undefined }}
                    />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* First load only: skeletons at the real row height, so the layout
              never jumps when the numbers land (§11). */}
          {loading &&
            Array.from({ length: skeletonRows }).map((_, i) => (
              <tr key={`sk-${i}`}>
                {columns.map((column) => (
                  <td key={column.key} className={column.secondary ? "col-2nd" : undefined}>
                    <Skeleton variant="text" height={15} width={column.numeric ? "50%" : "80%"} />
                  </td>
                ))}
              </tr>
            ))}

          {!loading &&
            sorted?.map((row) => (
              <tr
                key={rowKey(row)}
                className={onRowClick ? "dash-row-click" : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={[column.secondary ? "col-2nd" : "", column.numeric ? "dash-num" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    style={column.cellStyle?.(row)}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}

          {!loading && sorted && sorted.length === 0 && empty && (
            <tr>
              <td colSpan={columns.length} style={{ padding: "36px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 13, color: "var(--color-ink-muted-48)" }}>{empty.text}</div>
                {empty.action && (
                  <button
                    type="button"
                    onClick={empty.action.onClick}
                    style={{
                      marginTop: 8,
                      background: "none",
                      border: "none",
                      padding: 0,
                      fontFamily: "inherit",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--color-primary)",
                      cursor: "pointer",
                    }}
                  >
                    {empty.action.label}
                  </button>
                )}
              </td>
            </tr>
          )}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}
