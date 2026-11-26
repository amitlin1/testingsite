"use client";
import * as React from "react";
import { Package } from "lucide-react";
import type { QueueRow } from "@/app/lib/testing/contract";
import { ClockInfoIcon } from "@/app/components/ClockInfo/ClockInfo";
import ItemRow, { ROW_COLUMNS } from "./ItemRow";

/** A shipment's sub-header in a customer's list: its name, what is past this station, and
 *  "רק המשלוח הזה". */
export type ListGroupHead = { title: string; meta: React.ReactNode; onOpen: () => void };
export type ListGroup = { key: string; head?: ListGroupHead; rows: readonly QueueRow[] };

/**
 * The open node's rows on one surface: the column header once, then each group (a customer's
 * shipments get a sub-header; a shipment or the whole queue is one group). Wide: it scrolls
 * sideways in its own box on a narrow screen instead of squeezing the columns.
 */
export default function QueueList({ groups, showPlace, rowProps, label }: {
  groups: readonly ListGroup[];
  /** "כל התור": every row says its customer and shipment. */
  showPlace: boolean;
  rowProps: (row: QueueRow) => { onBegin: (row: QueueRow) => void; starting: boolean; onStepBack?: () => void };
  label: string;
}) {
  return (
    <div className="tst-list">
      <div className="tst-list-scroll">
        <div className="tst-list-inner" aria-label={label} role="region">
          <div className="tst-cols tst-list-head">
            {ROW_COLUMNS.map((c, i) => (
              <div key={i} style={i === 3 ? { display: "inline-flex", alignItems: "center", gap: 4 } : undefined}>
                {c}
                {i === 3 && <ClockInfoIcon metric="testingTimer" />}
              </div>
            ))}
          </div>
          {groups.map((g) => (
            <React.Fragment key={g.key}>
              {g.head && (
                <div className="tst-group-head tst-line">
                  <Package size={20} strokeWidth={1.75} aria-hidden style={{ color: "var(--color-ink-muted-48)" }} />
                  <span className="tst-group-title">{g.head.title}</span>
                  <span className="tst-group-meta">{g.head.meta}</span>
                  <button type="button" className="tst-group-open" onClick={g.head.onOpen}>רק המשלוח הזה</button>
                </div>
              )}
              {g.rows.map((row) => (
                <div className="tst-line" key={row.item_id}>
                  <ItemRow item={row} showPlace={showPlace} {...rowProps(row)} />
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
