-- CreateTable
CREATE TABLE "test_results" (
    "test_result_id" SERIAL NOT NULL,
    "item_id" BIGINT NOT NULL,
    "test_station_id" INTEGER NOT NULL,
    "test_station_type_id" INTEGER NOT NULL,
    "route_number" INTEGER NOT NULL DEFAULT 1,
    "route_step" INTEGER NOT NULL,
    "worker_id" INTEGER,
    "passed" BOOLEAN,
    "result" INTEGER,
    "comments" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_results_pkey" PRIMARY KEY ("test_result_id")
);

-- CreateIndex
CREATE INDEX "idx_test_results_item" ON "test_results"("item_id");

-- CreateIndex
CREATE INDEX "idx_test_results_station" ON "test_results"("test_station_id");

-- CreateIndex
CREATE INDEX "idx_test_results_station_type" ON "test_results"("test_station_type_id");
