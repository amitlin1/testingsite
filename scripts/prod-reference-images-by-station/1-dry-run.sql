-- =============================================================================
-- ריצה יבשה: לאיזו עמדה תשויך כל תמונת ייחוס קיימת (קריאה בלבד)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs, מאותה שאילתה שהמיגרציה (2) מריצה.
-- לא משנה דבר. להריץ לפני 2 (עובד גם אחריו).
--
-- כל תמונת ייחוס הועלתה לקבוצת צילום. היא עוברת לעמדה שמציגה את הקבוצה הזו היום — כשיש
-- בדיוק עמדה אחת כזו:
--   * רכיב צילום בתבנית של סוג העמדה שהקבוצה שלו;
--   * חלון הצילום של עמדה (CODE_POPUPS: סוג 2 ← קבוצה 3, סוג 5 ← קבוצה 4);
--   * הקבוצות 'package' / 'product' של אשף הפתיחה — לעמדות ברמת מארז שפותחות מארז.
-- קבוצה שאף עמדה לא מציגה, או שכמה עמדות מציגות: התמונות שלה נשארות "לא משויכות לעמדה".
-- בעמוד פריטי הייחוס בוחרים להן עמדה — בלי להעלות מחדש.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-dry-run.sql
-- =============================================================================

-- ---------------------------------------------------------------- לפי קבוצה
WITH m AS (
  WITH opening_types AS (
    SELECT DISTINCT t.test_station_type_id
      FROM testing_routes tr
      JOIN item_types it ON it.item_type_id = tr.item_type_id AND it.is_package
     CROSS JOIN LATERAL unnest(tr.route_steps[1:GREATEST(COALESCE(array_length(tr.route_steps, 1), 0) - 1, 0)]) AS s(st)
      JOIN test_stations_type t ON t.test_station_type_id = s.st AND t.package_level
  ), candidates AS (
    SELECT p.photo_type_id, p.test_station_type_id AS station
      FROM photo_types p
     WHERE p.test_station_type_id IS NOT NULL AND p.component_id IS NOT NULL
    UNION
    SELECT c.photo_type_id, c.station
      FROM (VALUES (2, 3), (5, 4)) AS c(station, photo_type_id)
      JOIN test_stations_type t ON t.test_station_type_id = c.station AND NOT t.package_level
      JOIN photo_types p ON p.photo_type_id = c.photo_type_id
    UNION
    SELECT p.photo_type_id, o.test_station_type_id
      FROM photo_types p CROSS JOIN opening_types o
     WHERE p.code IN ('package', 'product')
  )
  SELECT photo_type_id, MIN(station) AS station, COUNT(DISTINCT station) AS stations
    FROM candidates
   GROUP BY photo_type_id
)
SELECT p.code AS קבוצה,
       p.photo_type_desc AS שם,
       count(i.*) AS תמונות_ייחוס,
       CASE WHEN m.stations = 1 THEN TRIM(t.test_type_desc)
            WHEN m.stations > 1 THEN '(לא תשויך: ' || m.stations || ' עמדות מציגות אותה)'
            ELSE '(לא תשויך: אף עמדה לא מציגה אותה)' END AS עמדה
  FROM photo_types p
  JOIN reference_item_images i ON i.photo_type_id = p.photo_type_id
  LEFT JOIN m ON m.photo_type_id = p.photo_type_id
  LEFT JOIN test_stations_type t ON t.test_station_type_id = m.station AND m.stations = 1
 GROUP BY p.code, p.photo_type_desc, m.stations, t.test_type_desc
 ORDER BY p.code;

-- ---------------------------------------------------------------- סיכום
WITH m AS (
  WITH opening_types AS (
    SELECT DISTINCT t.test_station_type_id
      FROM testing_routes tr
      JOIN item_types it ON it.item_type_id = tr.item_type_id AND it.is_package
     CROSS JOIN LATERAL unnest(tr.route_steps[1:GREATEST(COALESCE(array_length(tr.route_steps, 1), 0) - 1, 0)]) AS s(st)
      JOIN test_stations_type t ON t.test_station_type_id = s.st AND t.package_level
  ), candidates AS (
    SELECT p.photo_type_id, p.test_station_type_id AS station
      FROM photo_types p
     WHERE p.test_station_type_id IS NOT NULL AND p.component_id IS NOT NULL
    UNION
    SELECT c.photo_type_id, c.station
      FROM (VALUES (2, 3), (5, 4)) AS c(station, photo_type_id)
      JOIN test_stations_type t ON t.test_station_type_id = c.station AND NOT t.package_level
      JOIN photo_types p ON p.photo_type_id = c.photo_type_id
    UNION
    SELECT p.photo_type_id, o.test_station_type_id
      FROM photo_types p CROSS JOIN opening_types o
     WHERE p.code IN ('package', 'product')
  )
  SELECT photo_type_id, MIN(station) AS station, COUNT(DISTINCT station) AS stations
    FROM candidates
   GROUP BY photo_type_id
)
SELECT count(*) FILTER (WHERE m.stations = 1) AS ישויכו_לעמדה,
       count(*) FILTER (WHERE m.stations IS DISTINCT FROM 1) AS יישארו_לא_משויכות
  FROM reference_item_images i
  LEFT JOIN m ON m.photo_type_id = i.photo_type_id;

-- ------------------------------------- פריטי ייחוס עם תמונות שיישארו לא משויכות
WITH m AS (
  WITH opening_types AS (
    SELECT DISTINCT t.test_station_type_id
      FROM testing_routes tr
      JOIN item_types it ON it.item_type_id = tr.item_type_id AND it.is_package
     CROSS JOIN LATERAL unnest(tr.route_steps[1:GREATEST(COALESCE(array_length(tr.route_steps, 1), 0) - 1, 0)]) AS s(st)
      JOIN test_stations_type t ON t.test_station_type_id = s.st AND t.package_level
  ), candidates AS (
    SELECT p.photo_type_id, p.test_station_type_id AS station
      FROM photo_types p
     WHERE p.test_station_type_id IS NOT NULL AND p.component_id IS NOT NULL
    UNION
    SELECT c.photo_type_id, c.station
      FROM (VALUES (2, 3), (5, 4)) AS c(station, photo_type_id)
      JOIN test_stations_type t ON t.test_station_type_id = c.station AND NOT t.package_level
      JOIN photo_types p ON p.photo_type_id = c.photo_type_id
    UNION
    SELECT p.photo_type_id, o.test_station_type_id
      FROM photo_types p CROSS JOIN opening_types o
     WHERE p.code IN ('package', 'product')
  )
  SELECT photo_type_id, MIN(station) AS station, COUNT(DISTINCT station) AS stations
    FROM candidates
   GROUP BY photo_type_id
)
SELECT TRIM(it.item_type_desc) AS סוג_פריט, r.manufacturer_sku AS מקט, r.name AS שם, count(*) AS לא_משויכות
  FROM reference_item_images i
  JOIN reference_items r ON r.reference_item_id = i.reference_item_id
  JOIN item_types it ON it.item_type_id = r.item_type_id
  LEFT JOIN m ON m.photo_type_id = i.photo_type_id
 WHERE m.stations IS DISTINCT FROM 1
 GROUP BY 1, 2, 3
 ORDER BY 1, 2;
