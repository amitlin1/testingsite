-- =============================================================================
-- אישור גורם חיצוני לדוח שיצא "לא תקין"
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261126140000_report_external_approval/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: המיגרציה הקודמת (20261126120000_drop_sent_shipment_code) רשומה,
--      והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה:
--      - עמודות חדשות ב-item_reports: external_* (ריקות בכל השורות הקיימות) — שם הגורם
--        החיצוני, תפקיד/גוף, נימוק, החתימה, המנהל שהציג, מתי.
--      - בתבנית הכללית ובכל תבנית של מסלול: שורת חתימה "גורם חיצוני" מיד אחרי שורת
--        החתימה הסופית ("מאשר סופי"). היא מודפסת רק בדוח שאושר ע"י גורם חיצוני.
--        תבנית בלי שורת חתימה סופית לא משתנה. דוחות שכבר ננעלו לא משתנים.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ ממש לפני העלאת ה-image החדש. ה-image הקודם לא מכיר את השורה החדשה
-- ומדפיס אותה כשורת חתימה ריקה, כך שבין ההרצה להעלאה תופיע בטיוטות שורה ריקה נוספת.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-report-external-approval.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261126140000_report_external_approval') THEN
    RAISE EXCEPTION 'מיגרציית האישור החיצוני כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261126120000_drop_sent_shipment_code') THEN
    RAISE EXCEPTION 'המיגרציה הקודמת (20261126120000_drop_sent_shipment_code) חסרה — להריץ קודם את db/upgrades/2026-11-26-drop-sent-shipment-code. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- An external approval of a report that came out "לא תקין" (docs/features/ITEM_REPORTS.md):
-- someone outside the system examined the item and passes it, signing on the screen of the
-- manager who shows them the report. It stands for the final signature (it locks the report),
-- and the failed steps are passed with it (test_results.details.external_approval).
--
--   * item_reports.external_*: the approval — the approver's name, role / body and reason, the
--     drawn signature (MinIO key), the manager who showed the report, when, and the finish it was
--     given for (external_signed_finished_at = item_routes.finished_at, as the other signatures).
--   * In the general template and every route's own template, a "גורם חיצוני" signature row
--     (bind "external") right after the final signature's row. It prints only on a report an
--     external approver approved — there in place of the final row. A template without a final
--     signature row gets none (its report is frozen at the finish; nothing can approve it). Only
--     top-level blocks are looked at (signature blocks are never nested).
--
-- Reports already final are frozen PDFs and do not change.
--
-- Additive: the previous image never reads the columns, and does not know the "external" bind —
-- it prints that row as an empty signature row. Run it right before the new image.
-- Idempotent: a template that has an "external" row already is left as it is.
-- ============================================================================

ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "external_signature_key"      VARCHAR(1024);
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "external_signed_by_name"     TEXT;
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "external_signed_by_role"     TEXT;
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "external_note"               TEXT;
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "external_presented_by"       VARCHAR(255);
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "external_presented_by_name"  TEXT;
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "external_signed_at"          TIMESTAMPTZ(6);
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "external_signed_finished_at" TIMESTAMP(6);

CREATE OR REPLACE FUNCTION pg_temp.report_external_row(t jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  content     jsonb := t->'content';
  out_content jsonb := '[]'::jsonb;
  n           jsonb;
  i           bigint;
  last_final  bigint;
  row_block   jsonb := jsonb_build_object(
    'type', 'Signature',
    'props', jsonb_build_object(
      'id', 'Signature-external-approval',
      'bind', 'external',
      'cells', jsonb_build_array(
        jsonb_build_object('kind', 'role',      'label', 'תפקיד / גוף',  'text', 'גורם חיצוני', 'weight', 1),
        jsonb_build_object('kind', 'fullName',  'label', 'שם ושם משפחה', 'text', '',            'weight', 1),
        jsonb_build_object('kind', 'date',      'label', 'תאריך',        'text', '',            'weight', 1),
        jsonb_build_object('kind', 'signature', 'label', 'חתימה',        'text', '',            'weight', 1)
      ),
      'width', 'full'
    )
  );
BEGIN
  IF t IS NULL OR jsonb_typeof(content) IS DISTINCT FROM 'array' THEN
    RETURN t;
  END IF;
  -- Already there: nothing to do.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(content) e
              WHERE e->>'type' = 'Signature' AND e->'props'->>'bind' = 'external') THEN
    RETURN t;
  END IF;
  SELECT max(e.i) INTO last_final
    FROM jsonb_array_elements(content) WITH ORDINALITY AS e(value, i)
   WHERE e.value->>'type' = 'Signature' AND e.value->'props'->>'bind' = 'final';
  IF last_final IS NULL THEN
    RETURN t;
  END IF;
  FOR n, i IN SELECT e.value, e.i FROM jsonb_array_elements(content) WITH ORDINALITY AS e(value, i) ORDER BY e.i LOOP
    out_content := out_content || jsonb_build_array(n);
    IF i = last_final THEN
      out_content := out_content || jsonb_build_array(row_block);
    END IF;
  END LOOP;
  RETURN jsonb_set(t, '{content}', out_content);
END
$fn$;

UPDATE "report_general_template"
   SET "template" = pg_temp.report_external_row("template"::jsonb),
       "updated_at" = CURRENT_TIMESTAMP,
       "updated_by" = 'migration',
       "updated_by_name" = 'עדכון מערכת: חתימת גורם חיצוני'
 WHERE pg_temp.report_external_row("template"::jsonb) IS DISTINCT FROM "template"::jsonb;

UPDATE "report_templates"
   SET "template" = pg_temp.report_external_row("template"::jsonb),
       "updated_at" = CURRENT_TIMESTAMP,
       "updated_by" = 'migration',
       "updated_by_name" = 'עדכון מערכת: חתימת גורם חיצוני'
 WHERE pg_temp.report_external_row("template"::jsonb) IS DISTINCT FROM "template"::jsonb;

DROP FUNCTION pg_temp.report_external_row(jsonb);

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '3b3e4b91644efabcbc3c16bbf13e62eabfaf92d628e63ac8a5384da7c2afe261', now(), '20261126140000_report_external_approval', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודות האישור החיצוני' AS בדיקה, count(*)::text || ' מתוך 8' AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'item_reports' AND column_name LIKE 'external\_%'
UNION ALL
SELECT 'התבנית הכללית: שורות "גורם חיצוני" / "מאשר סופי"', (SELECT count(*) FROM jsonb_array_elements(template::jsonb->'content') n
     WHERE n->>'type' = 'Signature' AND n->'props'->>'bind' = 'external')::text || ' / ' || (SELECT count(*) FROM jsonb_array_elements(template::jsonb->'content') n
     WHERE n->>'type' = 'Signature' AND n->'props'->>'bind' = 'final')::text
  FROM report_general_template
UNION ALL
SELECT 'מסלול ' || test_route_id || ': שורות "גורם חיצוני" / "מאשר סופי"', (SELECT count(*) FROM jsonb_array_elements(template::jsonb->'content') n
     WHERE n->>'type' = 'Signature' AND n->'props'->>'bind' = 'external')::text || ' / ' || (SELECT count(*) FROM jsonb_array_elements(template::jsonb->'content') n
     WHERE n->>'type' = 'Signature' AND n->'props'->>'bind' = 'final')::text
  FROM report_templates
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261126140000_report_external_approval';
