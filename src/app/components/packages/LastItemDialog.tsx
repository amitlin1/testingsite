"use client";
import React from "react";
import { Trash2, Replace } from "lucide-react";
import { DialogTitle } from "@/components/ui";
import { PackageDialog } from "./PackageDialog";
import { HAIR, INK_2, MUTED, seq2 } from "./packageUi";

/**
 * אי אפשר להסיר את הפריט האחרון — design/Package Dialogs.dc.html ("last").
 * A worded refusal with two ways out, not a red error. Opens over the edit
 * dialog (mounted after it, so it stacks above).
 */
export default function LastItemDialog({
  open, onClose, item, onDeletePackage,
}: {
  open: boolean;
  onClose: () => void;
  item: { package_seq: number | null; item_type_desc: string } | null;
  onDeletePackage: () => void;
}) {
  if (!open || !item) return null;
  const options = [
    { icon: <Trash2 size={16} strokeWidth={1.75} aria-hidden />, title: "מחק את המארז כולו", note: "המארז וכל הפריטים שבו יימחקו, כולל היסטוריית הבדיקות." },
    { icon: <Replace size={16} strokeWidth={1.75} aria-hidden />, title: "החלף את הפריט", note: "הוסף קודם את הפריט החדש, ואז הסר את הפריט הזה." },
  ];
  return (
    <PackageDialog open onClose={onClose} width="min(520px, 94vw)" draggable={false}>
      <div style={{ padding: "22px 24px 0" }}>
        <DialogTitle style={{ padding: 0, display: "block" }}>אי אפשר להסיר את הפריט האחרון</DialogTitle>
        <div style={{ fontSize: 14, color: INK_2, marginTop: 9, lineHeight: 1.55 }}>
          <span style={{ fontWeight: 600 }}>{seq2(item.package_seq)} · {item.item_type_desc}</span> הוא הפריט היחיד שנותר במארז. מארז חייב להכיל פריט אחד לפחות, ולכן ההסרה נדחתה.
        </div>
      </div>
      <div style={{ margin: "18px 24px 0", border: `1px solid ${HAIR}`, borderRadius: 14, padding: "15px 16px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>מה אפשר לעשות במקום</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 12 }}>
          {options.map((o) => (
            <div key={o.title} style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
              <span style={{ color: MUTED, marginTop: 1, display: "inline-flex" }}>{o.icon}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{o.title}</div>
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2, lineHeight: 1.45 }}>{o.note}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: "18px 24px 22px", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} className="pkg-pill pkg-pill--ghost" style={{ padding: "11px 20px" }}>הבנתי</button>
        <button type="button" onClick={onDeletePackage} className="pkg-pill pkg-pill--ghost pkg-pill--danger-text" style={{ padding: "11px 20px" }}>מחק את המארז</button>
      </div>
    </PackageDialog>
  );
}
