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
