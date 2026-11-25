import { ItemStatus } from "@/lib/item-status";

export type ItemProgress = {
  /** An item inside a box: its progress is the box's, so it shows none of its own. */
  inBox: boolean;
  /** 0–100; 100 once the route is done. */
  pct: number;
  /** "3/5", "5/5", "הושלם" (done without a route) or "—". */
  text: string;
};

/** How far along its route an item row is, as the item screens show it. */
export function itemProgress(row: {
  package_id?: number | string | null;
  current_status: number | null;
  is_finished: boolean | null;
  current_route_step: number | null;
  total_steps: number | null;
}): ItemProgress {
  if (row.package_id != null) return { inBox: true, pct: 0, text: "—" };
  const current = row.current_route_step || 0;
  const total = row.total_steps || 0;
  if (row.current_status === ItemStatus.Done || row.is_finished) {
    return { inBox: false, pct: 100, text: total > 0 ? `${total}/${total}` : "הושלם" };
  }
  if (total > 0) return { inBox: false, pct: Math.min((current / total) * 100, 100), text: `${current}/${total}` };
  return { inBox: false, pct: 0, text: "—" };
}
