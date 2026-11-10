-- ============================================================================
-- Every report template asks for both signatures (docs/ITEM_REPORTS.md):
-- the closing signature (given at the kit's closing, before "סגור מארז") and the
-- approver's final one (on the item page; it locks the report).
--
-- For the general template and every route's own template:
--   * no closing signature block → one is inserted right before the first final
--     signature block, with a "בודק" role cell first; and that final block, when
--     it has cells but no text cell, gets a "מאשר סופי" role cell first — so the
--     two rows tell apart;
--   * no final signature block → one is appended (after the closing one, which
--     is appended too when missing).
-- A template that already has a closing block is left as its author arranged it.
-- Only top-level blocks are looked at (signature blocks are never nested).
--
-- Reports already final are frozen PDFs and do not change. A finished report
-- still waiting for its final signature prints the closing row blank (the
-- closing it would have been given at is over).
--
-- Data only, no schema change. Idempotent: a second run finds both blocks and
-- changes nothing.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.report_with_both_signatures(t jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  content     jsonb := t->'content';
  out_content jsonb := '[]'::jsonb;
  n           jsonb;
  has_closing boolean;
  has_final   boolean;
  inserted    boolean := false;
  closing_block jsonb := '{"type": "Signature", "props": {"id": "Signature-closing-auto", "bind": "closing", "width": "full", "cells": [
      {"kind": "text", "label": "תפקיד", "text": "בודק", "weight": 1},
      {"kind": "fullName", "label": "שם ושם משפחה", "text": "", "weight": 1},
      {"kind": "number", "label": "מספר עובד", "text": "", "weight": 1},
      {"kind": "date", "label": "תאריך", "text": "", "weight": 1},
      {"kind": "signature", "label": "חתימה", "text": "", "weight": 1}]}}'::jsonb;
  final_block jsonb := '{"type": "Signature", "props": {"id": "Signature-final-auto", "bind": "final", "width": "full", "cells": [
      {"kind": "text", "label": "תפקיד", "text": "מאשר סופי", "weight": 1},
      {"kind": "fullName", "label": "שם ושם משפחה", "text": "", "weight": 1},
      {"kind": "number", "label": "מספר עובד", "text": "", "weight": 1},
      {"kind": "date", "label": "תאריך", "text": "", "weight": 1},
      {"kind": "signature", "label": "חתימה", "text": "", "weight": 1}]}}'::jsonb;
  final_role  jsonb := '{"kind": "text", "label": "תפקיד", "text": "מאשר סופי", "weight": 1}'::jsonb;
BEGIN
  IF t IS NULL OR jsonb_typeof(content) IS DISTINCT FROM 'array' THEN
    RETURN t;
  END IF;
  has_closing := EXISTS (SELECT 1 FROM jsonb_array_elements(content) e WHERE e->>'type' = 'Signature' AND e->'props'->>'bind' = 'closing');
  has_final   := EXISTS (SELECT 1 FROM jsonb_array_elements(content) e WHERE e->>'type' = 'Signature' AND e->'props'->>'bind' = 'final');
  IF has_closing AND has_final THEN
    RETURN t;
  END IF;

  FOR n IN SELECT e.value FROM jsonb_array_elements(content) WITH ORDINALITY AS e(value, i) ORDER BY e.i LOOP
    IF NOT has_closing AND NOT inserted AND n->>'type' = 'Signature' AND n->'props'->>'bind' = 'final' THEN
      out_content := out_content || jsonb_build_array(closing_block);
      inserted := true;
      IF jsonb_typeof(n->'props'->'cells') = 'array' AND jsonb_array_length(n->'props'->'cells') > 0
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(n->'props'->'cells') c WHERE c->>'kind' = 'text') THEN
        n := jsonb_set(n, '{props,cells}', jsonb_build_array(final_role) || (n->'props'->'cells'));
      END IF;
    END IF;
    out_content := out_content || jsonb_build_array(n);
  END LOOP;

  IF NOT has_final THEN
    IF NOT has_closing THEN
      out_content := out_content || jsonb_build_array(closing_block);
    END IF;
    out_content := out_content || jsonb_build_array(final_block);
  END IF;
  RETURN jsonb_set(t, '{content}', out_content);
END
$fn$;

UPDATE "report_general_template"
   SET "template" = pg_temp.report_with_both_signatures("template"::jsonb),
       "updated_at" = CURRENT_TIMESTAMP,
       "updated_by" = 'migration',
       "updated_by_name" = 'עדכון מערכת: שתי חתימות'
 WHERE pg_temp.report_with_both_signatures("template"::jsonb) IS DISTINCT FROM "template"::jsonb;

UPDATE "report_templates"
   SET "template" = pg_temp.report_with_both_signatures("template"::jsonb),
       "updated_at" = CURRENT_TIMESTAMP,
       "updated_by" = 'migration',
       "updated_by_name" = 'עדכון מערכת: שתי חתימות'
 WHERE pg_temp.report_with_both_signatures("template"::jsonb) IS DISTINCT FROM "template"::jsonb;

DROP FUNCTION pg_temp.report_with_both_signatures(jsonb);
