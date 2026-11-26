"use client";
import * as React from "react";
import { Typography, Box } from "@/components/ui";
import {
  AccessTime as AccessTimeIcon,
  Check as CheckIcon,
  Queue as QueueIcon,
  Science as ScienceIcon,
} from "@/components/ui/icons";
import { useNetSeconds } from "../clock";

/** "HH:MM" — the longest wait, without the seconds. */
const hoursMinutesText = (seconds: number): string =>
  `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;

function SummaryTile({
  icon,
  iconBg,
  iconColor,
  value,
  label,
  valueColor = "var(--color-ink)",
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  value: React.ReactNode;
  label: string;
  valueColor?: string;
}) {
  return (
    <Box sx={{ bgcolor: "var(--color-canvas)", border: "1px solid var(--color-hairline)", borderRadius: "var(--r-card)", padding: "16px 18px", display: "flex", alignItems: "center", gap: "14px" }}>
      <Box aria-hidden sx={{ width: 44, height: 44, flexShrink: 0, borderRadius: "var(--r-md)", bgcolor: iconBg, color: iconColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: "var(--text-kpi)", fontWeight: 700, letterSpacing: "var(--ls-display)", lineHeight: 1, color: valueColor, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </Typography>
        <Typography sx={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)", mt: "5px" }}>{label}</Typography>
      </Box>
    </Box>
  );
}

/** The station overview above the queue. It owns the longest-wait clock, so its tick redraws this
 *  strip only. `stale`: the numbers belong to another station yet — "—". */
export default function SummaryStrip({ stale, waiting, inTest, completedToday, longestWaitStart }: {
  stale: boolean;
  waiting: number;
  inTest: number;
  completedToday: number | null;
  longestWaitStart: string | null;
}) {
  const longestWait = useNetSeconds(longestWaitStart);
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "14px", mb: "22px" }}>
      <SummaryTile
        icon={<QueueIcon sx={{ fontSize: 21 }} />}
        iconBg="var(--color-warning-bg)"
        iconColor="var(--color-status-late)"
        value={stale ? "—" : waiting}
        label="בתור"
      />
      <SummaryTile
        icon={<ScienceIcon sx={{ fontSize: 21 }} />}
        iconBg="var(--color-primary-soft)"
        iconColor="var(--color-primary)"
        value={stale ? "—" : inTest}
        label="בבדיקה"
      />
      <SummaryTile
        icon={<CheckIcon sx={{ fontSize: 21 }} />}
        iconBg="var(--color-success-bg)"
        iconColor="var(--color-status-approved)"
        value={completedToday ?? "—"}
        label="הושלמו היום"
      />
      <SummaryTile
        icon={<AccessTimeIcon sx={{ fontSize: 21 }} />}
        iconBg="var(--color-warning-bg)"
        iconColor="var(--color-status-late)"
        value={!stale && longestWait != null ? hoursMinutesText(longestWait) : "—"}
        label="המתנה הארוכה ביותר · נטו"
        valueColor="var(--color-warning-ink)"
      />
    </Box>
  );
}
