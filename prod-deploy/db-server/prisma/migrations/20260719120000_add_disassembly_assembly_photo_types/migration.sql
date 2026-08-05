-- Photo types for the "פירוק" (disassembly) and "הרכבה" (assembly) test
-- stations. Each single-photo station addresses its own reference-image group
-- and tags its worker captures by the stable `code` (never the SERIAL id):
--   disassembly → test_station_type_id 2
--   assembly    → test_station_type_id 5
-- Idempotent so re-running against an environment that already has them is safe.
INSERT INTO "photo_types" ("code", "photo_type_desc", "sort_order") VALUES
    ('disassembly', 'צילום פירוק', 3),
    ('assembly', 'צילום הרכבה', 4)
ON CONFLICT ("code") DO NOTHING;
