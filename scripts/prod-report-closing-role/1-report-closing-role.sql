-- =============================================================================
-- תפקיד החותם בסגירת המארז: "בודק" או "מנהל" לפי מי שחתם
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261119120000_report_closing_signer_role/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: שתי החתימות כבר הותקנו (20261110130000_report_templates_both_signatures
--      רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה:
--      - עמודה חדשה ב-item_reports: closing_signed_by_role (ריקה בכל השורות הקיימות).
--      - בתבנית הכללית ובכל תבנית של מסלול: בשורת החתימה בסגירה, תא "תפקיד" שכתוב בו
--        בדיוק "בודק" הופך לתא "תפקיד החותם". תא שמישהו כתב בו טקסט אחר לא משתנה.
--        שורת החתימה הסופית ("מאשר סופי") לא משתנה. דוחות שכבר ננעלו לא משתנים.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ ממש לפני העלאת ה-image החדש. ה-image הקודם לא מכיר את התא החדש
-- ומדפיס אותו ריק, כך שבין ההרצה להעלאה שורת הבודק בטיוטה תופיע בלי תפקיד.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-report-closing-role.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261119120000_report_closing_signer_role') THEN
    RAISE EXCEPTION 'מיגרציית תפקיד החותם בסגירה כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261110130000_report_templates_both_signatures') THEN
    RAISE EXCEPTION 'שתי החתימות עוד לא הותקנו (20261110130000_report_templates_both_signatures חסרה) — להריץ קודם את scripts/prod-report-closing-signature. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- The closing signature's row prints the signer's own role (docs/ITEM_REPORTS.md):
-- "בודק" when a tester signed, "מנהל" when a manager did — taken from the
-- signed-in user's roles at the moment they sign, and kept with the signature.
--
--   * item_reports.closing_signed_by_role: the role, kept with the closing
--     signature. Empty for every closing signature given before this change —
--     those rows keep printing the text the template had ("בודק").
--   * In the general template and every route's own template, the closing
--     signature block's role cell — a free-text cell whose text is exactly
--     "בודק" (what the starters and 20261110130000 put there) — becomes a
--     "תפקיד החותם" cell (kind "role"), keeping "בודק" as what an older
--     signature without a kept role prints. A cell an author wrote other text
--     in is left as it is. The final signature's row ("מאשר סופי") is not
--     touched. Only top-level blocks are looked at (signature blocks are never
--     nested).
--
-- Reports already final are frozen PDFs and do not change.
--
-- Additive: the previous image never reads the column. It does not know the
-- "role" cell and prints it empty — so between running this and the new image a
-- draft's closing row shows no role; run it right before the new image.
-- Idempotent: a second run finds no "בודק" text cell in a closing block and
-- changes nothing.
-- ============================================================================

ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signed_by_role" VARCHAR(32);

CREATE OR REPLACE FUNCTION pg_temp.report_closing_role_cell(t jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  content     jsonb := t->'content';
  out_content jsonb := '[]'::jsonb;
  n           jsonb;
  cells       jsonb;
BEGIN
  IF t IS NULL OR jsonb_typeof(content) IS DISTINCT FROM 'array' THEN
    RETURN t;
  END IF;
  FOR n IN SELECT e.value FROM jsonb_array_elements(content) WITH ORDINALITY AS e(value, i) ORDER BY e.i LOOP
    IF n->>'type' = 'Signature' AND n->'props'->>'bind' = 'closing' AND jsonb_typeof(n->'props'->'cells') = 'array' THEN
      SELECT COALESCE(jsonb_agg(
               CASE WHEN c.value->>'kind' = 'text' AND btrim(c.value->>'text') = 'בודק'
                    THEN jsonb_set(c.value, '{kind}', '"role"')
                    ELSE c.value END
               ORDER BY c.i), '[]'::jsonb)
        INTO cells
        FROM jsonb_array_elements(n->'props'->'cells') WITH ORDINALITY AS c(value, i);
      n := jsonb_set(n, '{props,cells}', cells);
    END IF;
    out_content := out_content || jsonb_build_array(n);
  END LOOP;
  RETURN jsonb_set(t, '{content}', out_content);
END
$fn$;

UPDATE "report_general_template"
   SET "template" = pg_temp.report_closing_role_cell("template"::jsonb),
       "updated_at" = CURRENT_TIMESTAMP,
       "updated_by" = 'migration',
       "updated_by_name" = 'עדכון מערכת: תפקיד החותם בסגירה'
 WHERE pg_temp.report_closing_role_cell("template"::jsonb) IS DISTINCT FROM "template"::jsonb;

UPDATE "report_templates"
   SET "template" = pg_temp.report_closing_role_cell("template"::jsonb),
       "updated_at" = CURRENT_TIMESTAMP,
       "updated_by" = 'migration',
       "updated_by_name" = 'עדכון מערכת: תפקיד החותם בסגירה'
 WHERE pg_temp.report_closing_role_cell("template"::jsonb) IS DISTINCT FROM "template"::jsonb;

DROP FUNCTION pg_temp.report_closing_role_cell(jsonb);

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '77e0570962546021882ce72aa00f70059ae3f1407a991d1cab7174ed730702be', now(), '20261119120000_report_closing_signer_role', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודת תפקיד החותם' AS בדיקה, count(*)::text || ' מתוך 1' AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'item_reports' AND column_name = 'closing_signed_by_role'
UNION ALL
SELECT 'התבנית הכללית: תאי "תפקיד החותם" בשורת הסגירה', (SELECT count(*) FROM jsonb_array_elements(template::jsonb->'content') n, jsonb_array_elements(n->'props'->'cells') c
     WHERE n->>'type' = 'Signature' AND n->'props'->>'bind' = 'closing' AND c->>'kind' = 'role')::text
  FROM report_general_template
UNION ALL
SELECT 'מסלול ' || test_route_id || ': תאי "תפקיד החותם" בשורת הסגירה', (SELECT count(*) FROM jsonb_array_elements(template::jsonb->'content') n, jsonb_array_elements(n->'props'->'cells') c
     WHERE n->>'type' = 'Signature' AND n->'props'->>'bind' = 'closing' AND c->>'kind' = 'role')::text
  FROM report_templates
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261119120000_report_closing_signer_role';
