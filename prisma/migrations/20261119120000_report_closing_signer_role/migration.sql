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
