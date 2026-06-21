-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "customer_snapshots" (
    "snapshot_date" DATE NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "customer_code" VARCHAR(255),
    "customer_name" VARCHAR(255),
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "items_waiting_for_research" INTEGER NOT NULL DEFAULT 0,
    "items_in_research" INTEGER NOT NULL DEFAULT 0,
    "finished_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_routes" INTEGER NOT NULL DEFAULT 0,
    "success_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "items_in_routes_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "average_time_minutes" DECIMAL(10,2),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_snapshots_pkey" PRIMARY KEY ("snapshot_date","customer_id")
);

-- CreateTable
CREATE TABLE "customer_snapshots_daily" (
    "snapshot_id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "total_items" INTEGER DEFAULT 0,
    "items_in_queue" INTEGER DEFAULT 0,
    "items_in_test" INTEGER DEFAULT 0,
    "items_finished" INTEGER DEFAULT 0,
    "items_waiting_for_research" INTEGER DEFAULT 0,
    "items_in_research" INTEGER DEFAULT 0,
    "items_in_routes" INTEGER DEFAULT 0,
    "total_processed_in_period" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_snapshots_daily_pkey" PRIMARY KEY ("snapshot_id")
);

-- CreateTable
CREATE TABLE "customer_snapshots_monthly" (
    "snapshot_date" DATE NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "customer_code" VARCHAR(255),
    "customer_name" VARCHAR(255),
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "items_waiting_for_research" INTEGER NOT NULL DEFAULT 0,
    "items_in_research" INTEGER NOT NULL DEFAULT 0,
    "finished_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_routes" INTEGER NOT NULL DEFAULT 0,
    "success_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "items_in_routes_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "average_time_minutes" DECIMAL(10,2),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_snapshots_monthly_pkey" PRIMARY KEY ("snapshot_date","customer_id")
);

-- CreateTable
CREATE TABLE "customer_snapshots_quarterly" (
    "snapshot_date" DATE NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "customer_code" VARCHAR(255),
    "customer_name" VARCHAR(255),
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "items_waiting_for_research" INTEGER NOT NULL DEFAULT 0,
    "items_in_research" INTEGER NOT NULL DEFAULT 0,
    "finished_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_routes" INTEGER NOT NULL DEFAULT 0,
    "success_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "items_in_routes_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "average_time_minutes" DECIMAL(10,2),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_snapshots_quarterly_pkey" PRIMARY KEY ("snapshot_date","customer_id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "name" CHAR(50) NOT NULL,
    "customer_code" VARCHAR(100) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_counters" (
    "date_key" DATE NOT NULL,
    "counter" INTEGER DEFAULT 0,

    CONSTRAINT "daily_counters_pkey" PRIMARY KEY ("date_key")
);

-- CreateTable
CREATE TABLE "finished_item" (
    "item_id" SERIAL NOT NULL,
    "item_type_id" INTEGER NOT NULL,
    "current_status" INTEGER NOT NULL,
    "current_route_step" INTEGER NOT NULL,
    "test_station_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL,
    "finished_at" TIMESTAMP(6),
    "is_finished" BOOLEAN NOT NULL DEFAULT false,
    "processing_start_time" TIMESTAMP(6),
    "q_start_time" TIMESTAMP(6),

    CONSTRAINT "finished_item_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "item_route_history" (
    "log_id" SERIAL NOT NULL,
    "item_id" BIGINT NOT NULL,
    "test_station_id" INTEGER NOT NULL,
    "current_route_step" INTEGER NOT NULL,
    "queue_start_time" TIMESTAMP(6),
    "processing_start_time" TIMESTAMP(6),
    "processing_end_time" TIMESTAMP(6),
    "worker_id" INTEGER,
    "route_number" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "item_route_history_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "item_routes" (
    "item_id" BIGSERIAL NOT NULL,
    "item_type_id" INTEGER NOT NULL,
    "current_status" INTEGER NOT NULL,
    "current_route_step" INTEGER NOT NULL,
    "test_station_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL,
    "finished_at" TIMESTAMP(6),
    "is_finished" BOOLEAN NOT NULL DEFAULT false,
    "queue_start_time" TIMESTAMP(6) NOT NULL,
    "processing_start_time" TIMESTAMP(6),
    "route_number" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "item_routes_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "item_status" (
    "item_status_id" SERIAL NOT NULL,
    "item_status_desc" CHAR(50) NOT NULL,

    CONSTRAINT "item_status_pkey" PRIMARY KEY ("item_status_id")
);

-- CreateTable
CREATE TABLE "item_type_snapshots" (
    "snapshot_date" DATE NOT NULL,
    "item_type_id" INTEGER NOT NULL,
    "item_type_desc" VARCHAR(255),
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "items_waiting_for_research" INTEGER NOT NULL DEFAULT 0,
    "items_in_research" INTEGER NOT NULL DEFAULT 0,
    "items_finished" INTEGER NOT NULL DEFAULT 0,
    "items_in_routes" INTEGER NOT NULL DEFAULT 0,
    "completion_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "items_in_routes_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_type_snapshots_pkey" PRIMARY KEY ("snapshot_date","item_type_id")
);

-- CreateTable
CREATE TABLE "item_type_snapshots_monthly" (
    "snapshot_date" DATE NOT NULL,
    "item_type_id" INTEGER NOT NULL,
    "item_type_desc" VARCHAR(255),
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "items_waiting_for_research" INTEGER NOT NULL DEFAULT 0,
    "items_in_research" INTEGER NOT NULL DEFAULT 0,
    "items_finished" INTEGER NOT NULL DEFAULT 0,
    "items_in_routes" INTEGER NOT NULL DEFAULT 0,
    "completion_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "items_in_routes_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_type_snapshots_monthly_pkey" PRIMARY KEY ("snapshot_date","item_type_id")
);

-- CreateTable
CREATE TABLE "item_type_snapshots_quarterly" (
    "snapshot_date" DATE NOT NULL,
    "item_type_id" INTEGER NOT NULL,
    "item_type_desc" VARCHAR(255),
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "items_waiting_for_research" INTEGER NOT NULL DEFAULT 0,
    "items_in_research" INTEGER NOT NULL DEFAULT 0,
    "items_finished" INTEGER NOT NULL DEFAULT 0,
    "items_in_routes" INTEGER NOT NULL DEFAULT 0,
    "completion_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "items_in_routes_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_type_snapshots_quarterly_pkey" PRIMARY KEY ("snapshot_date","item_type_id")
);

-- CreateTable
CREATE TABLE "item_types" (
    "item_type_id" SERIAL NOT NULL,
    "item_type_desc" CHAR(50) NOT NULL,

    CONSTRAINT "item_types_pkey" PRIMARY KEY ("item_type_id")
);

-- CreateTable
CREATE TABLE "items" (
    "item_id" BIGINT NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "item_type_id" INTEGER NOT NULL,
    "serial_no" INTEGER NOT NULL,
    "makat" INTEGER NOT NULL,
    "model" CHAR(50) NOT NULL,
    "manufacturer_name" CHAR(50) NOT NULL,
    "manufacturer_no" INTEGER NOT NULL,
    "shipment_id" INTEGER NOT NULL,
    "parent_item_id" BIGINT,

    CONSTRAINT "items_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "kpi_snapshots" (
    "snapshot_date" DATE NOT NULL,
    "average_queue_time_minutes" DECIMAL(10,2),
    "average_processing_time_minutes" DECIMAL(10,2),
    "total_items_processed" INTEGER NOT NULL DEFAULT 0,
    "items_currently_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_currently_in_test" INTEGER NOT NULL DEFAULT 0,
    "busiest_station_id" INTEGER,
    "busiest_station_name" VARCHAR(255),
    "busiest_station_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_snapshots_pkey" PRIMARY KEY ("snapshot_date")
);

-- CreateTable
CREATE TABLE "kpi_snapshots_monthly" (
    "snapshot_date" DATE NOT NULL,
    "average_queue_time_minutes" DECIMAL(10,2),
    "average_processing_time_minutes" DECIMAL(10,2),
    "total_items_processed" INTEGER NOT NULL DEFAULT 0,
    "items_currently_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_currently_in_test" INTEGER NOT NULL DEFAULT 0,
    "busiest_station_id" INTEGER,
    "busiest_station_name" VARCHAR(255),
    "busiest_station_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_snapshots_monthly_pkey" PRIMARY KEY ("snapshot_date")
);

-- CreateTable
CREATE TABLE "kpi_snapshots_quarterly" (
    "snapshot_date" DATE NOT NULL,
    "average_queue_time_minutes" DECIMAL(10,2),
    "average_processing_time_minutes" DECIMAL(10,2),
    "total_items_processed" INTEGER NOT NULL DEFAULT 0,
    "items_currently_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_currently_in_test" INTEGER NOT NULL DEFAULT 0,
    "busiest_station_id" INTEGER,
    "busiest_station_name" VARCHAR(255),
    "busiest_station_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_snapshots_quarterly_pkey" PRIMARY KEY ("snapshot_date")
);

-- CreateTable
CREATE TABLE "research_history" (
    "research_id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "station_id" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(6),
    "return_at" TIMESTAMP(6),
    "result" INTEGER NOT NULL,
    "comments" TEXT,
    "worker_id" INTEGER,

    CONSTRAINT "research_history_pkey" PRIMARY KEY ("research_id")
);

-- CreateTable
CREATE TABLE "shipment_history" (
    "log_id" SERIAL NOT NULL,
    "shipment_id" INTEGER NOT NULL,
    "sent_shipment_code" TEXT NOT NULL,
    "sent_date" TIMESTAMP(6) NOT NULL,
    "sending_worker_id" INTEGER,
    "item_type_id" INTEGER,
    "makat" INTEGER,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "signature_path" TEXT,

    CONSTRAINT "shipment_history_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" SERIAL NOT NULL,
    "shipment_id" INTEGER,
    "item_type_id" INTEGER,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "makat" INTEGER,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_snapshots" (
    "snapshot_date" DATE NOT NULL,
    "shipment_id" INTEGER NOT NULL,
    "shipment_code" VARCHAR(255),
    "shipment_date" DATE,
    "customer_id" INTEGER,
    "customer_code" VARCHAR(255),
    "customer_name" VARCHAR(255),
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "items_waiting_for_research" INTEGER NOT NULL DEFAULT 0,
    "items_in_research" INTEGER NOT NULL DEFAULT 0,
    "items_finished" INTEGER NOT NULL DEFAULT 0,
    "items_in_routes" INTEGER NOT NULL DEFAULT 0,
    "completion_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "items_in_routes_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_snapshots_pkey" PRIMARY KEY ("snapshot_date","shipment_id")
);

-- CreateTable
CREATE TABLE "shipment_snapshots_monthly" (
    "snapshot_date" DATE NOT NULL,
    "shipment_id" INTEGER NOT NULL,
    "shipment_code" VARCHAR(255),
    "shipment_date" DATE,
    "customer_id" INTEGER,
    "customer_code" VARCHAR(255),
    "customer_name" VARCHAR(255),
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "items_waiting_for_research" INTEGER NOT NULL DEFAULT 0,
    "items_in_research" INTEGER NOT NULL DEFAULT 0,
    "items_finished" INTEGER NOT NULL DEFAULT 0,
    "items_in_routes" INTEGER NOT NULL DEFAULT 0,
    "completion_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "items_in_routes_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_snapshots_monthly_pkey" PRIMARY KEY ("snapshot_date","shipment_id")
);

-- CreateTable
CREATE TABLE "shipment_snapshots_quarterly" (
    "snapshot_date" DATE NOT NULL,
    "shipment_id" INTEGER NOT NULL,
    "shipment_code" VARCHAR(255),
    "shipment_date" DATE,
    "customer_id" INTEGER,
    "customer_code" VARCHAR(255),
    "customer_name" VARCHAR(255),
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "items_waiting_for_research" INTEGER NOT NULL DEFAULT 0,
    "items_in_research" INTEGER NOT NULL DEFAULT 0,
    "items_finished" INTEGER NOT NULL DEFAULT 0,
    "items_in_routes" INTEGER NOT NULL DEFAULT 0,
    "completion_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "items_in_routes_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_snapshots_quarterly_pkey" PRIMARY KEY ("snapshot_date","shipment_id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" SERIAL NOT NULL,
    "shipment_code" VARCHAR(20) NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "shipment_date" TIMESTAMP(6) NOT NULL,
    "makat" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "shipment_sent_date" TIMESTAMP(6),
    "is_sent" BOOLEAN DEFAULT false,
    "recieving_worker_id" INTEGER,
    "source_id" INTEGER,
    "sending_worker_id" INTEGER,
    "finished_at" TIMESTAMPTZ(6),
    "signature_path" TEXT,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "source_id" SERIAL NOT NULL,
    "source_desc" VARCHAR(100) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("source_id")
);

-- CreateTable
CREATE TABLE "station_snapshots" (
    "snapshot_date" DATE NOT NULL,
    "station_id" INTEGER NOT NULL,
    "station_name" VARCHAR(255),
    "station_type_name" VARCHAR(255),
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "average_current_queue_time_minutes" DECIMAL(10,2),
    "total_processed_in_period" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_snapshots_pkey" PRIMARY KEY ("snapshot_date","station_id")
);

-- CreateTable
CREATE TABLE "station_snapshots_monthly" (
    "snapshot_date" DATE NOT NULL,
    "station_id" INTEGER NOT NULL,
    "station_name" VARCHAR(255),
    "station_type_name" VARCHAR(255),
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "average_current_queue_time_minutes" DECIMAL(10,2),
    "total_processed_in_period" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_snapshots_monthly_pkey" PRIMARY KEY ("snapshot_date","station_id")
);

-- CreateTable
CREATE TABLE "station_snapshots_quarterly" (
    "snapshot_date" DATE NOT NULL,
    "station_id" INTEGER NOT NULL,
    "station_name" VARCHAR(255),
    "station_type_name" VARCHAR(255),
    "items_in_queue" INTEGER NOT NULL DEFAULT 0,
    "items_in_test" INTEGER NOT NULL DEFAULT 0,
    "average_current_queue_time_minutes" DECIMAL(10,2),
    "total_processed_in_period" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_snapshots_quarterly_pkey" PRIMARY KEY ("snapshot_date","station_id")
);

-- CreateTable
CREATE TABLE "status_distribution_snapshots" (
    "snapshot_date" DATE NOT NULL,
    "status_id" INTEGER NOT NULL,
    "status_name" VARCHAR(255),
    "count" INTEGER NOT NULL DEFAULT 0,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_distribution_snapshots_pkey" PRIMARY KEY ("snapshot_date","status_id")
);

-- CreateTable
CREATE TABLE "status_distribution_snapshots_monthly" (
    "snapshot_date" DATE NOT NULL,
    "status_id" INTEGER NOT NULL,
    "status_name" VARCHAR(255),
    "count" INTEGER NOT NULL DEFAULT 0,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_distribution_snapshots_monthly_pkey" PRIMARY KEY ("snapshot_date","status_id")
);

-- CreateTable
CREATE TABLE "status_distribution_snapshots_quarterly" (
    "snapshot_date" DATE NOT NULL,
    "status_id" INTEGER NOT NULL,
    "status_name" VARCHAR(255),
    "count" INTEGER NOT NULL DEFAULT 0,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_distribution_snapshots_quarterly_pkey" PRIMARY KEY ("snapshot_date","status_id")
);

-- CreateTable
CREATE TABLE "system_snapshots_daily" (
    "snapshot_id" SERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "total_items" INTEGER DEFAULT 0,
    "items_in_queue" INTEGER DEFAULT 0,
    "items_in_test" INTEGER DEFAULT 0,
    "items_finished" INTEGER DEFAULT 0,
    "items_waiting_for_research" INTEGER DEFAULT 0,
    "items_in_research" INTEGER DEFAULT 0,
    "items_in_routes" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_snapshots_daily_pkey" PRIMARY KEY ("snapshot_id")
);

-- CreateTable
CREATE TABLE "system_snapshots_monthly" (
    "snapshot_id" SERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "total_items" INTEGER DEFAULT 0,
    "items_in_queue" INTEGER DEFAULT 0,
    "items_in_test" INTEGER DEFAULT 0,
    "items_finished" INTEGER DEFAULT 0,
    "items_waiting_for_research" INTEGER DEFAULT 0,
    "items_in_research" INTEGER DEFAULT 0,
    "items_in_routes" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_snapshots_monthly_pkey" PRIMARY KEY ("snapshot_id")
);

-- CreateTable
CREATE TABLE "test_station_status" (
    "test_station_status_id" SERIAL NOT NULL,
    "test_station_status_desc" CHAR(50) NOT NULL,

    CONSTRAINT "test_station_status_pkey" PRIMARY KEY ("test_station_status_id")
);

-- CreateTable
CREATE TABLE "test_stations" (
    "test_station_id" SERIAL NOT NULL,
    "test_station_type_id" INTEGER NOT NULL,
    "test_station_desc" CHAR(50) NOT NULL,
    "status" INTEGER NOT NULL,
    "is_research" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "test_stations_pkey" PRIMARY KEY ("test_station_id")
);

-- CreateTable
CREATE TABLE "test_stations_type" (
    "test_station_type_id" SERIAL NOT NULL,
    "test_type_desc" CHAR(50) NOT NULL,

    CONSTRAINT "test_stations_type_pkey" PRIMARY KEY ("test_station_type_id")
);

-- CreateTable
CREATE TABLE "testing_routes" (
    "test_route_id" SERIAL NOT NULL,
    "item_type_id" INTEGER NOT NULL,
    "test_station_type_id" INTEGER NOT NULL,
    "route_steps" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "route_number" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "testing_routes_pkey" PRIMARY KEY ("test_route_id")
);

-- CreateTable
CREATE TABLE "workers" (
    "worker_id" INTEGER NOT NULL,
    "worker_name" VARCHAR(100) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("worker_id")
);

-- CreateIndex
CREATE INDEX "idx_customer_snapshot_customer" ON "customer_snapshots"("customer_id");

-- CreateIndex
CREATE INDEX "idx_customer_snapshot_date" ON "customer_snapshots"("snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "customer_snapshots_daily_snapshot_date_customer_id_key" ON "customer_snapshots_daily"("snapshot_date", "customer_id");

-- CreateIndex
CREATE INDEX "idx_customer_snapshot_monthly_customer" ON "customer_snapshots_monthly"("customer_id");

-- CreateIndex
CREATE INDEX "idx_customer_snapshot_monthly_date" ON "customer_snapshots_monthly"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_customer_snapshot_quarterly_customer" ON "customer_snapshots_quarterly"("customer_id");

-- CreateIndex
CREATE INDEX "idx_customer_snapshot_quarterly_date" ON "customer_snapshots_quarterly"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_item_type_snapshot_date" ON "item_type_snapshots"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_item_type_snapshot_type" ON "item_type_snapshots"("item_type_id");

-- CreateIndex
CREATE INDEX "idx_item_type_snapshot_monthly_date" ON "item_type_snapshots_monthly"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_item_type_snapshot_monthly_type" ON "item_type_snapshots_monthly"("item_type_id");

-- CreateIndex
CREATE INDEX "idx_item_type_snapshot_quarterly_date" ON "item_type_snapshots_quarterly"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_item_type_snapshot_quarterly_type" ON "item_type_snapshots_quarterly"("item_type_id");

-- CreateIndex
CREATE INDEX "idx_kpi_snapshot_date" ON "kpi_snapshots"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_kpi_snapshot_monthly_date" ON "kpi_snapshots_monthly"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_kpi_snapshot_quarterly_date" ON "kpi_snapshots_quarterly"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_shipment_history_shipment_id" ON "shipment_history"("shipment_id");

-- CreateIndex
CREATE INDEX "idx_shipment_snapshot_customer" ON "shipment_snapshots"("customer_id");

-- CreateIndex
CREATE INDEX "idx_shipment_snapshot_date" ON "shipment_snapshots"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_shipment_snapshot_shipment" ON "shipment_snapshots"("shipment_id");

-- CreateIndex
CREATE INDEX "idx_shipment_snapshot_monthly_date" ON "shipment_snapshots_monthly"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_shipment_snapshot_monthly_shipment" ON "shipment_snapshots_monthly"("shipment_id");

-- CreateIndex
CREATE INDEX "idx_shipment_snapshot_quarterly_date" ON "shipment_snapshots_quarterly"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_shipment_snapshot_quarterly_shipment" ON "shipment_snapshots_quarterly"("shipment_id");

-- CreateIndex
CREATE INDEX "idx_sources_desc" ON "sources"("source_desc");

-- CreateIndex
CREATE INDEX "idx_station_snapshot_date" ON "station_snapshots"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_station_snapshot_station" ON "station_snapshots"("station_id");

-- CreateIndex
CREATE INDEX "idx_station_snapshot_monthly_date" ON "station_snapshots_monthly"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_station_snapshot_monthly_station" ON "station_snapshots_monthly"("station_id");

-- CreateIndex
CREATE INDEX "idx_station_snapshot_quarterly_date" ON "station_snapshots_quarterly"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_station_snapshot_quarterly_station" ON "station_snapshots_quarterly"("station_id");

-- CreateIndex
CREATE INDEX "idx_status_dist_snapshot_date" ON "status_distribution_snapshots"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_status_dist_snapshot_status" ON "status_distribution_snapshots"("status_id");

-- CreateIndex
CREATE INDEX "idx_status_dist_snapshot_monthly_date" ON "status_distribution_snapshots_monthly"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_status_dist_snapshot_monthly_status" ON "status_distribution_snapshots_monthly"("status_id");

-- CreateIndex
CREATE INDEX "idx_status_dist_snapshot_quarterly_date" ON "status_distribution_snapshots_quarterly"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_status_dist_snapshot_quarterly_status" ON "status_distribution_snapshots_quarterly"("status_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_snapshots_daily_snapshot_date_key" ON "system_snapshots_daily"("snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "system_snapshots_monthly_snapshot_date_key" ON "system_snapshots_monthly"("snapshot_date");

-- AddForeignKey
ALTER TABLE "item_routes" ADD CONSTRAINT "fk_item_routes_item_type" FOREIGN KEY ("item_type_id") REFERENCES "item_types"("item_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "item_routes" ADD CONSTRAINT "fk_item_routes_test_station" FOREIGN KEY ("test_station_id") REFERENCES "test_stations"("test_station_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_parent_item_id_fkey" FOREIGN KEY ("parent_item_id") REFERENCES "items"("item_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_history" ADD CONSTRAINT "shipment_history_item_type_id_fkey" FOREIGN KEY ("item_type_id") REFERENCES "item_types"("item_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_history" ADD CONSTRAINT "shipment_history_sending_worker_id_fkey" FOREIGN KEY ("sending_worker_id") REFERENCES "workers"("worker_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_history" ADD CONSTRAINT "shipment_history_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_item_type_id_fkey" FOREIGN KEY ("item_type_id") REFERENCES "item_types"("item_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_recieving_worker_id_fkey" FOREIGN KEY ("recieving_worker_id") REFERENCES "workers"("worker_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_sending_worker_id_fkey" FOREIGN KEY ("sending_worker_id") REFERENCES "workers"("worker_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "test_stations" ADD CONSTRAINT "fk_test_stations_test_station_type" FOREIGN KEY ("test_station_type_id") REFERENCES "test_stations_type"("test_station_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "testing_routes" ADD CONSTRAINT "fk_testing_routes_item_type" FOREIGN KEY ("item_type_id") REFERENCES "item_types"("item_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "testing_routes" ADD CONSTRAINT "fk_testing_routes_test_station_type" FOREIGN KEY ("test_station_type_id") REFERENCES "test_stations_type"("test_station_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

