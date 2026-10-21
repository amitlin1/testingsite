-- =============================================================================
-- ייחוס מארז: פריט ייחוס של סוג מארז מחזיק פריט ייחוס לכל שורה בתכולה
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261021120000_reference_items_parent/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: טבלת פריטי הייחוס קיימת (20260709084717 רשומה), והמיגרציה
--      הזו עוד לא רשומה.
--   ב. המיגרציה (מבנה בלבד): עמודה חדשה reference_items.parent_reference_id —
--      ריקה בפריט ייחוס רגיל ובייחוס מארז, ומלאה בפריט ייחוס שבתוך ייחוס מארז.
--      מפתח זר לעצמה (מחיקת ייחוס מארז מוחקת את הפריטים שבו), ואינדקס ייחודי:
--      פריט ייחוס אחד לכל סוג פריט בתוך ייחוס מארז. אין שינוי בנתונים.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: אפשר להריץ בכל זמן לפני העלאת ה-image החדש — ה-image הקודם לא
-- קורא את העמודה. גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-reference-items-parent.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261021120000_reference_items_parent') THEN
    RAISE EXCEPTION 'מיגרציית ייחוס המארז כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260709084717_add_reference_items') THEN
    RAISE EXCEPTION 'טבלת פריטי הייחוס עוד לא הותקנה (20260709084717_add_reference_items חסרה). לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- reference_items: a package reference holds a reference item for each line
-- of its package type's contents.
--
-- WHY: a reference item of a package type described only the box. The
-- opening station now learns from the box label what should be inside it:
-- each content line gets its own reference item (SKU, weight, images), made
-- inside the package reference and owned by it — an "מחשב" in one package is
-- not the "מחשב" in another, so they are not shared with the regular screen.
--
-- parent_reference_id: NULL on a regular reference item and on a package
-- reference; set on a member, pointing at its package reference. Deleting the
-- package reference deletes its members (the app removes their images from
-- the RU bucket first; the cascade only drops rows). One member per content
-- line: unique on (parent_reference_id, item_type_id) — NULLs are distinct,
-- so regular items are not constrained by it.
--
-- Additive only: one nullable column, no data moves. Existing reference items
-- of package types become package references without members, and the opening
-- behaves as before for them. The previous image keeps working after it (it
-- never reads the column), so this runs any time before the new image. No
-- metrics_schema_version bump: the ledger does not read reference items.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

ALTER TABLE "reference_items" ADD COLUMN IF NOT EXISTS "parent_reference_id" INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_reference_items_parent') THEN
        ALTER TABLE "reference_items"
            ADD CONSTRAINT "fk_reference_items_parent"
            FOREIGN KEY ("parent_reference_id") REFERENCES "reference_items"("reference_item_id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "reference_items_parent_type_uq" ON "reference_items"("parent_reference_id", "item_type_id");

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'e32c207ab4fb9a751227e79f7e88bf63c778d343416a408c1c72df95ca9586d2', now(), '20261021120000_reference_items_parent', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודת parent_reference_id' AS בדיקה, count(*)::text AS תוצאה
  FROM information_schema.columns WHERE table_name = 'reference_items' AND column_name = 'parent_reference_id'
UNION ALL
SELECT 'מפתח זר fk_reference_items_parent', count(*)::text FROM pg_constraint WHERE conname = 'fk_reference_items_parent'
UNION ALL
SELECT 'אינדקס reference_items_parent_type_uq', count(*)::text FROM pg_indexes WHERE indexname = 'reference_items_parent_type_uq'
UNION ALL
SELECT 'פריטי ייחוס בתוך ייחוסי מארז (צריך להיות 0)', count(*)::text FROM reference_items WHERE parent_reference_id IS NOT NULL
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261021120000_reference_items_parent';
