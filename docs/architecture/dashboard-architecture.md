# Dashboard Metrics — Architecture (v2, ledger-only)

> Short architecture overview. The full spec (DDL, queries, stage-by-stage migration) is in
> [dashboard-migration-plan-v2.md](dashboard-migration-plan-v2.md).

## Why we are replacing the old system

The old dashboard kept **23 snapshot tables**, filled nightly by cron jobs. The core defect: the
snapshot functions had **no date parameter** — every run counted the *current* state of
`item_routes` and stored it under a *past* date. All "history" was N copies of the present.
Nothing is worth migrating; this is a clean rebuild.

## The core idea

Instead of photographing state before it gets overwritten, we **never lose state in the first
place**. Every state an item passes through becomes a row with a time range:

```
item_state_event  ──fold──►  item_state_interval  ──SQL──►  every dashboard number
(append-only log)            (one row per state occupancy,
                              with a time range)
```

- **`item_state_event`** — the source of truth. One immutable row per transition
  (created, test started, result submitted, sent to research, released, finished…).
  Written by the application **inside the same DB transaction** as the operational update, so an
  item can never advance without its transition being recorded. Duplicate submits are no-ops
  (idempotency keys). A DB trigger blocks UPDATE/DELETE — the log is append-only by construction.

- **`item_state_interval`** — the queryable form. One row per "item was in state X from T1 to T2",
  carrying station, worker (who started it / who ended it), all filter dimensions (customer,
  shipment, item type), and both duration clocks. Derived deterministically from the events —
  the entire table can be rebuilt from the log at any time, per item or in full.

- **The invariant is enforced by the database, not by code review:** a PostgreSQL exclusion
  constraint guarantees *an item is in exactly one state at any instant*. An overlapping or
  duplicate interval aborts the transaction instead of becoming a silent data bug.

## Two clocks on every duration

Every duration metric is reported **twice**, under two names that never substitute for each other:

| UI name | Meaning |
|---|---|
| **זמן המתנה / זמן טיפול** (wall) | Real elapsed time — what the customer experienced |
| **זמן המתנה בפועל / זמן טיפול בפועל** (work) | Only hours the lab was actually open, per the work-hours settings screen (weekly template + overrides + department holidays + Israeli holidays) |

Example: queued Thursday 15:00, picked up Sunday 07:10 → wall **64h10m**, work **45 min**.
The gap itself answers "how much of the delay was the calendar vs. us". Working time comes from a
versioned calendar table; a retroactively entered holiday recomputes affected past intervals
instead of silently reporting stale numbers.

## Reading: no cache, no aggregation layer

Every dashboard query reads the ledger directly. Three query families cover all ~90 metrics:

1. **Point-in-time** — "how many items were in queue at moment T": index lookup on the time range.
   A question the old system could not answer at all.
2. **Flow** — "how much was processed between A and B": aggregate closed intervals by close date.
3. **Duration** — averages/percentiles of wall and work seconds over closed intervals.

Long-trend charts (day/month/quarter grain) are a `GROUP BY` over the same rows — grain is a
query parameter, never a table suffix. The UI caps history views at 13 months ("all time" is an
explicit export).

**Why no cache:** measured on this project's own untuned Postgres against a synthetic year-3
ledger (3.3M rows), the heaviest UI query runs in **~1.3 s**; typical queries are 35–500 ms.
The originally planned hourly rollup layer concentrated 6 critical review findings and accelerated
queries that are already fast enough. It was cut. A **deferred contingency** exists: a single
daily-grain rollup table, refreshed by one idempotent nightly recompute — built only if measured
production p95 exceeds 2 s for a week.

## The tables (8 after stage 7; `metrics_drift` was the ninth and is dropped once the dual-run week is green)

| Group | Tables | Grows with |
|---|---|---|
| Core ledger | `route_run` (one pass of one item through a route), `item_state_event`, `item_state_interval` | traffic |
| State vocabulary | `metric_state` (6 rows: status keys + flags; replaces hardcoded 1–5 everywhere) | never |
| Work calendar | `work_calendar_version`, `work_span` (versioned working-time ladder) | ~300 rows/yr |
| Operations | `job_run` (cron audit), `metrics_schema_version` (deploy handshake) | tiny |

## Scheduled jobs: 3, none of them create data

The old snapshot crons were the *source* of history — a missed night was lost forever. In v2 no
job produces primary data; everything derives from the ledger written synchronously by the app.

| Job | Role | If it doesn't run |
|---|---|---|
| release-stale-tests (5 min, exists today) | safety net; now also emits events | unchanged behavior |
| rebuild-work-calendar (nightly + on settings change) | extends the calendar horizon | self-heals; nothing lost |
| metrics-selfcheck (nightly) | invariant checks + health report | lose monitoring, not data |

## Deployment safety (air-gapped, two machines)

- **Two releases:** Migration A is purely additive (new schema + backfill of current state,
  dual-run against the old live counters for a week). Migration B (dropping the 23 snapshot
  tables and old code) ships only after a green dual-run week. The system is never broken
  in between.
- A schema-version handshake makes the app refuse to start against a too-old database — a loud
  startup failure instead of broken test submissions on the lab floor.
- Full rebuild from the event log is the recovery story: one function call per item or for the
  whole ledger, validated by the exclusion constraint.

## What gets deleted

23 snapshot tables · materialized view + live-counter trigger · 4 snapshot crons ·
7 dead endpoints · 6 dead React components · `MetricsService` (~1,300 lines) —
in total **28 files / ~6,450 lines** plus a duplicated 1,600-line SQL tree.

## Status

| Stage | Content | Status |
|---|---|---|
| 0 | Correctness fixes + closing the open `/api/dashboard` auth gap (21 endpoints) | ✅ done 2026-08-24 |
| 1 | Dead-code demolition (17 files, zero references) | ✅ done 2026-08-24 |
| 2 | Migration A: new schema + work calendar + backfill script | ✅ done 2026-08-25 (dev; prod awaits USB trip) |
| 3 | Write path: 31 emission call sites | ✅ done 2026-08-25 |
| 4 | Backfill verification + dual-run week | ✅ written & smoke-tested; the dual-run WEEK runs in production |
| 5 | Read path: dashboard endpoints on the ledger, behind a parity harness | ✅ done 2026-08-28 |
| 6 | Rewrite 6 history dialogs | ✅ done 2026-08-31 |
| 7 | Migration B: destructive cleanup | ✅ written + applied on dev 2026-08-31; **production gated** on a green dual-run week |

Estimated effort: **25–33 working days** total.
