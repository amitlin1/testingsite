"use client";
import * as React from "react";
import { Typography, Box } from "@/components/ui";
import IdText from "@/app/components/IdText";
import type { PackageView } from "@/app/lib/packages/contract";
import { seq2 } from "@/app/lib/packages/ids";

/** "ממתין לפריטי המארז" above a closing station's queue: the boxes held before it, and where each
 *  missing item is. */
export default function BlockedPackagesBanner({ packages }: { packages: PackageView[] }) {
  return (
    <Box role="status" sx={{ mb: "18px", border: "1px solid var(--color-warning-border)", bgcolor: "var(--color-warning-bg)", borderRadius: "var(--r-md)", padding: "14px 18px" }}>
      <Typography sx={{ fontSize: "var(--text-body)", fontWeight: 700, color: "var(--color-warning-ink)" }}>
        {packages.length === 1 ? "מארז אחד ממתין לפריטים לפני הסגירה" : `${packages.length} מארזים ממתינים לפריטים לפני הסגירה`}
      </Typography>
      <Typography sx={{ fontSize: "var(--text-small)", color: "var(--color-warning-ink)", mt: "2px" }}>
        המארז ייכנס לתור כשכל הפריטים שלו יסיימו את המסלול. הפריטים החסרים ומיקומם:
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: "8px", mt: "12px" }}>
        {packages.map((p) => (
          <Box key={p.item_id} sx={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", bgcolor: "var(--color-canvas)", border: "1px solid var(--color-warning-border)", borderRadius: "var(--r-sm)", padding: "9px 12px" }}>
            <IdText id={p.item_id} size={14} headColor="var(--color-ink)" />
            <Typography sx={{ fontSize: "var(--text-small)", fontWeight: 600, color: "var(--color-ink)" }}>{p.item_type_desc}</Typography>
            <Typography sx={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>{p.customer_name ?? p.customer_code ?? ""}</Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginInlineStart: "auto" }}>
              {p.blocked_by.map((b) => (
                <Box key={b.item_id} sx={{ fontSize: "var(--text-fine)", color: "var(--color-warning-ink)", bgcolor: "var(--color-warning-bg)", border: "1px solid var(--color-warning-border)", borderRadius: "var(--r-pill)", padding: "3px 10px", whiteSpace: "nowrap" }}>
                  {seq2(b.package_seq)} · {b.item_type_desc} · {b.station_name ?? "במסלול"}
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
