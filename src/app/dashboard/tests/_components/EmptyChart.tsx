"use client";

import * as React from "react";

import { Skeleton } from "@/components/ui";

/**
 * What a chart body shows when it has no series to draw. Three different
 * things, never confused: still loading (a skeleton at the chart's size, not a
 * "טוען" line), failed (the card's error band above carries the reason and the
 * retry; the body only says nothing was drawn), and a real empty window.
 */
export default function EmptyChart({ loading, failed = false }: { loading: boolean; failed?: boolean }) {
  if (loading) {
    return <Skeleton variant="rounded" width="100%" height="100%" style={{ minHeight: 120 }} />;
  }
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "var(--text-small)",
        color: "var(--color-ink-muted-48)",
        direction: "rtl",
      }}
    >
      {failed ? "הגרף לא נטען." : "לא נסגר דבר בטווח שנבחר, ולכן אין דליים להציג."}
    </div>
  );
}
