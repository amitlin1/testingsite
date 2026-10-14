"use client";
import * as React from "react";
import { Info } from "lucide-react";
import { sharedNoticeText } from "../../lib/labels";

/**
 * "משותף" (artboard 2, spec §5.5.2 א; decision 4): an item column's fields live on the ITEM's route,
 * so a route another kit also runs is edited for both — "השדות נשמרים במסלול {r} של {item} ומשמשים גם
 * ב: {kits}. שינוי כאן יחול בשניהם." role="note", tint / primary-border, radius 11, Info. Never on a
 * package-level step. The "צור מסלול נפרד למארז הזה" link (fork) joins in session 2e.
 */

export type SharedRouteNoticeProps = {
  routeNumber: number;
  /** The item type whose route it is ("מחשב"). */
  item: string;
  /** The other kits that run the route ("מארז מחשב"). */
  kits: readonly string[];
};

export function SharedRouteNotice({ routeNumber, item, kits }: SharedRouteNoticeProps) {
  return (
    <div role="note" className="sfe-notice">
      <Info size={18} strokeWidth={1.75} className="sfe-notice__icon" aria-hidden />
      <span className="sfe-notice__text">{sharedNoticeText(routeNumber, item, kits)}</span>
    </div>
  );
}

export default SharedRouteNotice;
