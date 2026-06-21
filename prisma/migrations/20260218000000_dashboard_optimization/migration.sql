-- Dashboard Optimization Migration
-- Adds: system_snapshots table, station_hourly_snapshots, station_live_counters,
--        performance indexes, materialized view, trigger-based live counters

-- ============================================================
-- 1. New Tables (from Prisma schema)
-- ============================================================

-- System snapshots table (was used in raw SQL but missing from schema)
CREATE TABLE IF NOT EXISTS "system_snapshots" (
    "snapshot_date" DATE NOT NULL,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "items_finished" INTEGER NOT NULL DEFAULT 0,
    "items_waiting_for_research" INTEGER NOT NULL DEFAULT 0,
    "items_in_research" INTEGER NOT NULL DEFAULT 0,
    "items_in_routes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_snapshots_pkey" PRIMARY KEY ("snapshot_date")
);

CREATE INDEX IF NOT EXISTS "idx_system_snapshot_date" ON "system_snapshots"("snapshot_date");

-- Station hourly snapshots (granular station analytics)
CREATE TABLE IF NOT EXISTS "station_hourly_snapshots" (
    "id" SERIAL NOT NULL,
    "snapshot_hour" TIMESTAMP(6) NOT NULL,
    "station_id" INTEGER NOT NULL,
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "avg_queue_time" DOUBLE PRECISION,
    "avg_test_time" DOUBLE PRECISION,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_hourly_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "station_hourly_snapshots_snapshot_hour_station_id_key" ON "station_hourly_snapshots"("snapshot_hour", "station_id");
CREATE INDEX IF NOT EXISTS "idx_station_hourly_snapshot_hour" ON "station_hourly_snapshots"("snapshot_hour");

-- Station live counters (O(1) lookups for real-time queue/test counts)
CREATE TABLE IF NOT EXISTS "station_live_counters" (
    "station_id" INTEGER NOT NULL,
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "station_live_counters_pkey" PRIMARY KEY ("station_id")
);

-- ============================================================
-- 2. Performance Indexes on item_routes and item_route_history
-- ============================================================

CREATE INDEX IF NOT EXISTS "idx_ir_current_status" ON "item_routes"("current_status");
CREATE INDEX IF NOT EXISTS "idx_ir_test_station_id" ON "item_routes"("test_station_id");
CREATE INDEX IF NOT EXISTS "idx_ir_finished_at" ON "item_routes"("finished_at");
CREATE INDEX IF NOT EXISTS "idx_ir_is_finished" ON "item_routes"("is_finished");

CREATE INDEX IF NOT EXISTS "idx_irh_item_id" ON "item_route_history"("item_id");
CREATE INDEX IF NOT EXISTS "idx_irh_station_id" ON "item_route_history"("test_station_id");
CREATE INDEX IF NOT EXISTS "idx_irh_processing_end_time" ON "item_route_history"("processing_end_time");
CREATE INDEX IF NOT EXISTS "idx_irh_worker_id" ON "item_route_history"("worker_id");

-- ============================================================
-- 3. Initialize Live Counters from Current Data
-- ============================================================

INSERT INTO station_live_counters (station_id, items_in_queue, items_in_test)
SELECT
    ts.test_station_id,
    COALESCE(SUM(CASE WHEN ir.current_status IN (2, 4) AND ir.is_finished = false THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ir.current_status IN (1, 5) AND ir.is_finished = false THEN 1 ELSE 0 END), 0)
FROM test_stations ts
LEFT JOIN item_routes ir ON ir.test_station_id = ts.test_station_id AND ir.is_finished = false
GROUP BY ts.test_station_id
ON CONFLICT (station_id) DO UPDATE SET
    items_in_queue = EXCLUDED.items_in_queue,
    items_in_test = EXCLUDED.items_in_test;

-- ============================================================
-- 4. Trigger Function for Live Counter Updates
-- ============================================================

CREATE OR REPLACE FUNCTION update_station_counters()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle INSERT
    IF (TG_OP = 'INSERT') THEN
        -- New item entering queue
        IF (NEW.current_status IN (2, 4) AND NEW.is_finished = false AND NEW.test_station_id IS NOT NULL) THEN
            INSERT INTO station_live_counters (station_id, items_in_queue, items_in_test)
            VALUES (NEW.test_station_id, 1, 0)
            ON CONFLICT (station_id) DO UPDATE
            SET items_in_queue = station_live_counters.items_in_queue + 1;
        END IF;
        -- New item entering test
        IF (NEW.current_status IN (1, 5) AND NEW.is_finished = false AND NEW.test_station_id IS NOT NULL) THEN
            INSERT INTO station_live_counters (station_id, items_in_queue, items_in_test)
            VALUES (NEW.test_station_id, 0, 1)
            ON CONFLICT (station_id) DO UPDATE
            SET items_in_test = station_live_counters.items_in_test + 1;
        END IF;
        RETURN NEW;
    END IF;

    -- Handle UPDATE
    IF (TG_OP = 'UPDATE') THEN
        -- Decrement old station counters
        IF (OLD.test_station_id IS NOT NULL) THEN
            IF (OLD.current_status IN (2, 4) AND OLD.is_finished = false) THEN
                UPDATE station_live_counters
                SET items_in_queue = GREATEST(0, items_in_queue - 1)
                WHERE station_id = OLD.test_station_id;
            END IF;
            IF (OLD.current_status IN (1, 5) AND OLD.is_finished = false) THEN
                UPDATE station_live_counters
                SET items_in_test = GREATEST(0, items_in_test - 1)
                WHERE station_id = OLD.test_station_id;
            END IF;
        END IF;

        -- Increment new station counters
        IF (NEW.test_station_id IS NOT NULL AND NEW.is_finished = false) THEN
            IF (NEW.current_status IN (2, 4)) THEN
                INSERT INTO station_live_counters (station_id, items_in_queue, items_in_test)
                VALUES (NEW.test_station_id, 1, 0)
                ON CONFLICT (station_id) DO UPDATE
                SET items_in_queue = station_live_counters.items_in_queue + 1;
            END IF;
            IF (NEW.current_status IN (1, 5)) THEN
                INSERT INTO station_live_counters (station_id, items_in_queue, items_in_test)
                VALUES (NEW.test_station_id, 0, 1)
                ON CONFLICT (station_id) DO UPDATE
                SET items_in_test = station_live_counters.items_in_test + 1;
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    -- Handle DELETE
    IF (TG_OP = 'DELETE') THEN
        IF (OLD.test_station_id IS NOT NULL AND OLD.is_finished = false) THEN
            IF (OLD.current_status IN (2, 4)) THEN
                UPDATE station_live_counters
                SET items_in_queue = GREATEST(0, items_in_queue - 1)
                WHERE station_id = OLD.test_station_id;
            END IF;
            IF (OLD.current_status IN (1, 5)) THEN
                UPDATE station_live_counters
                SET items_in_test = GREATEST(0, items_in_test - 1)
                WHERE station_id = OLD.test_station_id;
            END IF;
        END IF;
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to item_routes
DROP TRIGGER IF EXISTS trg_update_station_counters ON item_routes;
CREATE TRIGGER trg_update_station_counters
    AFTER INSERT OR UPDATE OR DELETE ON item_routes
    FOR EACH ROW EXECUTE FUNCTION update_station_counters();

-- ============================================================
-- 5. Materialized View for Station Stats
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_station_stats AS
SELECT
    irh.test_station_id,
    COUNT(*) AS processed_count,
    AVG(
        CASE WHEN irh.processing_start_time IS NOT NULL AND irh.processing_end_time IS NOT NULL
        THEN EXTRACT(EPOCH FROM (irh.processing_end_time - irh.processing_start_time)) / 60.0
        ELSE NULL END
    ) AS avg_processing_minutes,
    AVG(
        CASE WHEN irh.queue_start_time IS NOT NULL AND irh.processing_start_time IS NOT NULL
        THEN EXTRACT(EPOCH FROM (irh.processing_start_time - irh.queue_start_time)) / 60.0
        ELSE NULL END
    ) AS avg_queue_minutes
FROM item_route_history irh
WHERE irh.processing_end_time IS NOT NULL
GROUP BY irh.test_station_id;

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_station_stats_station_id ON mv_station_stats(test_station_id);
