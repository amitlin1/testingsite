"use client";

// §16.5.1 — the one-line health form pinned above the overview station table.
//
// There is no notification channel on the isolated LAN, so a manager opening
// this page IS the alerting path. The strip therefore states its verdict in one
// colour and then spells out every reason: a red light nobody can act on is the
// same as no light.
//
// IT DOES NOT RE-DERIVE "RED". `/api/health/jobs` already applied
// evaluateHealth — jobs stale past twice their period, a short or missing
// calendar horizon, any zero-healthy check non-zero — and a second copy of
// those thresholds here is a copy that drifts from the endpoint an operator
// checks next. `healthy` and `reasons` come off the payload verbatim; the only
// constant imported is the calendar floor, from the same module the endpoint
// evaluates with.
//
// Last SUCCESS, never last run: a job that runs every five minutes and fails
// every time still has a fresh "last run".

import * as React from "react";

import { CheckCircle, Error as ErrorIcon } from "@/components/ui/icons";
import { formatDuration } from "@/app/lib/datetime";
import {
  ANOMALY_CHECKS,
  MIN_CALENDAR_HORIZON_DAYS,
  checkLabelHe,
  selfcheckValue,
  type JobsHealthPayload,
} from "@/app/lib/metrics/selfcheck";
import { formatClock } from "@/app/lib/dashboard/format";

interface Chip {
  text: string;
  tone: string;
}

export default function JobHealthStrip({
  payload,
  error,
  loading,
}: {
  payload: JobsHealthPayload | null;
  error: string | null;
  loading: boolean;
}) {
  if (loading && !payload && !error) {
    return (
      <div
        className="dash-card"
        style={{ flexShrink: 0, height: 39, borderRadius: 10, opacity: 0.6 }}
        aria-hidden
      />
    );
  }

  // A failed fetch is itself a red state — the app cannot reach its own health
  // endpoint — so it is surfaced, never swallowed into a stale green strip.
  const red = Boolean(error) || payload?.healthy === false;
  const colour = red ? "var(--color-destructive)" : "var(--color-status-approved)";

  const chips: Chip[] = [];
  if (error) {
    chips.push({ text: error, tone: "var(--color-destructive)" });
  } else if (payload) {
    for (const reason of payload.reasons) {
      chips.push({ text: reason, tone: "var(--color-destructive)" });
    }
    for (const job of payload.jobs) {
      chips.push({
        text:
          job.lastSuccessAt === null
            ? `${job.labelHe}: מעולם לא`
            : `${job.labelHe}: לפני ${formatDuration((job.secondsSinceSuccess ?? 0) * 1000, "short")}`,
        tone: job.stale ? "var(--color-destructive)" : "var(--color-ink-muted-80)",
      });
    }
    const horizon = selfcheckValue(payload.checks, "calendar_horizon_days");
    chips.push({
      text: horizon === null ? "לוח שנה: אין גרסה פעילה" : `לוח שנה: ${horizon} ימים קדימה`,
      tone:
        horizon === null || horizon < MIN_CALENDAR_HORIZON_DAYS
          ? "var(--color-destructive)"
          : "var(--color-ink-muted-80)",
    });
    const drift = selfcheckValue(payload.checks, "drift_open");
    chips.push({
      text: `רשומות פתוחות בסחיפה: ${drift ?? "—"}`,
      tone: (drift ?? 0) !== 0 ? "var(--color-destructive)" : "var(--color-ink-muted-80)",
    });
    // The zero-healthy checks, collapsed to a count while they are all zero and
    // named the moment one is not.
    const anomalies = payload.checks.filter(
      (c) => ANOMALY_CHECKS.includes(c.checkName) && c.checkName !== "drift_open" && (c.value ?? 0) !== 0,
    );
    chips.push(
      anomalies.length === 0
        ? { text: "בדיקות עקביות: 0", tone: "var(--color-ink-muted-80)" }
        : {
            text: anomalies
              .map((c) => `${checkLabelHe(c.checkName)}: ${c.value}`)
              .join(" · "),
            tone: "var(--color-destructive)",
          },
    );
  }

  return (
    <div
      className="dash-card"
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderRadius: 10,
        borderInlineStart: `3px solid ${colour}`,
        padding: "8px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          color: colour,
          fontSize: 13,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        <span className="dash-icon">
          {red ? <ErrorIcon fontSize={15} strokeWidth={2} /> : <CheckCircle fontSize={15} strokeWidth={2} />}
        </span>
        {red ? "נדרשת התערבות" : "כל המשימות תקינות"}
      </div>
      <div style={{ width: 1, height: 16, background: "var(--color-hairline)", flexShrink: 0 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
        {chips.map((chip) => (
          <span
            key={chip.text}
            style={{
              fontSize: 11.5,
              color: chip.tone,
              background: "var(--color-canvas-parchment)",
              borderRadius: 9999,
              padding: "3px 10px",
              whiteSpace: "nowrap",
            }}
          >
            {chip.text}
          </span>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      {payload && (
        <div style={{ fontSize: 11.5, color: "var(--color-ink-muted-48)", whiteSpace: "nowrap" }}>
          נבדק {formatClock(payload.generatedAt)}
        </div>
      )}
    </div>
  );
}
