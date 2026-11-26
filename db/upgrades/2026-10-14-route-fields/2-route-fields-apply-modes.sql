-- =============================================================================
-- שדות בעמדות — שלוש אפשרויות "על מי תחול הגרסה" בחלון הפרסום
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261014120000_route_fields_apply_modes/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: שדות בעמדות כבר הותקנו (1-route-station-fields.sql הורץ,
--      20261013120000_route_station_fields רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה: האילוץ route_field_versions_apply_chk מתרחב — apply_mode יכול
--      להיות גם 'not_started' (פריטים שעוד לא התחילו את המסלול, ברירת המחדל) ו-'all'
--      (כל הפריטים, גם בבדיקה). שום נתון לא משתנה.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש. בלי הקובץ הזה, פרסום מה-image החדש
-- נכשל (500) — שאר המערכת עובדת. ה-image הקודם ממשיך לעבוד גם אחרי ההרצה.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 2-route-fields-apply-modes.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261014120000_route_fields_apply_modes') THEN
    RAISE EXCEPTION 'מיגרציית אפשרויות הפרסום כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261013120000_route_station_fields') THEN
    RAISE EXCEPTION 'שדות בעמדות עוד לא הותקנו (20261013120000_route_station_fields חסרה) — להריץ קודם את 1-route-station-fields.sql. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
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

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '2abaa84a3a0b070c04bba3b6fdd44c3cae74326842febe067eabfceb5857c636', now(), '20261014120000_route_fields_apply_modes', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'האילוץ על apply_mode' AS בדיקה, pg_get_constraintdef(oid) AS תוצאה FROM pg_constraint
 WHERE conname = 'route_field_versions_apply_chk'
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261014120000_route_fields_apply_modes';
