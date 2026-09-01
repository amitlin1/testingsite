"use client";
import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import { Box, Typography, Skeleton, Chip, IconButton, Tooltip } from "@/components/ui";
import { CheckCircle, Error as ErrorIcon, Refresh } from "@/components/ui/icons";
import { formatDateTime, formatDuration } from "@/app/lib/datetime";
import DashboardCard from "@/app/components/dashboard/DashboardCard";
import {
  ANOMALY_CHECKS,
  checkLabelHe,
  type JobsHealthPayload,
} from "@/app/lib/metrics/selfcheck";

/**
 * The §10.2 health tile — the ONLY alarm this deployment has.
 *
 * There is no Prometheus and no notification channel on the isolated LAN, so a
 * manager opening the dashboard is the alerting path. The tile therefore states
 * its verdict in one colour at the top and spells out every reason underneath:
 * a red light nobody can act on is the same as no light.
 *
 * It does NOT re-derive "red" — /api/health/jobs already applied evaluateHealth
 * (jobs stale past 2× their period, drift_open > 0, calendar_horizon_days < 30,
 * any zero-healthy check non-zero). A second copy of those thresholds here is a
 * copy that drifts from the endpoint an operator checks next.
 */

/** Poll period. The fastest job runs every 5 minutes; a minute is plenty. */
const REFRESH_MS = 60_000;

const RED = "#D32F2F";
const GREEN = "#2E7D32";

function relativeAge(iso: string | null, seconds: number | null): string {
  if (!iso) return "מעולם לא";
  const ago = seconds === null ? "" : ` (לפני ${formatDuration(seconds * 1000, "short")})`;
  return `${formatDateTime(iso)}${ago}`;
}

export default function JobHealthTile() {
  const [data, setData] = React.useState<JobsHealthPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch("/api/health/jobs");
      if (!res.ok) {
        setError(`שגיאה בטעינת מצב המשימות (${res.status})`);
        return;
      }
      setData(await res.json());
      setError(null);
    } catch {
      // A failed fetch is itself a red state — the app cannot reach its own
      // health endpoint — so it is surfaced, never swallowed into a stale tile.
      setError("אין תקשורת עם שרת המדדים");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) {
    return (
      <DashboardCard title="תקינות המשימות המתוזמנות">
        <Box sx={{ p: 2 }}>
          <Skeleton variant="text" width="45%" height={28} sx={{ mb: 1.5, ml: "auto" }} />
          <Skeleton variant="rectangular" height={120} />
        </Box>
      </DashboardCard>
    );
  }

  const red = !!error || !data?.healthy;
  const color = red ? RED : GREEN;
  const reasons = error ? [error] : (data?.reasons ?? []);
  const anomalyChecks = (data?.checks ?? []).filter((c) => ANOMALY_CHECKS.includes(c.checkName));

  return (
    <DashboardCard
      title="תקינות המשימות המתוזמנות"
      action={
        <Tooltip title="רענון">
          <IconButton size="small" onClick={load} aria-label="רענון מצב המשימות">
            <Refresh />
          </IconButton>
        </Tooltip>
      }
    >
      <Box sx={{ p: 2, direction: "rtl" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            p: 1.5,
            mb: 2,
            borderRadius: 2,
            border: "1px solid",
            borderColor: color,
            bgcolor: `${color}12`,
            color,
          }}
        >
          {red ? <ErrorIcon /> : <CheckCircle />}
          <Typography variant="subtitle1" fontWeight={700}>
            {red ? "נדרשת התערבות" : "כל המשימות תקינות"}
          </Typography>
        </Box>

        {reasons.length > 0 && (
          <Box component="ul" sx={{ m: 0, mb: 2, pr: 3, display: "flex", flexDirection: "column", gap: 0.5 }}>
            {reasons.map((reason) => (
              <Typography key={reason} component="li" variant="body2" sx={{ color: RED }}>
                {reason}
              </Typography>
            ))}
          </Box>
        )}

        {/* Last SUCCESS, not last run: a job that runs every 5 minutes and fails
            every time still has a fresh "last run". */}
        {(data?.jobs ?? []).map((job) => (
          <Box
            key={job.jobName}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              py: 1,
              borderTop: "1px solid",
              borderColor: "divider",
            }}
          >
            <Box>
              <Typography variant="body2" fontWeight={600}>
                {job.labelHe}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                הצלחה אחרונה: {relativeAge(job.lastSuccessAt, job.secondsSinceSuccess)}
              </Typography>
              {job.lastErrorText && (
                <Typography variant="caption" sx={{ display: "block", color: RED }}>
                  {job.lastErrorText}
                </Typography>
              )}
            </Box>
            <Chip
              size="small"
              label={job.stale ? "מפגר" : (job.lastRunStatus ?? "—")}
              sx={{
                bgcolor: job.stale ? `${RED}18` : `${GREEN}18`,
                color: job.stale ? RED : GREEN,
                fontWeight: 600,
              }}
            />
          </Box>
        ))}

        {anomalyChecks.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={700}>
              בדיקות עקביות (הערך התקין הוא 0)
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 0.75 }}>
              {anomalyChecks.map((check) => {
                const bad = (check.value ?? 0) !== 0;
                return (
                  <Chip
                    key={check.checkName}
                    size="small"
                    label={`${checkLabelHe(check.checkName)}: ${check.value ?? "—"}`}
                    sx={{
                      bgcolor: bad ? `${RED}18` : undefined,
                      color: bad ? RED : "text.secondary",
                      fontWeight: bad ? 700 : 400,
                    }}
                  />
                );
              })}
            </Box>
          </Box>
        )}

        {data && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
            נבדק: {formatDateTime(data.generatedAt)}
          </Typography>
        )}
      </Box>
    </DashboardCard>
  );
}
