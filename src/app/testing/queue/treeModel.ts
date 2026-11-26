import type { QueueRow, ShipmentProgress } from "@/app/lib/testing/contract";
import { isWaitingStatus } from "@/lib/item-status";
import { orderQueue } from "./queueModel";

/**
 * The station queue as a tree — customer › shipment › rows — the way the items arrive on the
 * bench: which customers wait here, which of their shipments, and the rows of the node that is
 * open. Pure; the URL holds the open node (customer / shipment keys) and the scanned row.
 *
 * Customers are known by their code only (never the name: the name lives on the customers
 * settings page). A row with no customer or no shipment lands under NO_KEY.
 */

/** The key of a row with no customer / no shipment. */
export const NO_KEY = "none";

/** The open node: the whole queue, one customer, or one of its shipments. */
export type QueueNode =
  | { kind: "all" }
  | { kind: "customer"; customer: string }
  | { kind: "shipment"; customer: string; shipment: string };

export type TreeSort = "wait" | "code";

export type ShipmentBranch = {
  key: string;
  customerKey: string;
  code: string | null;
  /** Rows of the queue in it, and how many of them wait. */
  count: number;
  waiting: number;
  /** The queue start of its longest-waiting row (null: nothing waits). */
  oldestWaitStart: string | null;
  /** From /api/testing/shipment-progress; null when it has not answered (never a guess). */
  progress: ShipmentProgress | null;
};

export type CustomerBranch = {
  key: string;
  code: string | null;
  count: number;
  waiting: number;
  oldestWaitStart: string | null;
  shipments: ShipmentBranch[];
};

export const customerKeyOf = (it: Pick<QueueRow, "customer_id">) => (it.customer_id != null ? String(it.customer_id) : NO_KEY);
export const shipmentKeyOf = (it: Pick<QueueRow, "shipment_id">) => (it.shipment_id != null ? String(it.shipment_id) : NO_KEY);

/** The URL's customer / shipment keys as a node; a shipment without its customer is no node. */
export function nodeOf(customer: string, shipment: string): QueueNode {
  if (!customer) return { kind: "all" };
  if (!shipment) return { kind: "customer", customer };
  return { kind: "shipment", customer, shipment };
}

/** The node's keys for the URL. */
export function urlOfNode(node: QueueNode): { customer: string; shipment: string } {
  if (node.kind === "all") return { customer: "", shipment: "" };
  if (node.kind === "customer") return { customer: node.customer, shipment: "" };
  return { customer: node.customer, shipment: node.shipment };
}

/** The shipment node a row sits in. */
export const shipmentNodeOf = (it: QueueRow): QueueNode => ({ kind: "shipment", customer: customerKeyOf(it), shipment: shipmentKeyOf(it) });

const earlier = (a: string | null, b: string | null): string | null => {
  if (a == null) return b;
  if (b == null) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
};

/** Longest wait first; nothing waiting last; then by code. */
function byWait(a: { oldestWaitStart: string | null; code: string | null }, b: { oldestWaitStart: string | null; code: string | null }) {
  if (a.oldestWaitStart !== b.oldestWaitStart) {
    if (a.oldestWaitStart == null) return 1;
    if (b.oldestWaitStart == null) return -1;
    const d = new Date(a.oldestWaitStart).getTime() - new Date(b.oldestWaitStart).getTime();
    if (d !== 0) return d;
  }
  return byCode(a, b);
}

/** By code (numeric codes in number order); no code last. */
function byCode(a: { code: string | null }, b: { code: string | null }) {
  if (a.code == null || b.code == null) return a.code == null ? (b.code == null ? 0 : 1) : -1;
  return a.code.localeCompare(b.code, "he", { numeric: true });
}

/** Customers, each with its shipments, from the queue rows on screen. */
export function buildTree(items: readonly QueueRow[], progress: ReadonlyMap<number, ShipmentProgress>, sort: TreeSort): CustomerBranch[] {
  const customers = new Map<string, CustomerBranch>();
  const shipments = new Map<string, ShipmentBranch>();
  for (const it of items) {
    const ck = customerKeyOf(it);
    const sk = shipmentKeyOf(it);
    const waits = isWaitingStatus(it.current_status);
    const start = waits ? it.queue_start_time : null;

    let c = customers.get(ck);
    if (!c) {
      c = { key: ck, code: it.customer_code?.trim() || null, count: 0, waiting: 0, oldestWaitStart: null, shipments: [] };
      customers.set(ck, c);
    }
    c.count++;
    if (waits) c.waiting++;
    c.oldestWaitStart = earlier(c.oldestWaitStart, start);

    const id = `${ck}/${sk}`;
    let s = shipments.get(id);
    if (!s) {
      s = {
        key: sk, customerKey: ck, code: it.shipment_code?.trim() || null, count: 0, waiting: 0, oldestWaitStart: null,
        progress: it.shipment_id != null ? progress.get(it.shipment_id) ?? null : null,
      };
      shipments.set(id, s);
      c.shipments.push(s);
    }
    s.count++;
    if (waits) s.waiting++;
    s.oldestWaitStart = earlier(s.oldestWaitStart, start);
  }
  const order = sort === "wait" ? byWait : byCode;
  const tree = [...customers.values()].sort(order);
  for (const c of tree) c.shipments.sort(order);
  return tree;
}

/** The node still names a branch of the tree (a refresh may have emptied it). */
export function nodeInTree(tree: readonly CustomerBranch[], node: QueueNode): boolean {
  if (node.kind === "all") return true;
  const c = tree.find((x) => x.key === node.customer);
  if (!c) return false;
  return node.kind === "customer" || c.shipments.some((s) => s.key === node.shipment);
}

/** The node to show for the one asked: itself while the tree holds it; a shipment whose last row
 *  just left falls back to its customer, a customer that left to the whole queue. */
export function nearestNode(tree: readonly CustomerBranch[], node: QueueNode): QueueNode {
  if (nodeInTree(tree, node)) return node;
  if (node.kind === "shipment" && nodeInTree(tree, { kind: "customer", customer: node.customer })) return { kind: "customer", customer: node.customer };
  return { kind: "all" };
}

/** The node's rows, in queue order: waiting first (the longest wait first), then in test. */
export function rowsOfNode(items: readonly QueueRow[], node: QueueNode): QueueRow[] {
  const mine = node.kind === "all"
    ? items
    : items.filter((it) => customerKeyOf(it) === node.customer && (node.kind === "customer" || shipmentKeyOf(it) === node.shipment));
  return orderQueue(mine, { searching: true, highlightedItemId: null }).orderedItems;
}

/** The row "התחל את הבא" starts: the first waiting row of the node, in queue order. */
export const nextToStart = (ordered: readonly QueueRow[]): QueueRow | undefined => ordered.find((it) => isWaitingStatus(it.current_status));

/** A customer's label: "לקוח 410"; "ללא לקוח". */
export const customerLabel = (code: string | null) => (code ? `לקוח ${code}` : "ללא לקוח");
/** A shipment's label: "משלוח 7731"; "ללא משלוח". */
export const shipmentLabel = (code: string | null) => (code ? `משלוח ${code}` : "ללא משלוח");

/** A wait on the tree and the rows: "12 דק׳" under an hour, "1:24 שע׳" after — the box cards'
 *  unit. A queue waits minutes to hours; seconds ticking on every row are noise. */
export function waitLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}:${String(min).padStart(2, "0")} שע׳` : `${min} דק׳`;
}
