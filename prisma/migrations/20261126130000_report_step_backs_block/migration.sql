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
