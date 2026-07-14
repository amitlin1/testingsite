-- Unique constraints on settings-catalog name columns (prevent duplicate entries).
-- CreateIndex
CREATE UNIQUE INDEX "item_types_item_type_desc_key" ON "item_types"("item_type_desc");

-- CreateIndex
CREATE UNIQUE INDEX "item_status_item_status_desc_key" ON "item_status"("item_status_desc");

-- CreateIndex
CREATE UNIQUE INDEX "sources_source_desc_key" ON "sources"("source_desc");

-- CreateIndex
CREATE UNIQUE INDEX "test_station_status_test_station_status_desc_key" ON "test_station_status"("test_station_status_desc");

-- CreateIndex
CREATE UNIQUE INDEX "test_stations_test_station_desc_key" ON "test_stations"("test_station_desc");

-- CreateIndex
CREATE UNIQUE INDEX "test_stations_type_test_type_desc_key" ON "test_stations_type"("test_type_desc");
