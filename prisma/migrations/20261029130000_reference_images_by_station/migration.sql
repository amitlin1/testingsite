-- ============================================================================
-- Reference images go by station type, not by photo group
-- (docs/popup-templates/PLAN.md §5ג).
--
-- WHY: the reference-items page asked which photo group an image goes to
-- ("צילום אריזה", "פירוק · תיעוד בתמונות", ...), and a station showed the
-- images of the group its popup named. A group the station did not name —
-- an image uploaded to "צילום שיקוף" while the X-ray station's template
-- photo has a group of its own — was shown nowhere. Now the station type is
-- the reference set: the page lists the stations of the item's route and an
-- image is uploaded to a station; every station shows the images of its own
-- type (src/lib/reference-items.ts images_by_station).
--
-- reference_item_images.test_station_type_id: the station type. NULL = not
-- assigned: the page lists it under "לא משויכות לעמדה" with a station to
-- pick, and no station shows it. ON DELETE SET NULL: a station type that goes
-- away leaves its images unassigned, not deleted.
-- reference_item_images.photo_type_id: NOT NULL dropped. The group an image
-- was uploaded to stays as it was; a new image has none.
--
-- The backfill gives every existing image the station of its group, when
-- exactly one station type shows that group today:
--   * a popup template's photo component owns the group (photo_types.
--     test_station_type_id with component_id) — that station;
--   * a per-item station's code popup captures it (CODE_POPUPS in
--     src/app/lib/popup-templates/codePopups.ts: type 2 → group 3,
--     type 5 → group 4; a unit test keeps this list equal to it);
--   * the opening wizard's groups 'package' / 'product' — the package-level
--     station types that open a package route (any step but the last,
--     src/app/lib/popup-templates/placement.ts).
-- A group no station shows, or more than one shows, leaves its images
-- unassigned: the page offers the station to pick, so nothing has to be
-- uploaded again. scripts/prod-reference-images-by-station/1-dry-run.sql
-- reports, before this runs, which images go where and which stay
-- unassigned.
--
-- Additive: one nullable column, one dropped NOT NULL, one index. The
-- previous image keeps working after it (it never reads the column and
-- always writes photo_type_id). No metrics_schema_version bump.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database; the backfill runs only when the column is new.
-- ============================================================================

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'reference_item_images' AND column_name = 'test_station_type_id'
  ) THEN
    ALTER TABLE "reference_item_images" ADD COLUMN "test_station_type_id" INTEGER;

    UPDATE reference_item_images i
       SET test_station_type_id = m.station
      FROM (
        -- station-of-group:begin
        WITH opening_types AS (
          SELECT DISTINCT t.test_station_type_id
            FROM testing_routes tr
            JOIN item_types it ON it.item_type_id = tr.item_type_id AND it.is_package
           CROSS JOIN LATERAL unnest(tr.route_steps[1:GREATEST(COALESCE(array_length(tr.route_steps, 1), 0) - 1, 0)]) AS s(st)
            JOIN test_stations_type t ON t.test_station_type_id = s.st AND t.package_level
        ), candidates AS (
          SELECT p.photo_type_id, p.test_station_type_id AS station
            FROM photo_types p
           WHERE p.test_station_type_id IS NOT NULL AND p.component_id IS NOT NULL
          UNION
          SELECT c.photo_type_id, c.station
            FROM (VALUES (2, 3), (5, 4)) AS c(station, photo_type_id)
            JOIN test_stations_type t ON t.test_station_type_id = c.station AND NOT t.package_level
            JOIN photo_types p ON p.photo_type_id = c.photo_type_id
          UNION
          SELECT p.photo_type_id, o.test_station_type_id
            FROM photo_types p CROSS JOIN opening_types o
           WHERE p.code IN ('package', 'product')
        )
        SELECT photo_type_id, MIN(station) AS station, COUNT(DISTINCT station) AS stations
          FROM candidates
         GROUP BY photo_type_id
        -- station-of-group:end
      ) m
     WHERE m.stations = 1 AND i.photo_type_id = m.photo_type_id AND i.test_station_type_id IS NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_reference_item_images_station_type') THEN
    ALTER TABLE "reference_item_images" ADD CONSTRAINT "fk_reference_item_images_station_type"
      FOREIGN KEY ("test_station_type_id") REFERENCES "test_stations_type"("test_station_type_id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END
$mig$;

ALTER TABLE "reference_item_images" ALTER COLUMN "photo_type_id" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_reference_item_images_station" ON "reference_item_images"("test_station_type_id");
