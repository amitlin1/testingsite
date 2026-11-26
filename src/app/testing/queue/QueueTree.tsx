"use client";
import * as React from "react";
import { ChevronDown, ChevronLeft, List } from "lucide-react";
import { BUSINESS_TZ } from "@/lib/time/civil";
import { useNetSeconds } from "../clock";
import {
  customerLabel, shipmentLabel, waitLabel, type CustomerBranch, type QueueNode, type ShipmentBranch, type TreeSort,
} from "./treeModel";

/**
 * The tree beside the queue (design: מסך בדיקה — עיצוב מחדש כעץ, artboard Main): "כל התור", then
 * each customer with its shipments. A customer opens on a tap (and stays open while it is the
 * open node's); its shipments show what waits here and how much of the shipment is past this
 * station. Every row is a real button — on a touchscreen a 56–60px target.
 */
export default function QueueTree({ tree, node, total, sort, onSort, onPick, countNoun }: {
  tree: readonly CustomerBranch[];
  node: QueueNode;
  /** Rows of the whole queue on screen. */
  total: number;
  sort: TreeSort;
  onSort: (s: TreeSort) => void;
  onPick: (n: QueueNode) => void;
  /** "פריטים", or "מארזים" at an opening / closing station. */
  countNoun: string;
}) {
  const current = node.kind === "all" ? null : node.customer;
  // Customers opened by a tap, and the open node's customer closed by one. A new open node (a
  // scan, a breadcrumb, another customer) shows its own customer open and folds the rest: one
  // path open at a time keeps the tree short.
  const [opened, setOpened] = React.useState<ReadonlySet<string>>(() => new Set());
  const [collapsed, setCollapsed] = React.useState<string | null>(null);
  const [shownCurrent, setShownCurrent] = React.useState(current);
  if (shownCurrent !== current) {
    setShownCurrent(current);
    setOpened(new Set());
    setCollapsed(null);
  }
  const isOpen = (key: string) => (opened.has(key) || key === current) && collapsed !== key;

  // The open node stays in sight: a scan may open a shipment far down the tree.
  const currentRef = React.useRef<HTMLButtonElement>(null);
  const currentKey = node.kind === "all" ? "all" : node.kind === "customer" ? node.customer : `${node.customer}/${node.shipment}`;
  React.useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentKey]);

  const tapCustomer = (c: CustomerBranch) => {
    const selected = node.kind === "customer" && node.customer === c.key;
    if (selected && isOpen(c.key)) {
      setOpened((s) => without(s, c.key));
      setCollapsed(c.key);
      return;
    }
    setOpened((s) => new Set(s).add(c.key));
    setCollapsed(null);
    onPick({ kind: "customer", customer: c.key });
  };

  return (
    <nav className="tst-tree" aria-label="עץ התור: לקוחות ומשלוחים">
      <div className="tst-tree-head">
        <h2 className="tst-tree-title">תור העמדה</h2>
        <div className="tst-seg" role="group" aria-label="מיון הלקוחות">
          <button type="button" aria-pressed={sort === "wait"} onClick={() => onSort("wait")}>המתנה</button>
          <button type="button" aria-pressed={sort === "code"} onClick={() => onSort("code")}>קוד לקוח</button>
        </div>
      </div>

      <button type="button" className="tst-node tst-node--all" aria-current={node.kind === "all" ? "true" : undefined} onClick={() => onPick({ kind: "all" })}>
        <List size={20} strokeWidth={1.75} aria-hidden />
        <span className="tst-node-title" style={{ flex: 1 }}>כל התור</span>
        <span className="tst-count" aria-label={`${total} ${countNoun}`}>{total}</span>
      </button>

      {tree.length > 0 && <div className="tst-tree-label">לקוחות · {tree.length}</div>}

      <ul className="tst-tree-list">
        {tree.map((c) => {
          const open = isOpen(c.key);
          const groupId = `tst-ships-${c.key}`;
          return (
            <li key={c.key}>
              <button
                type="button"
                className="tst-node"
                aria-expanded={open}
                aria-controls={open ? groupId : undefined}
                aria-current={node.kind === "customer" && node.customer === c.key ? "true" : undefined}
                ref={node.kind === "customer" && node.customer === c.key ? currentRef : undefined}
                onClick={() => tapCustomer(c)}
              >
                {open ? <ChevronDown size={18} strokeWidth={1.75} aria-hidden className="tst-node-chevron" /> : <ChevronLeft size={18} strokeWidth={1.75} aria-hidden className="tst-node-chevron" />}
                <span className="tst-node-main">
                  <span className="tst-node-code">{customerLabel(c.code)}</span>
                  <span className="tst-node-sub">{c.shipments.length === 1 ? "משלוח אחד" : `${c.shipments.length} משלוחים`}</span>
                </span>
                <span className="tst-node-end">
                  <span className="tst-count">{c.count}</span>
                  <OldestWait start={c.oldestWaitStart} />
                </span>
              </button>
              {open && (
                <ul id={groupId} className="tst-tree-ships" aria-label={`המשלוחים של ${customerLabel(c.code)}`}>
                  {c.shipments.map((s) => (
                    <li key={s.key}>
                      <ShipmentNode
                        s={s}
                        buttonRef={node.kind === "shipment" && node.customer === c.key && node.shipment === s.key ? currentRef : undefined}
                        current={node.kind === "shipment" && node.customer === c.key && node.shipment === s.key}
                        onPick={() => onPick({ kind: "shipment", customer: c.key, shipment: s.key })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ShipmentNode({ s, current, onPick, buttonRef }: { s: ShipmentBranch; current: boolean; onPick: () => void; buttonRef?: React.Ref<HTMLButtonElement> }) {
  const p = s.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <button type="button" ref={buttonRef} className="tst-node tst-node--ship" aria-current={current ? "true" : undefined} onClick={onPick}>
      <span className="tst-node-main">
        <span className="tst-node-title">{shipmentLabel(s.code)}</span>
        <span className="tst-node-meta">
          {p?.receivedAt && <span>התקבל {dayMonth(p.receivedAt)}</span>}
          {p && p.total > 0 && (
            <>
              <span className="tst-progress" aria-hidden style={{ width: 72 }}><span style={{ width: `${pct}%` }} /></span>
              <span className="tst-num">{p.done}/{p.total} סיימו כאן</span>
            </>
          )}
        </span>
      </span>
      <span className="tst-count tst-count--light">{s.count}</span>
    </button>
  );
}

/** The customer's longest wait, net; its own clock, so a tick redraws this line only. */
function OldestWait({ start }: { start: string | null }) {
  const seconds = useNetSeconds(start);
  if (start == null) return <span className="tst-node-wait">אין ממתינים</span>;
  return <span className="tst-node-wait tst-num">הוותיק {seconds != null ? waitLabel(seconds) : "—"}</span>;
}

const DAY_MONTH = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", timeZone: BUSINESS_TZ });
/** "24.11" — the day the shipment came in, in the business timezone. */
const dayMonth = (iso: string) => DAY_MONTH.format(new Date(iso)).replace("/", ".");

function without(s: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(s);
  next.delete(key);
  return next;
}
