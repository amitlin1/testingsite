-- =============================================================================
-- ביטול העברת התמונות: כל תמונה ש-3 העביר חוזרת לקבוצה שהייתה לה
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs.
--
-- מחזיר רק את מה ש-3 העביר (התמונות שיש להן metadata.photoTypeBefore): photoType = הקבוצה
-- הקודמת (או בלי קבוצה, אם לא הייתה), ו-photoTypeBefore נמחק. קבוצות השדות נשארות (בלי
-- תמונות ישנות), ותמונות חדשות ממשיכות להיכנס לקבוצת השדה — זה הקוד, לא ההעברה.
-- הרצה חוזרת לא משנה דבר.
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 4-field-photos-undo.sql
-- =============================================================================

BEGIN;

UPDATE file_objects
   SET metadata = CASE WHEN jsonb_typeof(metadata->'photoTypeBefore') = 'null'
                       THEN metadata - 'photoTypeBefore' - 'photoType'
                       ELSE (metadata - 'photoTypeBefore') || jsonb_build_object('photoType', metadata->'photoTypeBefore') END,
       updated_at = now()
 WHERE jsonb_typeof(metadata) = 'object' AND metadata ? 'photoTypeBefore';

COMMIT;

SELECT 'נשארו מסומנות כמועברות (צריך להיות 0)' AS נושא, count(*)::text AS מספר
  FROM file_objects WHERE metadata ? 'photoTypeBefore';
