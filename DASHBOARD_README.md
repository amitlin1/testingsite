# Dashboard & Analytics Architecture

This document explains the architecture of the Dashboard system, including data flow, metric calculations, and historical data handling.

## 1. Core Principles: The `MetricsService`

The heart of the dashboard is the **`MetricsService`** (`src/app/lib/dashboard/metrics-service.ts`).

- **Single Source of Truth**: All metric calculations (Processing Times, Item Statuses, Station Loads) happen here.
- **No Duplicate Logic**: Both the frontend APIs (for live data) and the backend Cron Jobs (for history snapshots) call this same service.
- **Consolidated Queries**: Instead of 50 scattered SQL queries, we have centralized, optimized queries in one place.

## 2. Data Flow: Live vs. Historical

The dashboard displays data in two modes:

### A. Live Data (Real-Time)

- **Used In**: Current Status, Work In Progress (WIP), "Today" views.
- **Source**: Direct queries to transactional tables (`items`, `item_routes`, `test_stations`).
- **Implementation**: `MetricsService` calculates this on-the-fly.

### B. Historical Data (Trends & Analysis)

- **Used In**: Daily Trends, History Graphs (Last 30 Days, 12 Months, 3 Years).
- **Source**: **Snapshot Tables** (`_snapshots`).
- **Why?**: Querying millions of historical rows in real-time is too slow. Snapshots pre-calculate the daily stats.

## 3. The Snapshot System (Cron Jobs)

We have automated jobs that run every night to "freeze" the day's stats into history.

- **Daily Snapshots** (`api/cron/create-daily-snapshots`)
  - Runs nightly.
  - Calculates stats for **Yesterday** (to capture the full day).
  - Uses `UPSERT` logic (safe to re-run without creating duplicates).
  - Populates: `shipment_snapshots`, `customer_snapshots`, `station_snapshots`, `item_type_snapshots`, etc.

- **Monthly Snapshots** (`api/cron/create-monthly-snapshots` - _Refactoring in progress_)
  - Aggregates daily data into monthly summaries for faster long-term querying.

## 4. Special Logic: "Quarterly" Views

We support a "3 Years" view that shows data quarterly.

- **The Challenge**: We do _not_ have specific `_quarterly` tables in the database.
- **The Solution**: The code (`snapshot-tables.ts`) automatically routes "Quarterly" requests to the **Monthly** tables.
- **Filtering**: The API then filters the monthly data to only return **January, April, July, and October**.
- **Benefit**: This gives a clean quarterly view without needing to maintain extra database tables.

## 5. Dashboard Pages & Components

- **Main Dashboard**: `src/app/dashboard/tests/page.tsx`
- **KPIs**: `src/app/dashboard/tests/kpis`
- **Station Load**: `src/app/dashboard/tests/station-load`
- **Item Types**: `src/app/dashboard/tests/item-types` (NEW - exposes the hidden tracking table)
- **Customer Performance**: `src/app/dashboard/tests/customer-performance`

## 6. Operational vs. Dashboard APIs

We distinguish between:

- **Dashboard APIs**: Calculate aggregates/stats (Migrated to `MetricsService`).
- **Operational APIs**: Fetch lists of items, handle scanning/shipping (Kept as specific optimized endpoints).
