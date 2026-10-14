-- ============================================================================
-- route_field_versions.apply_mode: the publish dialog's three scopes.
--
-- WHY: a publish used to move either no item in progress ('new_only') or the
-- ones that had not reached the changed step ('not_reached'), and never an
-- item taken in before station fields. Items already taken in had to be
-- received again to see a new version. The dialog now offers:
--   'not_started'  items that have not started their route (the default)
--   'not_reached'  those, and items before the changed step
--   'all'          every unfinished item, in test too
-- and each moves items taken in before station fields as well
-- (src/app/lib/station-fields/admin.ts, APPLY_MODES / movableRows).
-- 'new_only' stays valid: versions already published carry it, and scripts
-- still publish with it.
--
-- Only the CHECK changes; no data moves. The previous image keeps working
-- after it (it writes 'new_only' / 'not_reached' only), so this can run any
-- time before the new image. No metrics_schema_version bump: the worker write
-- path does not read apply_mode, and only the admin publish writes it.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

ALTER TABLE "route_field_versions" DROP CONSTRAINT IF EXISTS "route_field_versions_apply_chk";
ALTER TABLE "route_field_versions" ADD CONSTRAINT "route_field_versions_apply_chk"
    CHECK ("apply_mode" IN ('new_only', 'not_started', 'not_reached', 'all'));
