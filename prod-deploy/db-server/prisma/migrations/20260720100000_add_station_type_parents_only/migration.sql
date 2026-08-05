-- Station types whose stations test a parent item together with its accessories.
-- When true, the testing queue for such a station lists parent items only.
ALTER TABLE "test_stations_type"
  ADD COLUMN "parents_only" BOOLEAN NOT NULL DEFAULT false;
