"use client";
import React from "react";
import type { RefMember } from "./packageReference";
import { AMBER_INK, BLUE, HAIR, MUTED } from "@/app/components/packages/packageUi";

/**
 * What the opening station shows of the package reference the box label
 * found (spec: ייחוס מארז §3): the box's contents against its members, and
 * above an item's scan the member expected for it.
 */

const PT_PRODUCT = "product";
const photosOf = (m: RefMember) => (m.imagesByType[PT_PRODUCT] ?? []).length;

/** Under the box scan: what should be in the box, by the package reference. */
export function ExpectedContents({ types, expectedOf, boxPhotos }: {
  types: { id: number; desc: string; count: number }[];
  expectedOf: (itemTypeId: number) => RefMember | null;
  boxPhotos: number;
}) {
  const withRef = types.filter((t) => expectedOf(t.id)).length;
  return (
    <div style={{ marginTop: 18, maxWidth: 720, border: `1px solid ${HAIR}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "11px 14px", background: "var(--color-canvas-parchment)", borderBottom: `1px solid ${HAIR}` }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>מה צריך להיות בקופסה, לפי ייחוס המארז</span>
        <span style={{ fontSize: 12.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
          {withRef} מתוך {types.length} פריטים עם ייחוס · {boxPhotos} תמונות אריזה
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th className="pkg-th" style={{ paddingInline: 14 }}>סוג פריט</th>
            <th className="pkg-th">פריט ייחוס</th>
            <th className="pkg-th">מק״ט</th>
            <th className="pkg-th">משקל</th>
            <th className="pkg-th">תמונות</th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => {
            const m = expectedOf(t.id);
            return (
              <tr key={t.id} style={{ borderTop: `1px solid ${HAIR}` }}>
                <td style={{ padding: "10px 14px", fontSize: 14, fontWeight: 600 }}>
                  {t.desc}{t.count > 1 && <span style={{ fontWeight: 400, color: MUTED }}> ×{t.count}</span>}
                </td>
                {m ? (
                  <>
                    <td style={{ padding: "10px 12px", fontSize: 13.5 }}>{m.name ?? "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 13.5 }}><bdi dir="ltr">{m.sku}</bdi></td>
                    <td style={{ padding: "10px 12px", fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>{m.refWeight != null ? `${m.refWeight} גר׳` : "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>{photosOf(m)}</td>
                  </>
                ) : (
                  <td colSpan={4} style={{ padding: "10px 12px", fontSize: 13, color: AMBER_INK }}>
                    אין לפריט הזה ייחוס בייחוס המארז. הוא יחפש ייחוס לפי הסריקה.
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Above an item's scan: the member its package reference expects. */
export function ExpectedReference({ member, kitFound }: { member: RefMember | null; kitFound: boolean }) {
  if (member) {
    return (
      <div style={{ marginTop: 20, maxWidth: 560, display: "flex", flexDirection: "column", gap: 2, padding: "11px 14px", background: "color-mix(in srgb, var(--color-primary) 5%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 15%, transparent)", borderRadius: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: BLUE }}>צפוי לפי ייחוס המארז</span>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{member.name ?? member.sku}</span>
        <span style={{ fontSize: 13, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
          מק״ט <bdi dir="ltr" style={{ color: "var(--color-ink)" }}>{member.sku}</bdi>
          {member.refWeight != null && <> · {member.refWeight} גר׳</>} · {photosOf(member)} תמונות ייחוס
        </span>
      </div>
    );
  }
  if (!kitFound) return null;
  return (
    <div style={{ marginTop: 20, maxWidth: 560, fontSize: 13, color: MUTED, background: "var(--color-canvas-parchment)", borderRadius: 10, padding: "9px 13px" }}>
      לפריט הזה אין ייחוס בייחוס המארז. הייחוס ייקבע לפי המק״ט שנסרק.
    </div>
  );
}
