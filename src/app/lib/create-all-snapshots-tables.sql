-- =====================================================
-- קובץ SQL - יצירת כל טבלאות ה-Snapshots
-- =====================================================
-- הרצה: psql -U appuser -d InventoryDB -f src/app/lib/create-all-snapshots-tables.sql
-- =====================================================

-- =====================================================
-- DAILY SNAPSHOTS - טבלאות יומיות (בלי suffix)
-- =====================================================

-- 1. Daily Snapshots למשלוחים
CREATE TABLE IF NOT EXISTS shipment_snapshots (
    snapshot_date DATE NOT NULL,
    shipment_id INTEGER NOT NULL,
    shipment_code VARCHAR(255),
    shipment_date DATE,
    customer_id INTEGER,
    customer_code VARCHAR(255),
    customer_name VARCHAR(255),
    total_items INTEGER NOT NULL DEFAULT 0,
    items_in_queue INTEGER NOT NULL DEFAULT 0,
    items_in_test INTEGER NOT NULL DEFAULT 0,
    items_waiting_for_research INTEGER NOT NULL DEFAULT 0,
    items_in_research INTEGER NOT NULL DEFAULT 0,
    items_finished INTEGER NOT NULL DEFAULT 0,
    items_in_routes INTEGER NOT NULL DEFAULT 0,
    completion_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    items_in_routes_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, shipment_id)
);
CREATE INDEX IF NOT EXISTS idx_shipment_snapshot_date ON shipment_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_shipment_snapshot_shipment ON shipment_snapshots(shipment_id);

-- 2. Daily Snapshots ללקוחות
CREATE TABLE IF NOT EXISTS customer_snapshots (
    snapshot_date DATE NOT NULL,
    customer_id INTEGER NOT NULL,
    customer_code VARCHAR(255),
    customer_name VARCHAR(255),
    total_items INTEGER NOT NULL DEFAULT 0,
    items_in_queue INTEGER NOT NULL DEFAULT 0,
    items_in_test INTEGER NOT NULL DEFAULT 0,
    items_waiting_for_research INTEGER NOT NULL DEFAULT 0,
    items_in_research INTEGER NOT NULL DEFAULT 0,
    finished_items INTEGER NOT NULL DEFAULT 0,
    items_in_routes INTEGER NOT NULL DEFAULT 0,
    success_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    items_in_routes_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    average_time_minutes DECIMAL(10,2),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_snapshot_date ON customer_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_customer_snapshot_customer ON customer_snapshots(customer_id);

-- 3. Daily Snapshots לתחנות
CREATE TABLE IF NOT EXISTS station_snapshots (
    snapshot_date DATE NOT NULL,
    station_id INTEGER NOT NULL,
    station_name VARCHAR(255),
    station_type_name VARCHAR(255),
    items_in_queue INTEGER NOT NULL DEFAULT 0,
    items_in_test INTEGER NOT NULL DEFAULT 0,
    average_current_queue_time_minutes DECIMAL(10,2),
    total_processed_in_period INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, station_id)
);
CREATE INDEX IF NOT EXISTS idx_station_snapshot_date ON station_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_station_snapshot_station ON station_snapshots(station_id);

-- 4. Daily Snapshots לסוגי פריטים
CREATE TABLE IF NOT EXISTS item_type_snapshots (
    snapshot_date DATE NOT NULL,
    item_type_id INTEGER NOT NULL,
    item_type_desc VARCHAR(255),
    total_items INTEGER NOT NULL DEFAULT 0,
    items_in_queue INTEGER NOT NULL DEFAULT 0,
    items_in_test INTEGER NOT NULL DEFAULT 0,
    items_waiting_for_research INTEGER NOT NULL DEFAULT 0,
    items_in_research INTEGER NOT NULL DEFAULT 0,
    items_finished INTEGER NOT NULL DEFAULT 0,
    items_in_routes INTEGER NOT NULL DEFAULT 0,
    completion_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    items_in_routes_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, item_type_id)
);
CREATE INDEX IF NOT EXISTS idx_item_type_snapshot_date ON item_type_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_item_type_snapshot_type ON item_type_snapshots(item_type_id);

-- 5. Daily Snapshots להתפלגות סטטוסים
CREATE TABLE IF NOT EXISTS status_distribution_snapshots (
    snapshot_date DATE NOT NULL,
    status_id INTEGER NOT NULL,
    status_name VARCHAR(255),
    count INTEGER NOT NULL DEFAULT 0,
    percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, status_id)
);
CREATE INDEX IF NOT EXISTS idx_status_dist_snapshot_date ON status_distribution_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_status_dist_snapshot_status ON status_distribution_snapshots(status_id);

-- 6. Daily Snapshots ל-KPIs
CREATE TABLE IF NOT EXISTS kpi_snapshots (
    snapshot_date DATE NOT NULL PRIMARY KEY,
    average_queue_time_minutes DECIMAL(10,2),
    average_processing_time_minutes DECIMAL(10,2),
    total_items_processed INTEGER NOT NULL DEFAULT 0,
    items_currently_in_queue INTEGER NOT NULL DEFAULT 0,
    items_currently_in_test INTEGER NOT NULL DEFAULT 0,
    busiest_station_id INTEGER,
    busiest_station_name VARCHAR(255),
    busiest_station_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kpi_snapshot_date ON kpi_snapshots(snapshot_date);

-- 7. Daily System Snapshots (משמש ל-daily-trends)
CREATE TABLE IF NOT EXISTS system_snapshots (
    snapshot_date DATE NOT NULL PRIMARY KEY,
    total_items INTEGER NOT NULL DEFAULT 0,
    items_in_queue INTEGER NOT NULL DEFAULT 0,
    items_in_test INTEGER NOT NULL DEFAULT 0,
    items_finished INTEGER NOT NULL DEFAULT 0,
    items_waiting_for_research INTEGER NOT NULL DEFAULT 0,
    items_in_research INTEGER NOT NULL DEFAULT 0,
    items_in_routes INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system_snapshot_date ON system_snapshots(snapshot_date);

-- =====================================================
-- MONTHLY SNAPSHOTS - טבלאות חודשיות
-- =====================================================

-- 1. Monthly Snapshots למשלוחים
CREATE TABLE IF NOT EXISTS shipment_snapshots_monthly (
    snapshot_date DATE NOT NULL,
    shipment_id INTEGER NOT NULL,
    shipment_code VARCHAR(255),
    shipment_date DATE,
    customer_id INTEGER,
    customer_code VARCHAR(255),
    customer_name VARCHAR(255),
    total_items INTEGER NOT NULL DEFAULT 0,
    items_in_queue INTEGER NOT NULL DEFAULT 0,
    items_in_test INTEGER NOT NULL DEFAULT 0,
    items_waiting_for_research INTEGER NOT NULL DEFAULT 0,
    items_in_research INTEGER NOT NULL DEFAULT 0,
    items_finished INTEGER NOT NULL DEFAULT 0,
    items_in_routes INTEGER NOT NULL DEFAULT 0,
    completion_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    items_in_routes_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, shipment_id)
);
CREATE INDEX IF NOT EXISTS idx_shipment_snapshot_monthly_date ON shipment_snapshots_monthly(snapshot_date);

-- 2. Monthly Snapshots ללקוחות
CREATE TABLE IF NOT EXISTS customer_snapshots_monthly (
    snapshot_date DATE NOT NULL,
    customer_id INTEGER NOT NULL,
    customer_code VARCHAR(255),
    customer_name VARCHAR(255),
    total_items INTEGER NOT NULL DEFAULT 0,
    items_in_queue INTEGER NOT NULL DEFAULT 0,
    items_in_test INTEGER NOT NULL DEFAULT 0,
    items_waiting_for_research INTEGER NOT NULL DEFAULT 0,
    items_in_research INTEGER NOT NULL DEFAULT 0,
    finished_items INTEGER NOT NULL DEFAULT 0,
    items_in_routes INTEGER NOT NULL DEFAULT 0,
    success_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    items_in_routes_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    average_time_minutes DECIMAL(10,2),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_snapshot_monthly_date ON customer_snapshots_monthly(snapshot_date);

-- 3. Monthly Snapshots לתחנות
CREATE TABLE IF NOT EXISTS station_snapshots_monthly (
    snapshot_date DATE NOT NULL,
    station_id INTEGER NOT NULL,
    station_name VARCHAR(255),
    station_type_name VARCHAR(255),
    items_in_queue INTEGER NOT NULL DEFAULT 0,
    items_in_test INTEGER NOT NULL DEFAULT 0,
    average_current_queue_time_minutes DECIMAL(10,2),
    total_processed_in_period INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, station_id)
);
CREATE INDEX IF NOT EXISTS idx_station_snapshot_monthly_date ON station_snapshots_monthly(snapshot_date);

-- 4. Monthly Snapshots לסוגי פריטים
CREATE TABLE IF NOT EXISTS item_type_snapshots_monthly (
    snapshot_date DATE NOT NULL,
    item_type_id INTEGER NOT NULL,
    item_type_desc VARCHAR(255),
    total_items INTEGER NOT NULL DEFAULT 0,
    items_in_queue INTEGER NOT NULL DEFAULT 0,
    items_in_test INTEGER NOT NULL DEFAULT 0,
    items_waiting_for_research INTEGER NOT NULL DEFAULT 0,
    items_in_research INTEGER NOT NULL DEFAULT 0,
    items_finished INTEGER NOT NULL DEFAULT 0,
    items_in_routes INTEGER NOT NULL DEFAULT 0,
    completion_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    items_in_routes_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, item_type_id)
);
CREATE INDEX IF NOT EXISTS idx_item_type_snapshot_monthly_date ON item_type_snapshots_monthly(snapshot_date);

-- 5. Monthly Snapshots להתפלגות סטטוס
CREATE TABLE IF NOT EXISTS status_distribution_snapshots_monthly (
    snapshot_date DATE NOT NULL,
    status_id INTEGER NOT NULL,
    status_name VARCHAR(255),
    count INTEGER NOT NULL DEFAULT 0,
    percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, status_id)
);
CREATE INDEX IF NOT EXISTS idx_status_dist_snapshot_monthly_date ON status_distribution_snapshots_monthly(snapshot_date);

-- 6. Monthly Snapshots ל-KPIs
CREATE TABLE IF NOT EXISTS kpi_snapshots_monthly (
    snapshot_date DATE NOT NULL PRIMARY KEY,
    average_queue_time_minutes DECIMAL(10,2),
    average_processing_time_minutes DECIMAL(10,2),
    total_items_processed INTEGER NOT NULL DEFAULT 0,
    items_currently_in_queue INTEGER NOT NULL DEFAULT 0,
    items_currently_in_test INTEGER NOT NULL DEFAULT 0,
    busiest_station_id INTEGER,
    busiest_station_name VARCHAR(255),
    busiest_station_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kpi_snapshot_monthly_date ON kpi_snapshots_monthly(snapshot_date);

-- 7. Monthly System Snapshots
CREATE TABLE IF NOT EXISTS system_snapshots_monthly (
    snapshot_date DATE NOT NULL PRIMARY KEY,
    total_items INTEGER NOT NULL DEFAULT 0,
    items_in_queue INTEGER NOT NULL DEFAULT 0,
    items_in_test INTEGER NOT NULL DEFAULT 0,
    items_finished INTEGER NOT NULL DEFAULT 0,
    items_waiting_for_research INTEGER NOT NULL DEFAULT 0,
    items_in_research INTEGER NOT NULL DEFAULT 0,
    items_in_routes INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system_snapshot_monthly_date ON system_snapshots_monthly(snapshot_date);
