-- =============================================================================
-- דוחות PDF לפריטים (תבנית לכל מסלול, דוח נעול לכל פריט)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261020120000_item_reports/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: שדות העמדות כבר הותקנו (20261013120000_route_station_fields
--      רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (תוספות בלבד): שתי טבלאות חדשות — report_templates (תבנית לכל
--      מסלול) ו-item_reports (הדוח הנעול של כל פריט). שום נתון קיים לא משתנה.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש. ה-image הקודם ממשיך לעבוד גם אחרי
-- ההרצה. גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-item-reports.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261020120000_item_reports') THEN
    RAISE EXCEPTION 'מיגרציית דוחות ה-PDF כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261013120000_route_station_fields') THEN
    RAISE EXCEPTION 'שדות העמדות עוד לא הותקנו (20261013120000_route_station_fields חסרה) — להריץ קודם את scripts/prod-route-fields. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- Item reports (docs/ITEM_REPORTS.md): a PDF report per item, built from a
-- per-route template with the results of every station the item passed.
--
--   report_templates  one Puck document per route (testing_routes)
--   item_reports      the item's FINAL report: the frozen PDF in MinIO and
--                     the signature it carries. Valid only while
--                     item_routes.finished_at still equals route_finished_at,
--                     so reopening an item needs no cleanup here.
--
-- Additive only: two new tables, nothing existing changes. The previous image
-- never reads them, so this runs any time before the new image. No
-- metrics_schema_version bump: the ledger does not read them.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "report_templates" (
    "id"              SERIAL       NOT NULL,
    "test_route_id"   INTEGER      NOT NULL,
    "template"        JSONB        NOT NULL,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by"      VARCHAR(255),
    "updated_by_name" TEXT,
    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "report_templates_test_route_id_key" ON "report_templates"("test_route_id");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_report_templates_route') THEN
        ALTER TABLE "report_templates"
            ADD CONSTRAINT "fk_report_templates_route"
            FOREIGN KEY ("test_route_id") REFERENCES "testing_routes"("test_route_id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "item_reports" (
    "item_id"            BIGINT        NOT NULL,
    "storage_key"        VARCHAR(1024),
    "size_bytes"         BIGINT        NOT NULL DEFAULT 0,
    "version"            INTEGER       NOT NULL DEFAULT 0,
    "generated_at"       TIMESTAMPTZ(6),
    "route_finished_at"  TIMESTAMP(6),
    "signature_key"      VARCHAR(1024),
    "signed_by"          VARCHAR(255),
    "signed_by_name"     TEXT,
    "signed_by_number"   VARCHAR(64),
    "signed_at"          TIMESTAMPTZ(6),
    "signed_finished_at" TIMESTAMP(6),
    CONSTRAINT "item_reports_pkey" PRIMARY KEY ("item_id")
);

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'fac9d2fe74de415d5d2cac90e8fc21e441d3203152b240df4343f399cdcbd4ea', now(), '20261020120000_item_reports', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'טבלאות חדשות' AS בדיקה, string_agg(table_name, ', ' ORDER BY table_name) AS תוצאה
  FROM information_schema.tables
 WHERE table_name IN ('report_templates', 'item_reports')
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261020120000_item_reports';
