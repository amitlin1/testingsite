-- =============================================================================
-- 03 — סידור הנתונים אחרי מיגרציית המארזים (docs/packages/PLAN.md §8)
-- =============================================================================
-- מריצים רק אחרי 02-migrate-production.sql, ורק כשהאפליקציה עצורה.
--
-- מה הסקריפט עושה, לפי סדר (כל שלב כותב שורות לדוח):
--   1. מוחק שורות item_routes יתומות (פריט שכבר לא קיים).
--   2. מוודא שסטטוס 6 "ממתין לפריטי המארז" קיים.
--   3. מסמן את סוג עמדת הפתיחה ואת סוג עמדת הסגירה כ-package_level, ומוריד
--      את הדגל מכל השאר.
--   4. יוצר את סוגי המארז ותכולותיהם (CONFIG), ואת סוגי הפריט של התכולה אם
--      חסרים. לכל סוג מארז מסלול 1 = [פתיחה, סגירה].
--   5. מתקן את מסלולי הפריטים של התכולה ושל הסוגים הישנים: מתחילים בפתיחה,
--      מסתיימים בסגירה, בלי עמדה ברמת מארז באמצע, בלי הסוגים שב-CONFIG להסרה.
--   6. משלוחים: שורת הצהרה של סוג ישן ממופה → סוג המארז שלו (אותה כמות: מוצר
--      אחד = קופסה אחת); שורת הצהרה של סוג תכולה נמחקת; הכמות הכוללת מחושבת.
--   7. ממיר כל קבוצה ישנה (פריט אב + ילדיו, או פריט בודד) למארז: מזהים
--      חדשים בפורמט 1CCCddMMyyNNNNSS לפי יום הקליטה המקורי, מסלולים חדשים
--      בשלב 1, ה-ledger נרשם מחדש, קבצים ורשומות מחקר עוברים למזהה החדש,
--      השורות הישנות נמחקות. קבוצה שנגעו בה (תוצאות / היסטוריה) מדווחת ונשארת.
--   8. סיכום.
--
-- הרצה ב-DBeaver: כל הקובץ עם Alt+X. הכול בטרנזקציה אחת.
--   * השורה האחרונה בקובץ היא ROLLBACK; — כך זו הרצה יבשה: רואים את הדוח
--     (שתי לשוניות תוצאה: הדוח, ומיפוי המזהים ישן→חדש) ושום דבר לא נשמר.
--   * כשהדוח נראה נכון: להחליף את ROLLBACK; ב-COMMIT; ולהריץ שוב.
--   * אחרי COMMIT לשמור את לשונית מיפוי המזהים (Export → CSV) — זה המקור
--     להדפסת המדבקות החדשות.
--   * שגיאה באמצע מבטלת הכול; אם DBeaver נשאר בטרנזקציה, להריץ ROLLBACK;.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS fix_report;
CREATE TEMP TABLE fix_report (ord serial, step text, detail text);
DROP TABLE IF EXISTS fix_idmap;
CREATE TEMP TABLE fix_idmap (legacy_id bigint, new_id bigint, package_id bigint, package_seq int, item_type text, serial_no text, shipment_code text);
DROP TABLE IF EXISTS fix_group;
CREATE TEMP TABLE fix_group (
  item_id bigint, customer_id int, item_type_id int, type_desc text, shipment_id int, serial_no text, makat text,
  model text, manufacturer_name text, manufacturer_no text, current_status int, current_route_step int,
  is_finished boolean, route_number int, created_at timestamp, queue_start_time timestamp, ord int, new_route_number int
);

DO $fix$
DECLARE
  -- ======================= CONFIG — ערוך כאן =================================
  -- סוג העמדה שפותח מארז (שלב 1 של כל מסלול) וסוג העמדה שסוגר אותו (השלב האחרון).
  cfg_opening_type text := 'צילום';
  cfg_closing_type text := 'אריזה';
  -- סוגי עמדה שמוסרים ממסלולי הפריטים (לא יכולים לשבת אחרי הסגירה).
  cfg_remove_from_item_routes text[] := ARRAY['דוח סופי'];
  -- סוגי המארז ותכולתם. סוג פריט שלא קיים ייווצר.
  cfg_packages jsonb := '[
    {"name": "מארז מחשב",        "contents": [{"type": "מחשב", "qty": 1}, {"type": "עכבר", "qty": 1}, {"type": "מקלדת", "qty": 1}]},
    {"name": "מארז KVM 4 PORTS", "contents": [{"type": "KVM 4 PORTS", "qty": 1}]},
    {"name": "מארז KVM 8 PORTS", "contents": [{"type": "KVM 8 PORTS", "qty": 1}]}
  ]';
  -- סוג פריט ישן ברמה העליונה → סוג המארז שכל פריט כזה הופך אליו (קופסה לכל פריט).
  cfg_legacy_map jsonb := '{"KVM 4 PORTS": "מארז KVM 4 PORTS", "KVM 8 PORTS": "מארז KVM 8 PORTS"}';
  -- פריט שנשלח למחקר מהתור (סטטוס 4, שלב 1, בלי תוצאות): 'reset' = ממירים
  -- ומחזירים לממתין (רשומות המחקר עוברות למזהה החדש); 'skip' = משאירים כמו שהוא.
  cfg_research_policy text := 'reset';
  -- פריט עם קבצים מצורפים: 'move' = הקבצים עוברים למזהה החדש; 'skip' = לא ממירים.
  cfg_files_policy text := 'move';
  -- שורת מסלול של פריט שלא קיים: למחוק (true) או רק לדווח (false).
  cfg_delete_orphan_routes boolean := true;
  -- true = אם קבוצה כלשהי חסומה, לא לשמור כלום.
  cfg_strict boolean := false;
  -- ============================================================================

  v_open int; v_close int; v_pkg_levels int[];
  r record; g record; ln record; x record;
  v_n int; v_txt text; v_id int; v_ct int; v_sort int;
  v_steps int[]; v_new_steps int[]; v_mid int[];
  v_content_types int[] := '{}'; v_mapped_types int[] := '{}';
  v_target text; v_pkg_type int; v_problems text[]; v_rows int;
  v_date_part text; v_date_key date; v_counter int; v_base text; v_package_id bigint; v_new_id bigint;
  v_station int; v_pkg_steps int[]; v_item_steps int[]; v_line_route int;
  v_blocked int := 0; v_converted int := 0; v_seq int;
  v_template jsonb;
BEGIN
  -- --------------------------------------------------------------- 0. תנאים
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'package_id') THEN
    RAISE EXCEPTION 'הסכימה עדיין ישנה — הרץ קודם את 02-migrate-production.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'metrics_forget_item') OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'metrics_record') THEN
    RAISE EXCEPTION 'פונקציות ה-ledger (metrics_forget_item / metrics_record) חסרות';
  END IF;
  IF cfg_research_policy NOT IN ('reset', 'skip') OR cfg_files_policy NOT IN ('move', 'skip') THEN
    RAISE EXCEPTION 'CONFIG: ערך לא חוקי ב-cfg_research_policy / cfg_files_policy';
  END IF;
  INSERT INTO fix_report(step, detail) VALUES ('0 סביבה', current_database() || ' · ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');

  -- ------------------------------------------------- 1. שורות מסלול יתומות
  FOR r IN SELECT ir.item_id FROM item_routes ir WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.item_id = ir.item_id) LOOP
    IF cfg_delete_orphan_routes THEN
      PERFORM metrics_forget_item(r.item_id);
      DELETE FROM item_routes WHERE item_id = r.item_id;
      INSERT INTO fix_report(step, detail) VALUES ('1 שורות מסלול יתומות', 'נמחקה שורת מסלול (וה-ledger) של פריט שלא קיים: ' || r.item_id);
    ELSE
      INSERT INTO fix_report(step, detail) VALUES ('1 שורות מסלול יתומות', 'נמצאה ולא נמחקה (cfg): ' || r.item_id);
    END IF;
  END LOOP;

  -- ------------------------------------------------------------ 2. סטטוס 6
  SELECT TRIM(item_status_desc) INTO v_txt FROM item_status WHERE item_status_id = 6;
  IF v_txt IS NULL THEN
    INSERT INTO item_status (item_status_id, item_status_desc) VALUES (6, 'ממתין לפריטי המארז');
    INSERT INTO fix_report(step, detail) VALUES ('2 סטטוסים', 'נוסף סטטוס 6 "ממתין לפריטי המארז"');
  ELSIF v_txt <> 'ממתין לפריטי המארז' THEN
    RAISE EXCEPTION 'סטטוס 6 תפוס בשם "%" — יש לפנות אותו', v_txt;
  ELSE
    INSERT INTO fix_report(step, detail) VALUES ('2 סטטוסים', 'סטטוס 6 קיים');
  END IF;

  -- ------------------------------------------------- 3. עמדות ברמת מארז
  SELECT test_station_type_id INTO v_open  FROM test_stations_type WHERE TRIM(test_type_desc) = cfg_opening_type;
  SELECT test_station_type_id INTO v_close FROM test_stations_type WHERE TRIM(test_type_desc) = cfg_closing_type;
  IF v_open IS NULL THEN RAISE EXCEPTION 'CONFIG: סוג עמדת הפתיחה "%" לא קיים', cfg_opening_type; END IF;
  IF v_close IS NULL THEN RAISE EXCEPTION 'CONFIG: סוג עמדת הסגירה "%" לא קיים', cfg_closing_type; END IF;
  IF v_open = v_close THEN RAISE EXCEPTION 'CONFIG: הפתיחה והסגירה חייבות להיות שני סוגי עמדה שונים'; END IF;
  IF NOT EXISTS (SELECT 1 FROM test_stations WHERE test_station_type_id = v_open AND status <> 3) THEN
    RAISE EXCEPTION 'אין אף עמדה פעילה מסוג הפתיחה "%"', cfg_opening_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM test_stations WHERE test_station_type_id = v_close AND status <> 3) THEN
    RAISE EXCEPTION 'אין אף עמדה פעילה מסוג הסגירה "%"', cfg_closing_type;
  END IF;
  FOR r IN SELECT test_station_type_id AS id, TRIM(test_type_desc) AS d, package_level AS old_flag FROM test_stations_type ORDER BY 1 LOOP
    IF (r.id IN (v_open, v_close)) <> r.old_flag THEN
      UPDATE test_stations_type SET package_level = (r.id IN (v_open, v_close)) WHERE test_station_type_id = r.id;
      INSERT INTO fix_report(step, detail) VALUES ('3 עמדות ברמת מארז', '#' || r.id || ' ' || r.d || ': package_level ' || r.old_flag || ' → ' || (r.id IN (v_open, v_close)));
    END IF;
  END LOOP;
  v_pkg_levels := ARRAY[v_open, v_close];
  INSERT INTO fix_report(step, detail) VALUES ('3 עמדות ברמת מארז', 'פתיחה = #' || v_open || ' ' || cfg_opening_type || ' · סגירה = #' || v_close || ' ' || cfg_closing_type);

  -- ------------------------------------------- 4. סוגי מארז ותכולה ומסלולם
  FOR r IN SELECT value AS pkg FROM jsonb_array_elements(cfg_packages) LOOP
    v_txt := r.pkg ->> 'name';
    IF v_txt IS NULL OR length(v_txt) > 50 THEN RAISE EXCEPTION 'CONFIG: שם סוג מארז חסר או ארוך מ-50: %', v_txt; END IF;
    SELECT item_type_id INTO v_id FROM item_types WHERE TRIM(item_type_desc) = v_txt;
    IF v_id IS NULL THEN
      INSERT INTO item_types (item_type_desc, is_package) VALUES (v_txt, true) RETURNING item_type_id INTO v_id;
      INSERT INTO fix_report(step, detail) VALUES ('4 סוגי מארז', 'נוצר סוג מארז #' || v_id || ' "' || v_txt || '"');
    ELSE
      UPDATE item_types SET is_package = true WHERE item_type_id = v_id AND NOT is_package;
      INSERT INTO fix_report(step, detail) VALUES ('4 סוגי מארז', 'סוג מארז #' || v_id || ' "' || v_txt || '" קיים' || CASE WHEN FOUND THEN ' · סומן is_package' ELSE '' END);
    END IF;
    IF EXISTS (SELECT 1 FROM items WHERE item_type_id = v_id AND package_id IS NOT NULL) THEN
      RAISE EXCEPTION 'סוג המארז "%" משמש פריטים בתוך מארזים — לא יכול להיות סוג מארז', v_txt;
    END IF;

    v_sort := 0;
    FOR ln IN SELECT value AS line FROM jsonb_array_elements(r.pkg -> 'contents') LOOP
      v_txt := ln.line ->> 'type';
      IF v_txt IS NULL OR length(v_txt) > 50 THEN RAISE EXCEPTION 'CONFIG: שם סוג תכולה חסר או ארוך מ-50: %', v_txt; END IF;
      SELECT item_type_id INTO v_ct FROM item_types WHERE TRIM(item_type_desc) = v_txt;
      IF v_ct IS NULL THEN
        INSERT INTO item_types (item_type_desc, is_package) VALUES (v_txt, false) RETURNING item_type_id INTO v_ct;
        INSERT INTO fix_report(step, detail) VALUES ('4 סוגי מארז', 'נוצר סוג פריט #' || v_ct || ' "' || v_txt || '" (תכולה)');
      END IF;
      IF (SELECT is_package FROM item_types WHERE item_type_id = v_ct) THEN
        RAISE EXCEPTION 'CONFIG: "%" הוא סוג מארז ולא יכול להיות תכולה', v_txt;
      END IF;
      INSERT INTO package_contents (package_type_id, item_type_id, quantity, route_number, sort_order)
      VALUES (v_id, v_ct, GREATEST(COALESCE((ln.line ->> 'qty')::int, 1), 1), 1, v_sort)
      ON CONFLICT (package_type_id, item_type_id) DO UPDATE SET quantity = EXCLUDED.quantity, sort_order = EXCLUDED.sort_order;
      v_content_types := array_append(v_content_types, v_ct);
      v_sort := v_sort + 1;
    END LOOP;
    INSERT INTO fix_report(step, detail) VALUES ('4 סוגי מארז', '"' || (r.pkg ->> 'name') || '" תכולה: ' ||
      (SELECT string_agg(TRIM(it.item_type_desc) || ' ×' || pc.quantity, ', ' ORDER BY pc.sort_order)
         FROM package_contents pc JOIN item_types it ON it.item_type_id = pc.item_type_id WHERE pc.package_type_id = v_id));

    -- מסלול המארז: [פתיחה, סגירה]
    SELECT route_steps INTO v_steps FROM testing_routes WHERE item_type_id = v_id AND route_number = 1;
    IF NOT FOUND THEN
      INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number) VALUES (v_id, v_open, ARRAY[v_open, v_close], 1);
      INSERT INTO fix_report(step, detail) VALUES ('4 סוגי מארז', 'מסלול 1 של "' || (r.pkg ->> 'name') || '" נוצר: ' || v_open || '→' || v_close);
    ELSIF v_steps IS DISTINCT FROM ARRAY[v_open, v_close] THEN
      UPDATE testing_routes SET route_steps = ARRAY[v_open, v_close], test_station_type_id = v_open WHERE item_type_id = v_id AND route_number = 1;
      INSERT INTO fix_report(step, detail) VALUES ('4 סוגי מארז', 'מסלול 1 של "' || (r.pkg ->> 'name') || '" תוקן: ' || array_to_string(v_steps, '→') || ' ⇒ ' || v_open || '→' || v_close);
    END IF;
  END LOOP;

  -- הסוגים הישנים שממופים (המפתחות של cfg_legacy_map)
  FOR r IN SELECT key AS legacy, value AS target FROM jsonb_each_text(cfg_legacy_map) LOOP
    SELECT item_type_id INTO v_id FROM item_types WHERE TRIM(item_type_desc) = r.legacy;
    IF v_id IS NULL THEN RAISE EXCEPTION 'CONFIG: סוג ישן "%" לא קיים', r.legacy; END IF;
    IF NOT EXISTS (SELECT 1 FROM item_types WHERE TRIM(item_type_desc) = r.target AND is_package) THEN
      RAISE EXCEPTION 'CONFIG: יעד המיפוי "%" אינו סוג מארז מוגדר', r.target;
    END IF;
    v_mapped_types := array_append(v_mapped_types, v_id);
  END LOOP;

  -- ----------------------------------------------- 5. מסלולי הפריטים
  FOR r IN SELECT tr.test_route_id, tr.item_type_id, TRIM(it.item_type_desc) AS d, tr.route_number, tr.route_steps
             FROM testing_routes tr JOIN item_types it ON it.item_type_id = tr.item_type_id
            WHERE NOT it.is_package AND (tr.item_type_id = ANY (v_content_types) OR tr.item_type_id = ANY (v_mapped_types))
            ORDER BY 2, 4
  LOOP
    -- האמצע: בלי הסוגים להסרה, בלי עמדות ברמת מארז; ואז פתיחה בהתחלה וסגירה בסוף.
    SELECT COALESCE(array_agg(s ORDER BY o), '{}') INTO v_mid
      FROM unnest(COALESCE(r.route_steps, '{}')) WITH ORDINALITY u(s, o)
     WHERE s <> ALL (v_pkg_levels)
       AND s NOT IN (SELECT test_station_type_id FROM test_stations_type WHERE TRIM(test_type_desc) = ANY (cfg_remove_from_item_routes));
    v_new_steps := ARRAY[v_open] || v_mid || ARRAY[v_close];
    IF v_new_steps IS DISTINCT FROM r.route_steps THEN
      UPDATE testing_routes SET route_steps = v_new_steps, test_station_type_id = v_open WHERE test_route_id = r.test_route_id;
      INSERT INTO fix_report(step, detail) VALUES ('5 מסלולי פריטים', '#' || r.item_type_id || ' ' || r.d || ' · מסלול ' || r.route_number || ': ' || array_to_string(r.route_steps, '→') || ' ⇒ ' || array_to_string(v_new_steps, '→'));
    END IF;
  END LOOP;
  FOR r IN SELECT DISTINCT t.item_type_id, TRIM(it.item_type_desc) AS d
             FROM unnest(v_content_types || v_mapped_types) t(item_type_id) JOIN item_types it ON it.item_type_id = t.item_type_id
            WHERE NOT EXISTS (SELECT 1 FROM testing_routes tr WHERE tr.item_type_id = t.item_type_id AND tr.route_number = 1)
  LOOP
    INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number) VALUES (r.item_type_id, v_open, ARRAY[v_open, v_close], 1);
    INSERT INTO fix_report(step, detail) VALUES ('5 מסלולי פריטים', '#' || r.item_type_id || ' ' || r.d || ' · מסלול 1 נוצר: ' || v_open || '→' || v_close || ' (אין שלבים באמצע — להשלים בהגדרות)');
  END LOOP;

  -- ------------------------------------------------------------ 6. משלוחים
  FOR r IN SELECT s.id, s.shipment_code, s.amount FROM shipments s ORDER BY s.id LOOP
    FOR ln IN SELECT si.id AS line_id, si.item_type_id, TRIM(it.item_type_desc) AS d, si.quantity, it.is_package
                FROM shipment_items si JOIN item_types it ON it.item_type_id = si.item_type_id WHERE si.shipment_id = r.id ORDER BY si.id
    LOOP
      IF ln.is_package THEN CONTINUE; END IF;
      v_target := cfg_legacy_map ->> ln.d;
      IF v_target IS NOT NULL THEN
        SELECT item_type_id INTO v_pkg_type FROM item_types WHERE TRIM(item_type_desc) = v_target AND is_package;
        UPDATE shipment_items SET item_type_id = v_pkg_type WHERE id = ln.line_id;
        INSERT INTO fix_report(step, detail) VALUES ('6 משלוחים', r.shipment_code || ': הצהרה "' || ln.d || '" ×' || ln.quantity || ' ⇒ "' || v_target || '" ×' || ln.quantity);
      ELSIF ln.item_type_id = ANY (v_content_types) THEN
        DELETE FROM shipment_items WHERE id = ln.line_id;
        INSERT INTO fix_report(step, detail) VALUES ('6 משלוחים', r.shipment_code || ': הצהרה "' || ln.d || '" ×' || ln.quantity || ' נמחקה (סוג תכולה, נספר בתוך המארז)');
      ELSE
        INSERT INTO fix_report(step, detail) VALUES ('6 משלוחים', '!! ' || r.shipment_code || ': הצהרה "' || ln.d || '" ×' || ln.quantity || ' מסוג שאינו מארז ואינו ממופה — נשארה; העריכה במסך תידחה עד שתמופה');
      END IF;
    END LOOP;
    SELECT COALESCE(sum(quantity), 0) INTO v_n FROM shipment_items WHERE shipment_id = r.id;
    IF v_n <> COALESCE(r.amount, 0) THEN
      UPDATE shipments SET amount = v_n WHERE id = r.id;
      INSERT INTO fix_report(step, detail) VALUES ('6 משלוחים', r.shipment_code || ': כמות כוללת ' || COALESCE(r.amount, 0) || ' ⇒ ' || v_n || ' מארזים');
    END IF;
  END LOOP;

  -- ------------------------------------------------- 7. המרת הקבוצות הישנות
  FOR g IN SELECT i.item_id, i.customer_id, i.item_type_id, TRIM(it.item_type_desc) AS type_desc, i.shipment_id, i.makat,
                  TRIM(COALESCE(s.makat, '')) AS shipment_makat, s.shipment_code,
                  ir.current_status, ir.current_route_step, ir.is_finished, ir.created_at, ir.queue_start_time,
                  to_char(ir.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jerusalem', 'DDMMYY') AS date_part,
                  (ir.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jerusalem')::date AS date_key
             FROM items i
             JOIN item_types it ON it.item_type_id = i.item_type_id
             LEFT JOIN item_routes ir ON ir.item_id = i.item_id
             LEFT JOIN shipments s ON s.id = i.shipment_id
            WHERE i.package_id IS NULL AND NOT it.is_package
            ORDER BY i.item_id
  LOOP
    v_problems := '{}';
    v_target := cfg_legacy_map ->> g.type_desc;
    v_pkg_type := NULL;
    IF v_target IS NULL THEN
      v_problems := array_append(v_problems, 'אין מיפוי לסוג "' || g.type_desc || '"');
    ELSE
      SELECT item_type_id INTO v_pkg_type FROM item_types WHERE TRIM(item_type_desc) = v_target AND is_package;
    END IF;
    IF g.customer_id > 999 THEN v_problems := array_append(v_problems, 'לקוח ' || g.customer_id || ' לא נכנס ל-3 ספרות'); END IF;
    IF g.created_at IS NULL THEN v_problems := array_append(v_problems, 'אין שורת מסלול לפריט הראשי'); END IF;

    -- הקבוצה: הפריט הראשי ואחריו הילדים לפי מיקומם
    TRUNCATE fix_group;
    INSERT INTO fix_group
    SELECT i.item_id, i.customer_id, i.item_type_id, TRIM(it.item_type_desc), i.shipment_id, i.serial_no, i.makat,
           i.model, i.manufacturer_name, i.manufacturer_no, ir.current_status, ir.current_route_step, ir.is_finished,
           ir.route_number, ir.created_at, ir.queue_start_time,
           CASE WHEN i.item_id = g.item_id THEN 0 ELSE 1 END * 1000000 + COALESCE(i.package_seq, 0), NULL
      FROM items i JOIN item_types it ON it.item_type_id = i.item_type_id LEFT JOIN item_routes ir ON ir.item_id = i.item_id
     WHERE i.item_id = g.item_id OR i.package_id = g.item_id;
    SELECT count(*) INTO v_rows FROM fix_group;
    IF v_rows > 99 THEN v_problems := array_append(v_problems, v_rows || ' פריטים — מארז מכיל עד 99'); END IF;

    FOR x IN SELECT * FROM fix_group ORDER BY ord LOOP
      IF x.current_status IS NULL THEN
        v_problems := array_append(v_problems, x.item_id || ': אין שורת מסלול');
      ELSIF NOT ((x.current_status = 2 AND x.current_route_step = 1 AND NOT COALESCE(x.is_finished, false))
              OR (cfg_research_policy = 'reset' AND x.current_status = 4 AND x.current_route_step = 1 AND NOT COALESCE(x.is_finished, false))) THEN
        v_problems := array_append(v_problems, x.item_id || ': נגעו בו (סטטוס ' || x.current_status || ', שלב ' || x.current_route_step || CASE WHEN x.is_finished THEN ', הסתיים' ELSE '' END || ')');
      END IF;
      IF EXISTS (SELECT 1 FROM test_results t WHERE t.item_id = x.item_id) THEN v_problems := array_append(v_problems, x.item_id || ': יש תוצאות בדיקה'); END IF;
      IF EXISTS (SELECT 1 FROM item_route_history h WHERE h.item_id = x.item_id) THEN v_problems := array_append(v_problems, x.item_id || ': יש היסטוריית עמדות'); END IF;
      IF cfg_research_policy <> 'reset' AND EXISTS (SELECT 1 FROM research_history h WHERE h.item_id = x.item_id) THEN v_problems := array_append(v_problems, x.item_id || ': יש רשומות מחקר'); END IF;
      IF cfg_files_policy <> 'move' AND EXISTS (SELECT 1 FROM file_objects f WHERE f.entity_type = 'item_attachment' AND f.status <> 'deleted' AND f.entity_id = x.item_id::text) THEN
        v_problems := array_append(v_problems, x.item_id || ': יש קבצים מצורפים');
      END IF;
      IF (SELECT is_package FROM item_types WHERE item_type_id = x.item_type_id) THEN v_problems := array_append(v_problems, x.item_id || ': מסוג מארז'); END IF;
    END LOOP;

    -- התאמת מסלולים למארז
    IF v_pkg_type IS NOT NULL THEN
      SELECT route_steps INTO v_pkg_steps FROM testing_routes WHERE item_type_id = v_pkg_type AND route_number = 1;
      IF v_pkg_steps IS DISTINCT FROM ARRAY[v_open, v_close] THEN v_problems := array_append(v_problems, 'מסלול המארז אינו [פתיחה, סגירה]'); END IF;
      FOR x IN SELECT * FROM fix_group ORDER BY ord LOOP
        SELECT route_number INTO v_line_route FROM package_contents WHERE package_type_id = v_pkg_type AND item_type_id = x.item_type_id;
        v_line_route := COALESCE(v_line_route, 1);
        UPDATE fix_group SET new_route_number = v_line_route WHERE item_id = x.item_id;
        SELECT route_steps INTO v_item_steps FROM testing_routes WHERE item_type_id = x.item_type_id AND route_number = v_line_route;
        IF v_item_steps IS NULL OR array_length(v_item_steps, 1) < 2 THEN
          v_problems := array_append(v_problems, x.item_id || ' (' || x.type_desc || '): אין מסלול ' || v_line_route);
        ELSIF v_item_steps[1] <> v_open OR v_item_steps[array_length(v_item_steps, 1)] <> v_close
           OR EXISTS (SELECT 1 FROM unnest(v_item_steps[2:array_length(v_item_steps, 1) - 1]) s WHERE s = ANY (v_pkg_levels)) THEN
          v_problems := array_append(v_problems, x.item_id || ' (' || x.type_desc || '): מסלול ' || v_line_route || ' [' || array_to_string(v_item_steps, '→') || '] לא מתחיל בפתיחה / לא מסתיים בסגירה');
        END IF;
      END LOOP;
    END IF;

    IF array_length(v_problems, 1) > 0 THEN
      v_blocked := v_blocked + 1;
      INSERT INTO fix_report(step, detail) VALUES ('7 חסום', g.item_id || ' (' || g.type_desc || ', ' || v_rows || ' שורות): ' || array_to_string(v_problems, ' | '));
      CONTINUE;
    END IF;

    -- ---- ההמרה עצמה ----
    INSERT INTO daily_counters (date_key, counter) VALUES (g.date_key, 1)
    ON CONFLICT (date_key) DO UPDATE SET counter = daily_counters.counter + 1
    RETURNING counter INTO v_counter;
    IF v_counter > 9999 THEN RAISE EXCEPTION 'המונה היומי של % עבר 9999', g.date_key; END IF;
    v_base := '1' || lpad(g.customer_id::text, 3, '0') || g.date_part || lpad(v_counter::text, 4, '0');
    v_package_id := (v_base || '00')::bigint;

    SELECT test_station_id INTO v_station FROM test_stations
     WHERE test_station_type_id = v_open AND status <> 3 ORDER BY (status = 2) DESC, test_station_id LIMIT 1;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('item_type_id', item_type_id, 'quantity', quantity, 'makat', makat, 'model', model,
             'manufacturer_name', manufacturer_name, 'manufacturer_no', manufacturer_no, 'manufacturer_sku', manufacturer_sku,
             'route_number', route_number, 'sort_order', sort_order) ORDER BY sort_order, id), '[]'::jsonb)
      INTO v_template FROM package_contents WHERE package_type_id = v_pkg_type;

    INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model, manufacturer_name, manufacturer_no,
                       shipment_id, package_id, package_seq, package_next_seq, template_snapshot)
    VALUES (v_package_id, g.customer_id, v_pkg_type, NULL, COALESCE(NULLIF(g.shipment_makat, ''), TRIM(g.makat), ''), '', '', '',
            g.shipment_id, NULL, NULL, v_rows + 1, v_template);
    INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step, test_station_id, created_at, is_finished, queue_start_time, route_number)
    VALUES (v_package_id, v_pkg_type, 2, 1, v_station, g.created_at, false, COALESCE(g.queue_start_time, g.created_at), 1);

    v_seq := 0;
    FOR x IN SELECT * FROM fix_group ORDER BY ord LOOP
      v_seq := v_seq + 1;
      v_new_id := (v_base || lpad(v_seq::text, 2, '0'))::bigint;
      SELECT route_steps INTO v_item_steps FROM testing_routes WHERE item_type_id = x.item_type_id AND route_number = x.new_route_number;
      SELECT test_station_id INTO v_station FROM test_stations
       WHERE test_station_type_id = v_item_steps[1] AND status <> 3 ORDER BY (status = 2) DESC, test_station_id LIMIT 1;
      INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model, manufacturer_name, manufacturer_no, shipment_id, package_id, package_seq)
      VALUES (v_new_id, x.customer_id, x.item_type_id, x.serial_no, x.makat, x.model, x.manufacturer_name, COALESCE(x.manufacturer_no, ''), x.shipment_id, v_package_id, v_seq);
      INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step, test_station_id, created_at, is_finished, queue_start_time, route_number)
      VALUES (v_new_id, x.item_type_id, 2, 1, v_station, x.created_at, false, COALESCE(x.queue_start_time, x.created_at), x.new_route_number);

      UPDATE research_history SET item_id = v_new_id WHERE item_id = x.item_id;
      UPDATE file_objects SET entity_id = v_new_id::text WHERE entity_type = 'item_attachment' AND entity_id = x.item_id::text;

      INSERT INTO fix_idmap VALUES (x.item_id, v_new_id, v_package_id, v_seq, x.type_desc, x.serial_no, g.shipment_code);
    END LOOP;

    -- ledger: המזהים הישנים נשכחים, החדשים נולדים עכשיו בשלב 1
    FOR x IN SELECT item_id FROM fix_group LOOP PERFORM metrics_forget_item(x.item_id); END LOOP;
    PERFORM metrics_record('legacy_import:' || v_package_id, v_package_id, 'queued', 1, NULL, v_open, NULL, NULL, 'legacy_import');
    FOR x IN SELECT m.new_id, tr.route_steps[1] AS first_step
               FROM fix_idmap m JOIN items i ON i.item_id = m.new_id
               JOIN item_routes ir ON ir.item_id = m.new_id
               JOIN testing_routes tr ON tr.item_type_id = i.item_type_id AND tr.route_number = ir.route_number
              WHERE m.package_id = v_package_id
    LOOP
      PERFORM metrics_record('legacy_import:' || x.new_id, x.new_id, 'queued', 1, NULL, x.first_step, NULL, NULL, 'legacy_import');
    END LOOP;

    -- השורות הישנות: מסלולים, ילדים, ואז הראשי
    DELETE FROM item_routes WHERE item_id IN (SELECT item_id FROM fix_group);
    DELETE FROM items WHERE package_id = g.item_id;
    DELETE FROM items WHERE item_id = g.item_id;

    v_converted := v_converted + 1;
    INSERT INTO fix_report(step, detail) VALUES ('7 הומר', g.item_id || ' (' || g.type_desc || ') ⇒ מארז ' || v_package_id || ' "' || v_target || '" · ' || v_rows || ' פריטים · קליטה ' || g.date_key);
  END LOOP;

  -- ------------------------------------------------------------- 8. סיכום
  INSERT INTO fix_report(step, detail) VALUES ('8 סיכום', 'קבוצות שהומרו: ' || v_converted || ' · חסומות: ' || v_blocked);
  SELECT count(*) INTO v_n FROM items i JOIN item_types it ON it.item_type_id = i.item_type_id WHERE it.is_package AND i.package_id IS NULL;
  INSERT INTO fix_report(step, detail) VALUES ('8 סיכום', 'מארזים במערכת: ' || v_n);
  SELECT count(*) INTO v_n FROM items WHERE package_id IS NOT NULL;
  INSERT INTO fix_report(step, detail) VALUES ('8 סיכום', 'פריטים בתוך מארזים: ' || v_n);
  SELECT count(*) INTO v_n FROM items i JOIN item_types it ON it.item_type_id = i.item_type_id WHERE NOT it.is_package AND i.package_id IS NULL;
  INSERT INTO fix_report(step, detail) VALUES ('8 סיכום', 'פריטים ישנים שנשארו מחוץ למארז: ' || v_n);
  FOR r IN SELECT s.shipment_code, s.amount,
                  (SELECT count(*) FROM items i JOIN item_types it ON it.item_type_id = i.item_type_id WHERE i.shipment_id = s.id AND it.is_package AND i.package_id IS NULL) AS boxes
             FROM shipments s ORDER BY s.id
  LOOP
    INSERT INTO fix_report(step, detail) VALUES ('8 סיכום', 'משלוח ' || r.shipment_code || ': הוצהרו ' || r.amount || ' · נקלטו ' || r.boxes || ' מארזים');
  END LOOP;
  SELECT count(*) INTO v_n FROM (SELECT serial_no FROM items WHERE serial_no IS NOT NULL AND TRIM(serial_no) <> '' GROUP BY 1 HAVING count(*) > 1) d;
  IF v_n > 0 THEN INSERT INTO fix_report(step, detail) VALUES ('8 סיכום', 'לתשומת לב: ' || v_n || ' סריאלים כפולים (לא שונו)'); END IF;

  IF cfg_strict AND v_blocked > 0 THEN
    RAISE EXCEPTION 'cfg_strict: % קבוצות חסומות — לא נשמר כלום', v_blocked;
  END IF;
END
$fix$;

-- הדוח (לשונית 1) ומיפוי המזהים ישן→חדש (לשונית 2 — לשמור אחרי COMMIT)
SELECT step, detail FROM fix_report ORDER BY ord;
SELECT package_id, package_seq, new_id, legacy_id, item_type, serial_no, shipment_code FROM fix_idmap ORDER BY package_id, package_seq;

-- הרצה יבשה. כשהדוח נכון: להחליף ל-COMMIT; ולהריץ שוב.
ROLLBACK;
