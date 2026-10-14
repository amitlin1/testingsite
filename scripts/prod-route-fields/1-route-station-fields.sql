-- =============================================================================
-- שדרוג DB הייצור לשדות בעמדות (route-fields) — הכול בפעולה אחת
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261013120000_route_station_fields/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: מודל המארזים כבר הותקן (metrics_schema_version >= 3,
--      המיגרציה 20260915120000_package_model רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (תוספות בלבד): testing_routes.step_uids / fields_draft / draft_rev /
--      draft_updated_at / draft_updated_by / fields_version (+ מזהה יציב לכל שלב
--      קיים), הטבלאות route_field_versions, option_lists, field_sets, והעמודה
--      item_routes.fields_version. metrics_schema_version עולה ל-4.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ את הקובץ הזה לפני העלאת ה-image החדש. ה-image החדש דורש
-- גרסת סכמה 4 ובלעדיה כל כתיבה (שמירת תוצאה, קליטה, התחלת בדיקה) עונה 503.
-- ה-image הקודם ממשיך לעבוד גם אחרי ההרצה (הכול תוספות).
-- שום עמדה לא משתנה עד שמנהל מפרסם שדות; פריטים קיימים נשארים בחלון הקבוע.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-route-station-fields.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
DECLARE v int;
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261013120000_route_station_fields') THEN
    RAISE EXCEPTION 'מיגרציית שדות בעמדות כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260915120000_package_model') THEN
    RAISE EXCEPTION 'מודל המארזים עוד לא הותקן (20260915120000_package_model חסרה) — להריץ קודם את scripts/prod-package-model. לא בוצע כלום.';
  END IF;
  SELECT version INTO v FROM metrics_schema_version WHERE id = 1;
  IF v IS NULL OR v < 3 THEN
    RAISE EXCEPTION 'metrics_schema_version = % (נדרש 3 לפחות). לא בוצע כלום.', coalesce(v::text, 'חסר');
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ===========================================================================
--  שדות בעמדות — השדות שהעובד ממלא בכל שלב במסלול
-- ===========================================================================
--
--  §1  testing_routes: step_uids (מזהה יציב לכל שלב, מקביל ל-route_steps),
--      fields_draft + draft_rev (טיוטה), fields_version (הגרסה המפורסמת)
--  §2  route_field_versions — היסטוריית פרסומים, בלתי ניתנת לשינוי
--  §3  option_lists, field_sets — רשימות אפשרויות וערכות שדות
--  §4  item_routes.fields_version — הגרסה שהפריט קיבל בקליטה
--  §5  metrics_schema_version → 4
--
--  תוספות בלבד. פריט עם item_routes.fields_version = NULL ועמדה בלי הגדרה
--  מפורסמת מקבלים את החלון הקבוע של היום.
--  אידמפוטנטי: הליך ה-air-gap מריץ קבצי מיגרציה שוב על DB קיים.
-- ===========================================================================

-- §1 -------------------------------------------------------------------------
ALTER TABLE "testing_routes" ADD COLUMN IF NOT EXISTS "step_uids"        TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "testing_routes" ADD COLUMN IF NOT EXISTS "fields_draft"     JSONB;
ALTER TABLE "testing_routes" ADD COLUMN IF NOT EXISTS "draft_rev"        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "testing_routes" ADD COLUMN IF NOT EXISTS "draft_updated_at" TIMESTAMPTZ(6);
ALTER TABLE "testing_routes" ADD COLUMN IF NOT EXISTS "draft_updated_by" VARCHAR(255);
ALTER TABLE "testing_routes" ADD COLUMN IF NOT EXISTS "fields_version"   INTEGER NOT NULL DEFAULT 0;

-- Backfill: every existing step gets a uid. Only rows that have none yet, so a
-- re-run never re-keys a route whose config already points at its uids.
UPDATE "testing_routes"
   SET "step_uids" = ARRAY(
         SELECT 's_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
           FROM generate_series(1, COALESCE(cardinality("route_steps"), 0)))
 WHERE COALESCE(cardinality("step_uids"), 0) = 0
   AND COALESCE(cardinality("route_steps"), 0) > 0;

-- §2 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "route_field_versions" (
    "id"                SERIAL NOT NULL,
    "test_route_id"     INTEGER NOT NULL,
    "version"           INTEGER NOT NULL,
    "config"            JSONB NOT NULL,
    "changes"           JSONB,
    "note"              TEXT,
    "apply_mode"        VARCHAR(20) NOT NULL,
    "publish_batch"     UUID NOT NULL,
    "published_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "published_by"      VARCHAR(255),
    "published_by_name" TEXT,
    CONSTRAINT "route_field_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "route_field_versions_version_chk" CHECK ("version" >= 1),
    CONSTRAINT "route_field_versions_apply_chk" CHECK ("apply_mode" IN ('new_only', 'not_reached'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "route_field_versions_route_version_uq" ON "route_field_versions"("test_route_id", "version");
CREATE INDEX IF NOT EXISTS "idx_route_field_versions_batch" ON "route_field_versions"("publish_batch");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_route_field_versions_route') THEN
    ALTER TABLE "route_field_versions" ADD CONSTRAINT "fk_route_field_versions_route"
      FOREIGN KEY ("test_route_id") REFERENCES "testing_routes"("test_route_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- §3 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "option_lists" (
    "id" SERIAL NOT NULL, "name" VARCHAR(100) NOT NULL, "options" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1, "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" VARCHAR(255),
    CONSTRAINT "option_lists_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "field_sets" (
    "id" SERIAL NOT NULL, "name" VARCHAR(100) NOT NULL, "fields" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1, "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" VARCHAR(255),
    CONSTRAINT "field_sets_pkey" PRIMARY KEY ("id")
);

-- §4 -------------------------------------------------------------------------
ALTER TABLE "item_routes" ADD COLUMN IF NOT EXISTS "fields_version" INTEGER;

-- §5 גרסת סכמה ----------------------------------------------------------------
-- The app's write gate (src/app/lib/metrics/schema-gate.ts) requires 4 from
-- this image on: result submits, intake, retype and package reset read or
-- write item_routes.fields_version, so an older database would fail every one
-- of them with a missing column. GREATEST: a re-run never lowers a later version.
UPDATE metrics_schema_version SET version = GREATEST(version, 4), applied_at = now() WHERE id = 1;

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'c0a9720b302e9de29cf3b78fb749dcb81df258de695a68a8a0e7b4b200f878dd', now(), '20261013120000_route_station_fields', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'metrics_schema_version' AS בדיקה, version::text AS תוצאה FROM metrics_schema_version WHERE id = 1
UNION ALL
SELECT 'מסלולים עם שלבים', count(*)::text FROM testing_routes WHERE coalesce(cardinality(route_steps), 0) > 0
UNION ALL
SELECT 'מסלולים שקיבלו מזהה לכל שלב', count(*)::text FROM testing_routes
 WHERE coalesce(cardinality(route_steps), 0) > 0 AND cardinality(step_uids) = cardinality(route_steps)
UNION ALL
SELECT 'טבלאות חדשות', string_agg(table_name, ', ' ORDER BY table_name) FROM information_schema.tables
 WHERE table_name IN ('route_field_versions', 'option_lists', 'field_sets')
UNION ALL
SELECT 'item_routes.fields_version', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
 WHERE table_name = 'item_routes' AND column_name = 'fields_version') THEN 'קיימת' ELSE 'חסרה' END
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261013120000_route_station_fields';
