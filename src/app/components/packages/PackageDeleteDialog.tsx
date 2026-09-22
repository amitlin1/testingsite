"use client";
import React from "react";
import type { PackageView } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";
import { DIALOG_Z, HAIR, HAIR_2, INK, INK_2, MUTED, RED, SHADOW, fmtId, overlay, pillGhost, seq2 } from "./packageUi";

/**
 * מחיקת מארז — design/Packages.dc.html (deleteOpen). Lists the items that go
 * with the box; the red button names their count. DELETE /api/packages/[id]
 * with cascade (docs/packages/PLAN.md §4).
 */
export default function PackageDeleteDialog({
  open, pkg, onClose, onDeleted,
}: {
  open: boolean;
  pkg: PackageView | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) setError(null); }, [open]);
  if (!open || !pkg) return null;

  const count = pkg.items.length;
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const res = await apiFetch(`/api/packages/${pkg.item_id}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cascade: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || "מחיקת המארז נכשלה"); return; }
      onDeleted();
    } catch {
      setError("שגיאה בתקשורת");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={() => !busy && onClose()} style={{ ...overlay, zIndex: DIALOG_Z + 10 }}>
      <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{ width: "min(520px, 94vw)", background: "#fff", borderRadius: 18, boxShadow: SHADOW, overflow: "hidden", color: INK }}>
        <div style={{ padding: "22px 24px 0" }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>מחיקת מארז</div>
          <div style={{ fontSize: 14, color: INK_2, marginTop: 8, lineHeight: 1.55 }}>
            מחיקת המארז תמחק גם את {count} הפריטים שבו ואת היסטוריית הבדיקות שלהם. הפעולה אינה ניתנת לשחזור.
          </div>
        </div>
        <div style={{ margin: "16px 24px", border: `1px solid ${HAIR}`, borderRadius: 12, overflow: "hidden", maxHeight: 260, overflowY: "auto" }}>
          {pkg.items.map((it) => {
            const f = fmtId(it.item_id);
            return (
              <div key={it.item_id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", borderBottom: `1px solid ${HAIR_2}` }}>
                <span style={{ fontSize: 12.5, color: MUTED, fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "isolate" }}>
                  {f.head}<span style={{ fontWeight: 700, color: INK }}>{f.suffix || seq2(it.package_seq)}</span>
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{it.item_type_desc}</span>
                <span style={{ fontSize: 12.5, color: MUTED, marginInlineStart: "auto", fontVariantNumeric: "tabular-nums" }}>{it.serial_no ?? "ללא סריאלי"}</span>
              </div>
            );
          })}
        </div>
        {error && <div style={{ margin: "0 24px 12px", fontSize: 13, color: RED }}>{error}</div>}
        <div style={{ padding: "0 24px 22px", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...pillGhost, padding: "10px 18px" }}>ביטול</button>
          <button type="button" onClick={run} disabled={busy} style={{ background: RED, color: "#fff", border: 0, borderRadius: 9999, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: busy ? "wait" : "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1 }}>
            מחק מארז ו-{count} פריטים
          </button>
        </div>
      </div>
    </div>
  );
}
