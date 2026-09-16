-- =============================================================================
-- אבחון נתוני ייצור לפני ההסבה למודל המארזים (docs/packages/PLAN.md §8)
-- =============================================================================
-- קריאה בלבד: אין כאן שום UPDATE / INSERT / DELETE / DDL על טבלאות אמיתיות.
-- הסקריפט בונה טבלה זמנית (נמחקת בסוף החיבור), ממלא אותה בשאילתות SELECT
-- בלבד, ומחזיר תוצאה אחת בסוף.
--
-- הוא מזהה לבד אם הסכימה עדיין ישנה (items.parent_item_id,
-- test_stations_type.parents_only) או כבר אחרי מיגרציית המארזים
-- (items.package_id, package_level), ומתאים את השאילתות.
--
-- איך להריץ (מומלץ, שומר את כל הפלט לקובץ):
--   psql -U <user> -d <db> -f 01-diagnose-production.sql -o findings.txt
-- או דרך הקונטיינר:
--   docker exec -i postgres psql -U <user> -d <db> < 01-diagnose-production.sql > findings.txt
-- ב-pgAdmin: להריץ את כל הקובץ כמו שהוא; הגריד שמוצג בסוף הוא כל הממצאים
-- (קובץ → Download as CSV).
-- =============================================================================

DROP TABLE IF EXISTS diag;
CREATE TEMP TABLE diag (ord serial, section text, k text, v text);

DO $diag$
DECLARE
  has_parent_col  boolean;   -- items.parent_item_id  (סכימה ישנה)
  has_package_col boolean;   -- items.package_id      (סכימה חדשה)
  pcol            text;      -- שם עמודת "הורה/מארז" בפועל
  has_flag_old    boolean;   -- test_stations_type.parents_only
  has_flag_new    boolean;   -- test_stations_type.package_level
  flagcol         text;
  has_is_package  boolean;   -- item_types.is_package
  has_pkg_seq     boolean;   -- items.package_seq
  has_contents    boolean;   -- package_contents
  has_migrations  boolean;   -- _prisma_migrations
  has_file_objects boolean;  -- file_objects
  has_ledger      boolean;   -- route_run (ledger המדדים)
  has_ledger_pcol boolean;   -- route_run.parent_item_id / package_id
  r               record;
  n               bigint;
  t               text;
BEGIN
  -- ---------------------------------------------------------------- 0. סכימה
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='parent_item_id') INTO has_parent_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='package_id') INTO has_package_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='package_seq') INTO has_pkg_seq;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='test_stations_type' AND column_name='parents_only') INTO has_flag_old;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='test_stations_type' AND column_name='package_level') INTO has_flag_new;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='item_types' AND column_name='is_package') INTO has_is_package;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='package_contents') INTO has_contents;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='_prisma_migrations') INTO has_migrations;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='file_objects') INTO has_file_objects;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='route_run') INTO has_ledger;
  --
  pcol    := CASE WHEN has_package_col THEN 'package_id' WHEN has_parent_col THEN 'parent_item_id' ELSE NULL END;
  flagcol := CASE WHEN has_flag_new THEN 'package_level' WHEN has_flag_old THEN 'parents_only' ELSE NULL END;
  --
  INSERT INTO diag(section,k,v) VALUES
    ('0 סביבה', 'database', current_database()),
    ('0 סביבה', 'user', current_user),
    ('0 סביבה', 'server', version()),
    ('0 סביבה', 'now (UTC)', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')),
    ('0 סכימה', 'items.parent_item_id (ישן)', has_parent_col::text),
    ('0 סכימה', 'items.package_id (חדש)', has_package_col::text),
    ('0 סכימה', 'items.package_seq', has_pkg_seq::text),
    ('0 סכימה', 'item_types.is_package', has_is_package::text),
    ('0 סכימה', 'test_stations_type.parents_only (ישן)', has_flag_old::text),
    ('0 סכימה', 'test_stations_type.package_level (חדש)', has_flag_new::text),
    ('0 סכימה', 'package_contents table', has_contents::text),
    ('0 סכימה', 'file_objects table', has_file_objects::text),
    ('0 סכימה', 'metrics ledger (route_run)', has_ledger::text),
    ('0 סכימה', 'עמודת הורה בשימוש', COALESCE(pcol, '(אין!)')),
    ('0 סכימה', 'דגל עמדה ברמת מארז בשימוש', COALESCE(flagcol, '(אין!)'));
  --
  IF has_migrations THEN
    FOR r IN EXECUTE $q$
      SELECT migration_name, to_char(finished_at, 'YYYY-MM-DD HH24:MI') AS fin, rolled_back_at IS NOT NULL AS rb
      FROM _prisma_migrations ORDER BY finished_at DESC NULLS FIRST LIMIT 10 $q$
    LOOP
      INSERT INTO diag(section,k,v) VALUES ('0 מיגרציות (10 אחרונות)', r.migration_name, COALESCE(r.fin, 'לא הסתיימה') || CASE WHEN r.rb THEN ' · ROLLED BACK' ELSE '' END);
    END LOOP;
  END IF;
  --
  IF pcol IS NULL THEN
    INSERT INTO diag(section,k,v) VALUES ('!! שגיאה', 'items', 'אין עמודת parent_item_id ולא package_id — הסכימה לא מוכרת, השאר לא ירוץ');
    RETURN;
  END IF;
  --
  -- ---------------------------------------------------------------- 1. נפחים
  SELECT count(*) INTO n FROM shipments;                                       INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'משלוחים', n::text);
  SELECT count(*) INTO n FROM shipments WHERE is_sent;                         INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'משלוחים שסומנו נשלחו', n::text);
  SELECT count(*) INTO n FROM shipment_items;                                  INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'שורות הצהרה במשלוחים (shipment_items)', n::text);
  SELECT count(*) || ' שורות · ' || COALESCE(sum(amount),0) || ' יחידות' INTO t FROM shipment_history;
                                                                               INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'החזרות (shipment_history)', t);
  SELECT count(*) INTO n FROM items;                                           INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'פריטים סה"כ', n::text);
  EXECUTE format('SELECT count(*) FROM items WHERE %I IS NULL', pcol) INTO n;  INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'פריטים ברמה עליונה (אב / בודד)', n::text);
  EXECUTE format('SELECT count(*) FROM items WHERE %I IS NOT NULL', pcol) INTO n; INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'פריטי ילד (אביזרים)', n::text);
  EXECUTE format('SELECT count(*) FROM items i WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM items p WHERE p.item_id = i.%I)', pcol, pcol) INTO n;
                                                                               INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'ילדים יתומים (ההורה לא קיים)', n::text);
  SELECT count(*) INTO n FROM items i WHERE NOT EXISTS (SELECT 1 FROM item_routes ir WHERE ir.item_id = i.item_id);
                                                                               INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'פריטים בלי שורת מסלול (item_routes)', n::text);
  SELECT count(*) INTO n FROM item_routes ir WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.item_id = ir.item_id);
                                                                               INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'שורות מסלול בלי פריט', n::text);
  SELECT count(*) INTO n FROM item_types;                                      INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'סוגי פריטים', n::text);
  IF has_is_package THEN
    SELECT count(*) INTO n FROM item_types WHERE is_package;                   INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'סוגי מארז מוגדרים', n::text);
  END IF;
  SELECT count(*) INTO n FROM testing_routes;                                  INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'מסלולי בדיקה', n::text);
  SELECT count(*) INTO n FROM test_results;                                    INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'תוצאות בדיקה (test_results)', n::text);
  SELECT count(*) INTO n FROM item_route_history;                              INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'היסטוריית עמדות (item_route_history)', n::text);
  IF has_file_objects THEN
    SELECT count(*) || ' קבצים על ' || count(DISTINCT entity_id) || ' פריטים' INTO t
      FROM file_objects WHERE entity_type = 'item_attachment' AND status <> 'deleted';
                                                                               INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'קבצים מצורפים לפריטים', t);
  END IF;
  IF has_ledger THEN
    SELECT count(*) INTO n FROM route_run;                                     INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'ledger: route_run', n::text);
    SELECT count(*) INTO n FROM item_state_event;                              INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'ledger: item_state_event', n::text);
    SELECT count(*) INTO n FROM item_state_interval;                           INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'ledger: item_state_interval', n::text);
  END IF;
  SELECT count(*) || ' לקוחות · id מקסימלי ' || max(id) || CASE WHEN max(id) > 999 THEN '  !! לא נכנס ל-3 ספרות במזהה החדש' ELSE '' END INTO t FROM customers;
                                                                               INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'לקוחות', t);
  SELECT count(*) INTO n FROM sources;                                         INSERT INTO diag VALUES (DEFAULT, '1 נפחים', 'מקורות (sources)', n::text);
  --
  -- ------------------------------------------------------------- 2. מזהים
  FOR r IN SELECT length(item_id::text) AS len, count(*) AS c, min(item_id) AS mn, max(item_id) AS mx FROM items GROUP BY 1 ORDER BY 1 LOOP
    INSERT INTO diag(section,k,v) VALUES ('2 פורמט מזהים', r.len || ' ספרות', r.c || ' פריטים · ' || r.mn || ' .. ' || r.mx);
  END LOOP;
  FOR r IN EXECUTE format($q$
      SELECT i.customer_id, to_char(ir.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS d, count(*) AS c
      FROM items i JOIN item_routes ir ON ir.item_id = i.item_id
      WHERE i.%I IS NULL GROUP BY 1,2 ORDER BY 3 DESC LIMIT 3 $q$, pcol)
  LOOP
    INSERT INTO diag(section,k,v) VALUES ('2 מונה יומי (מקס׳ 9999 לקוח/יום)', 'לקוח ' || r.customer_id || ' · ' || r.d, r.c || ' קופסאות ביום');
  END LOOP;
  EXECUTE format('SELECT COALESCE(max(c),0) FROM (SELECT count(*) c FROM items WHERE %I IS NOT NULL GROUP BY %I) s', pcol, pcol) INTO n;
  INSERT INTO diag(section,k,v) VALUES ('2 ילדים לאב (מקס׳ 99)', 'המספר הגדול ביותר של ילדים תחת אב אחד', n::text || CASE WHEN n > 99 THEN '  !! חורג' ELSE '' END);
  --
  -- ------------------------------------------------ 3. מצב המסלולים (מה נגעו)
  FOR r IN EXECUTE format($q$
      SELECT CASE WHEN i.%I IS NULL THEN 'רמה עליונה' ELSE 'ילד' END AS lvl,
             ir.current_status, ir.current_route_step, ir.is_finished, count(*) AS c
      FROM items i JOIN item_routes ir ON ir.item_id = i.item_id
      GROUP BY 1,2,3,4 ORDER BY 1,2,3,4 $q$, pcol)
  LOOP
    INSERT INTO diag(section,k,v) VALUES ('3 מצב מסלול', r.lvl || ' · סטטוס ' || r.current_status || ' · שלב ' || r.current_route_step || CASE WHEN r.is_finished THEN ' · הסתיים' ELSE '' END, r.c::text);
  END LOOP;
  --
  -- "לא נגעו": שלב 1, ממתין (2), לא הסתיים, בלי תוצאות, בלי היסטוריה, בלי קבצים —
  -- וגם כל הילדים של אותו אב עומדים בזה. זה התנאי של סקריפט ההסבה.
  EXECUTE format($q$
    CREATE TEMP TABLE diag_groups AS
    WITH touched AS (
      SELECT i.item_id,
             (ir.item_id IS NULL) AS no_route,
             (ir.current_status IS DISTINCT FROM 2 OR COALESCE(ir.current_route_step,1) <> 1 OR COALESCE(ir.is_finished,false)) AS moved,
             EXISTS (SELECT 1 FROM test_results t WHERE t.item_id = i.item_id) AS has_results,
             EXISTS (SELECT 1 FROM item_route_history h WHERE h.item_id = i.item_id) AS has_history,
             %s AS has_files,
             (ir.current_status IN (4,5)) AS in_research,
             (ir.current_status = 1) AS in_test,
             (ir.current_status = 3 OR COALESCE(ir.is_finished,false)) AS finished
      FROM items i LEFT JOIN item_routes ir ON ir.item_id = i.item_id)
    SELECT p.item_id AS top_id, p.item_type_id AS top_type, p.customer_id, p.shipment_id,
           (SELECT count(*) FROM items c WHERE c.%I = p.item_id) AS children,
           tp.no_route OR tp.moved OR tp.has_results OR tp.has_history OR tp.has_files
             OR EXISTS (SELECT 1 FROM items c JOIN touched tc ON tc.item_id = c.item_id
                        WHERE c.%I = p.item_id AND (tc.no_route OR tc.moved OR tc.has_results OR tc.has_history OR tc.has_files)) AS blocked,
           tp.no_route, tp.moved, tp.has_results, tp.has_history, tp.has_files, tp.in_research, tp.in_test, tp.finished
    FROM items p JOIN touched tp ON tp.item_id = p.item_id
    WHERE p.%I IS NULL $q$,
    CASE WHEN has_file_objects THEN 'EXISTS (SELECT 1 FROM file_objects f WHERE f.entity_type = ''item_attachment'' AND f.status <> ''deleted'' AND f.entity_id = i.item_id::text)' ELSE 'false' END,
    pcol, pcol, pcol);
  --
  SELECT count(*) INTO n FROM diag_groups;                       INSERT INTO diag VALUES (DEFAULT, '3 קבוצות להסבה (אב+ילדיו / בודד)', 'סה"כ קבוצות', n::text);
  SELECT count(*) INTO n FROM diag_groups WHERE NOT blocked;     INSERT INTO diag VALUES (DEFAULT, '3 קבוצות להסבה (אב+ילדיו / בודד)', 'ניתנות להסבה אוטומטית (איש לא נגע)', n::text);
  SELECT count(*) INTO n FROM diag_groups WHERE blocked;         INSERT INTO diag VALUES (DEFAULT, '3 קבוצות להסבה (אב+ילדיו / בודד)', 'חסומות (נגעו בהן)', n::text);
  SELECT count(*) INTO n FROM diag_groups WHERE moved;           INSERT INTO diag VALUES (DEFAULT, '3 סיבות חסימה (ברמה העליונה)', 'זזו מהשלב הראשון / לא ממתינים', n::text);
  SELECT count(*) INTO n FROM diag_groups WHERE has_results;     INSERT INTO diag VALUES (DEFAULT, '3 סיבות חסימה (ברמה העליונה)', 'יש תוצאות בדיקה', n::text);
  SELECT count(*) INTO n FROM diag_groups WHERE has_history;     INSERT INTO diag VALUES (DEFAULT, '3 סיבות חסימה (ברמה העליונה)', 'יש היסטוריית עמדות', n::text);
  SELECT count(*) INTO n FROM diag_groups WHERE has_files;       INSERT INTO diag VALUES (DEFAULT, '3 סיבות חסימה (ברמה העליונה)', 'יש קבצים מצורפים', n::text);
  SELECT count(*) INTO n FROM diag_groups WHERE no_route;        INSERT INTO diag VALUES (DEFAULT, '3 סיבות חסימה (ברמה העליונה)', 'אין שורת מסלול', n::text);
  SELECT count(*) INTO n FROM diag_groups WHERE in_test;         INSERT INTO diag VALUES (DEFAULT, '3 סיבות חסימה (ברמה העליונה)', 'בבדיקה עכשיו (סטטוס 1)', n::text);
  SELECT count(*) INTO n FROM diag_groups WHERE in_research;     INSERT INTO diag VALUES (DEFAULT, '3 סיבות חסימה (ברמה העליונה)', 'במחקר (סטטוס 4/5)', n::text);
  SELECT count(*) INTO n FROM diag_groups WHERE finished;        INSERT INTO diag VALUES (DEFAULT, '3 סיבות חסימה (ברמה העליונה)', 'סיימו את המסלול', n::text);
  SELECT count(*) INTO n FROM diag_groups WHERE blocked AND NOT (moved OR has_results OR has_history OR has_files OR no_route);
                                                                 INSERT INTO diag VALUES (DEFAULT, '3 סיבות חסימה (ברמה העליונה)', 'האב נקי אבל ילד שלו נגוע', n::text);
  --
  -- ------------------------------------------------- 4. לפי סוג פריט (עליון)
  FOR r IN EXECUTE format($q$
      SELECT it.item_type_id, TRIM(it.item_type_desc) AS d,
             count(*) AS groups, count(*) FILTER (WHERE NOT g.blocked) AS ok, count(*) FILTER (WHERE g.blocked) AS blocked,
             sum(g.children) AS children,
             COALESCE((SELECT string_agg(TRIM(ct.item_type_desc) || ' ×' || x.c, ', ' ORDER BY x.c DESC)
                       FROM (SELECT c.item_type_id, count(*) c FROM items c JOIN items p ON p.item_id = c.%I WHERE p.item_type_id = it.item_type_id GROUP BY 1) x
                       JOIN item_types ct ON ct.item_type_id = x.item_type_id), '—') AS child_types,
             COALESCE((SELECT string_agg('מסלול ' || tr.route_number || ': ' || array_to_string(tr.route_steps, '→'), ' | ' ORDER BY tr.route_number)
                       FROM testing_routes tr WHERE tr.item_type_id = it.item_type_id), '(אין מסלול!)') AS routes
      FROM diag_groups g JOIN item_types it ON it.item_type_id = g.top_type
      GROUP BY 1,2 ORDER BY 3 DESC $q$, pcol)
  LOOP
    INSERT INTO diag(section,k,v) VALUES ('4 סוגי פריט ברמה עליונה', '#' || r.item_type_id || ' ' || r.d,
      'קבוצות ' || r.groups || ' · להסבה ' || r.ok || ' · חסומות ' || r.blocked || ' · ילדים ' || r.children || ' · סוגי ילדים: ' || r.child_types || ' · ' || r.routes);
  END LOOP;
  --
  -- ------------------------------------------------------- 5. סוגי ילדים
  FOR r IN EXECUTE format($q$
      SELECT ct.item_type_id, TRIM(ct.item_type_desc) AS d, count(*) AS c,
             string_agg(DISTINCT TRIM(pt.item_type_desc), ', ') AS parents,
             COALESCE((SELECT string_agg('מסלול ' || tr.route_number || ': ' || array_to_string(tr.route_steps, '→'), ' | ' ORDER BY tr.route_number)
                       FROM testing_routes tr WHERE tr.item_type_id = ct.item_type_id), '(אין מסלול!)') AS routes
      FROM items c JOIN items p ON p.item_id = c.%I
      JOIN item_types ct ON ct.item_type_id = c.item_type_id JOIN item_types pt ON pt.item_type_id = p.item_type_id
      GROUP BY 1,2 ORDER BY 3 DESC $q$, pcol)
  LOOP
    INSERT INTO diag(section,k,v) VALUES ('5 סוגי ילדים', '#' || r.item_type_id || ' ' || r.d, r.c || ' פריטים · תחת: ' || r.parents || ' · ' || r.routes);
  END LOOP;
  FOR r IN SELECT children, count(*) AS c FROM diag_groups GROUP BY 1 ORDER BY 1 LOOP
    INSERT INTO diag(section,k,v) VALUES ('5 התפלגות ילדים לאב', r.children || ' ילדים', r.c || ' אבות');
  END LOOP;
  --
  -- ------------------------------------------------ 6. סוגי עמדות ומסלולים
  FOR r IN EXECUTE format($q$
      SELECT t.test_station_type_id AS id, TRIM(t.test_type_desc) AS d, t.%I AS flag,
             (SELECT count(*) FROM test_stations s WHERE s.test_station_type_id = t.test_station_type_id) AS stations,
             (SELECT count(*) FROM test_stations s WHERE s.test_station_type_id = t.test_station_type_id AND s.is_research) AS research,
             (SELECT count(*) FROM testing_routes tr WHERE tr.route_steps[1] = t.test_station_type_id) AS as_first,
             (SELECT count(*) FROM testing_routes tr WHERE tr.route_steps[array_length(tr.route_steps,1)] = t.test_station_type_id) AS as_last
      FROM test_stations_type t ORDER BY 1 $q$, flagcol)
  LOOP
    INSERT INTO diag(section,k,v) VALUES ('6 סוגי עמדות', '#' || r.id || ' ' || r.d,
      CASE WHEN r.flag THEN 'ברמת מארז (' || flagcol || ') · ' ELSE '' END || r.stations || ' עמדות (' || r.research || ' מחקר) · פותח ' || r.as_first || ' מסלולים · סוגר ' || r.as_last);
  END LOOP;
  FOR r IN SELECT tr.item_type_id, TRIM(it.item_type_desc) AS d, tr.route_number, tr.route_steps,
                  (SELECT string_agg(TRIM(tst.test_type_desc), ' → ' ORDER BY u.ord) FROM unnest(tr.route_steps) WITH ORDINALITY u(step, ord) JOIN test_stations_type tst ON tst.test_station_type_id = u.step) AS names
           FROM testing_routes tr JOIN item_types it ON it.item_type_id = tr.item_type_id ORDER BY 2, 3
  LOOP
    INSERT INTO diag(section,k,v) VALUES ('6 מסלולים', '#' || r.item_type_id || ' ' || r.d || ' · מסלול ' || r.route_number, array_to_string(r.route_steps, '→') || ' = ' || COALESCE(r.names, '?'));
  END LOOP;
  --
  -- ------------------------------------------------------- 7. לפי משלוח
  FOR r IN EXECUTE $q$
      SELECT s.id, s.shipment_code, TRIM(c.customer_code) AS cust, to_char(s.shipment_date, 'YYYY-MM-DD') AS d, s.is_sent, s.amount,
             COALESCE((SELECT string_agg(TRIM(it.item_type_desc) || ' ×' || si.quantity || COALESCE(' (מק"ט ' || si.makat || ')', ''), ', ')
                       FROM shipment_items si JOIN item_types it ON it.item_type_id = si.item_type_id WHERE si.shipment_id = s.id), '(אין הצהרה)') AS declared,
             (SELECT count(*) FROM diag_groups g WHERE g.shipment_id = s.id) AS groups,
             (SELECT count(*) FROM diag_groups g WHERE g.shipment_id = s.id AND NOT g.blocked) AS ok,
             (SELECT count(*) FROM diag_groups g WHERE g.shipment_id = s.id AND g.blocked) AS blocked,
             (SELECT COALESCE(sum(g.children),0) FROM diag_groups g WHERE g.shipment_id = s.id) AS children,
             (SELECT count(*) FROM diag_groups g WHERE g.shipment_id = s.id AND g.finished) AS finished,
             (SELECT COALESCE(sum(h.amount),0) FROM shipment_history h WHERE h.shipment_id = s.id) AS sent
      FROM shipments s JOIN customers c ON c.id = s.customer_id ORDER BY s.shipment_date DESC, s.id DESC $q$
  LOOP
    INSERT INTO diag(section,k,v) VALUES ('7 משלוחים', r.shipment_code || ' · ' || r.cust || ' · ' || r.d || CASE WHEN r.is_sent THEN ' · נשלח' ELSE '' END,
      'הוצהר ' || r.amount || ' [' || r.declared || '] · קבוצות ' || r.groups || ' (להסבה ' || r.ok || ', חסומות ' || r.blocked || ') · ילדים ' || r.children || ' · סיימו ' || r.finished || ' · הוחזרו ' || r.sent);
  END LOOP;
  --
  -- ------------------------------------------- 8. משלוחים בלי פריטים / להפך
  SELECT count(*) INTO n FROM shipments s WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.shipment_id = s.id);
  INSERT INTO diag VALUES (DEFAULT, '8 עקביות', 'משלוחים בלי אף פריט שנקלט', n::text);
  SELECT count(*) INTO n FROM items i WHERE NOT EXISTS (SELECT 1 FROM shipments s WHERE s.id = i.shipment_id);
  INSERT INTO diag VALUES (DEFAULT, '8 עקביות', 'פריטים שמצביעים על משלוח שלא קיים', n::text);
  SELECT count(*) INTO n FROM shipment_items si WHERE NOT EXISTS (SELECT 1 FROM shipments s WHERE s.id = si.shipment_id);
  INSERT INTO diag VALUES (DEFAULT, '8 עקביות', 'שורות הצהרה בלי משלוח', n::text);
  EXECUTE format('SELECT count(*) FROM items c JOIN items p ON p.item_id = c.%I WHERE c.shipment_id <> p.shipment_id OR c.customer_id <> p.customer_id', pcol) INTO n;
  INSERT INTO diag VALUES (DEFAULT, '8 עקביות', 'ילדים עם משלוח/לקוח שונה מההורה', n::text);
  EXECUTE format('SELECT count(*) FROM items c JOIN items p ON p.item_id = c.%I WHERE p.%I IS NOT NULL', pcol, pcol) INTO n;
  INSERT INTO diag VALUES (DEFAULT, '8 עקביות', 'ילד של ילד (עומק 2)', n::text);
  SELECT count(*) INTO n FROM items WHERE serial_no IS NULL OR TRIM(serial_no) = '';
  INSERT INTO diag VALUES (DEFAULT, '8 עקביות', 'פריטים בלי סריאלי', n::text);
  SELECT count(*) INTO n FROM (SELECT serial_no FROM items WHERE serial_no IS NOT NULL AND TRIM(serial_no) <> '' GROUP BY 1 HAVING count(*) > 1) s;
  INSERT INTO diag VALUES (DEFAULT, '8 עקביות', 'סריאלים כפולים (ערכים)', n::text);
  EXECUTE format('SELECT count(*) FROM items i WHERE i.%I IS NULL AND NOT EXISTS (SELECT 1 FROM testing_routes tr WHERE tr.item_type_id = i.item_type_id)', pcol) INTO n;
  INSERT INTO diag VALUES (DEFAULT, '8 עקביות', 'פריטים ברמה עליונה שלסוגם אין מסלול', n::text);
  --
  DROP TABLE diag_groups;
END
$diag$;

-- התוצאה: כל הממצאים, לפי סדר הסעיפים
SELECT section, k AS key, v AS value FROM diag ORDER BY ord;
