-- =============================================================================
-- בלוק "החזרות לבדיקה חוזרת" בתבניות דוח הפריט
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261126130000_report_step_backs_block/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: המיגרציה הקודמת (20261126120000_drop_sent_shipment_code) רשומה,
--      והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה: בתבנית הכללית ובכל תבנית של מסלול נוסף בלוק "החזרות לבדיקה חוזרת"
--      (מתי, מאיזה שלב לאיזה, מי החזיר והסיבה), מיד אחרי טבלת התוצאות / פירוט השלבים;
--      בלי אחד מהם — לפני החתימה הראשונה, ואם אין — בסוף. תבנית ריקה נשארת ריקה.
--      דוחות שכבר נחתמו סופית הם PDF קפוא ולא משתנים. נתונים בלבד, בלי שינוי סכמה.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש, אחרי 2026-11-26-drop-sent-shipment-code.
-- ה-image הקודם מדלג על סוג בלוק שהוא לא מכיר, כך שההרצה לא משנה שום דבר שהוא מדפיס.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-report-step-backs-block.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261126130000_report_step_backs_block') THEN
    RAISE EXCEPTION 'בלוק החזרות לבדיקה חוזרת כבר הוחל. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261126120000_drop_sent_shipment_code') THEN
    RAISE EXCEPTION 'המיגרציה הקודמת (20261126120000_drop_sent_shipment_code) חסרה — להריץ קודם את db/upgrades/2026-11-26-drop-sent-shipment-code. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- The item report lists every time the item was sent back to the test before
-- ("חזרה לבדיקה הקודמת"): when, from which step to which, who sent it back and
-- the reason they gave (required since this change, kept in the ledger event's
-- payload.reason). The new "StepBacks" block prints that table, and nothing on
-- an item that never went back.
--
-- For the general template and every route's own template without a StepBacks
-- block, one is inserted right after the last top-level ResultsTable /
-- StepDetails block; a template with neither gets it right before its first
-- Signature block, or at the end. An empty template (no blocks) is left empty —
-- its route keeps reporting with the general template.
--
-- Reports already final are frozen PDFs and do not change.
--
-- Data only, no schema change. The previous image skips a block type it does not
-- know (render-react), so running this before the new image changes nothing it
-- prints. Idempotent: a second run finds the block and changes nothing.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.report_with_step_backs(t jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  content     jsonb := t->'content';
  out_content jsonb := '[]'::jsonb;
  block       jsonb := '{"type": "StepBacks", "props": {"id": "StepBacks-auto", "showTitle": true, "width": "full"}}'::jsonb;
  after_i     bigint;
  sign_i      bigint;
  r           record;
BEGIN
  -- An empty template stays empty: its route reports with the general one (templateHasContent).
  IF t IS NULL OR jsonb_typeof(content) IS DISTINCT FROM 'array' OR jsonb_array_length(content) = 0 THEN
    RETURN t;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(content) e WHERE e->>'type' = 'StepBacks') THEN
    RETURN t;
  END IF;
  SELECT max(e.i) INTO after_i FROM jsonb_array_elements(content) WITH ORDINALITY AS e(value, i)
   WHERE e.value->>'type' IN ('ResultsTable', 'StepDetails');
  SELECT min(e.i) INTO sign_i FROM jsonb_array_elements(content) WITH ORDINALITY AS e(value, i)
   WHERE e.value->>'type' = 'Signature';

  FOR r IN SELECT e.value AS n, e.i FROM jsonb_array_elements(content) WITH ORDINALITY AS e(value, i) ORDER BY e.i LOOP
    IF after_i IS NULL AND sign_i IS NOT NULL AND r.i = sign_i THEN
      out_content := out_content || jsonb_build_array(block);
    END IF;
    out_content := out_content || jsonb_build_array(r.n);
    IF after_i IS NOT NULL AND r.i = after_i THEN
      out_content := out_content || jsonb_build_array(block);
    END IF;
  END LOOP;
  IF after_i IS NULL AND sign_i IS NULL THEN
    out_content := out_content || jsonb_build_array(block);
  END IF;
  RETURN jsonb_set(t, '{content}', out_content);
END
$fn$;

UPDATE "report_general_template"
   SET "template" = pg_temp.report_with_step_backs("template"::jsonb),
       "updated_at" = CURRENT_TIMESTAMP,
       "updated_by" = 'migration',
       "updated_by_name" = 'עדכון מערכת: החזרות לבדיקה חוזרת'
 WHERE pg_temp.report_with_step_backs("template"::jsonb) IS DISTINCT FROM "template"::jsonb;

UPDATE "report_templates"
   SET "template" = pg_temp.report_with_step_backs("template"::jsonb),
       "updated_at" = CURRENT_TIMESTAMP,
       "updated_by" = 'migration',
       "updated_by_name" = 'עדכון מערכת: החזרות לבדיקה חוזרת'
 WHERE pg_temp.report_with_step_backs("template"::jsonb) IS DISTINCT FROM "template"::jsonb;

DROP FUNCTION pg_temp.report_with_step_backs(jsonb);

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '93ef78696f7dae36b13a56a123ab85428b9e77152701933cb0e781ddbbb8ca54', now(), '20261126130000_report_step_backs_block', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'תבנית כללית עם בלוק החזרות (צריך 1 אם יש בה תוכן)' AS בדיקה, count(*)::text AS תוצאה
  FROM report_general_template
 WHERE "template"::jsonb->'content' @> '[{"type": "StepBacks"}]'::jsonb
UNION ALL
SELECT 'תבניות מסלול עם תוכן ובלי בלוק החזרות (צריך 0)', count(*)::text
  FROM report_templates
 WHERE jsonb_typeof("template"::jsonb->'content') = 'array'
   AND jsonb_array_length("template"::jsonb->'content') > 0
   AND NOT ("template"::jsonb->'content' @> '[{"type": "StepBacks"}]'::jsonb)
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261126130000_report_step_backs_block';
