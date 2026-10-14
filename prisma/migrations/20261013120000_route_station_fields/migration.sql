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
