"use client";
import React from "react";
import NextLink from "next/link";
import type { PackageView } from "@/app/lib/packages/read";
import PackageIdText, { MiniItems, StatusPill } from "./PackageIdText";
import { BLUE, BLUE_SOFT, HAIR, HAIR_2, INK, ITEM_STATES, MUTED, PKG_STATUS, seq2 } from "./packageUi";

/**
 * "המארז שלי" — design/Items.dc.html (detail): the box an item belongs to,
 * at the top of the item dialog and the item history page. Tag + id + type +
 * status + link to the package page, the mini-items strip with "N/M סיימו",
 * and the siblings with the current one marked "הפריט הזה". An item without a
 * box never renders this (docs/packages/PLAN.md §9).
 */
export default function MyPackageCard({ pkg, currentItemId }: { pkg: PackageView; currentItemId: string | number }) {
  const status = PKG_STATUS[pkg.status];
  const me = String(currentItemId);
  const isBox = me === String(pkg.item_id);
  return (
    <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, background: "#fff", padding: "14px 16px", color: INK }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, background: BLUE_SOFT, color: BLUE, borderRadius: 9999, padding: "3px 9px" }}>מארז</span>
        <PackageIdText id={pkg.item_id} size={15} headColor={INK} weight={600} />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{pkg.item_type_desc}</span>
        <StatusPill label={status.label} dot={status.dot} />
        <NextLink href={`/packages/${pkg.item_id}`} style={{ marginInlineStart: "auto", fontSize: 13, fontWeight: 600, color: BLUE, textDecoration: "none", whiteSpace: "nowrap" }}>
          עמוד המארז ←
        </NextLink>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <MiniItems items={pkg.items.map((it) => ({ color: String(it.item_id) === me ? BLUE : ITEM_STATES[it.state].color, title: `${seq2(it.package_seq)} · ${it.item_type_desc} · ${it.state_label}` }))} />
        <span style={{ fontSize: 12.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{pkg.finished_count}/{pkg.items.length} סיימו</span>
      </div>
      <div style={{ border: `1px solid ${HAIR}`, borderRadius: 11, overflow: "hidden", marginTop: 12 }}>
        {pkg.items.map((it) => {
          const mine = String(it.item_id) === me;
          return (
            <NextLink key={it.item_id} href={`/items/${it.item_id}/history`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: `1px solid ${HAIR_2}`, background: mine ? "#f7fbff" : "#fff", color: "inherit", textDecoration: "none" }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: mine ? BLUE_SOFT : "#f5f5f7", color: mine ? BLUE : MUTED, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{seq2(it.package_seq)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{it.item_type_desc}</div>
                <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[it.makat, it.serial_no].filter(Boolean).join(" · ") || "—"}</div>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: mine ? BLUE : ITEM_STATES[it.state].color, whiteSpace: "nowrap" }}>{mine ? "הפריט הזה" : `${it.state_label}${it.station_name ? ` · ${it.station_name}` : ""}`}</span>
            </NextLink>
          );
        })}
      </div>
      {isBox && <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>רשומה זו היא הקופסה עצמה. הפריטים שבתוכה מפורטים למעלה.</div>}
    </div>
  );
}
