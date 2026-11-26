// "ברוטו / נטו" — the words every duration on screen is shown in, defined
// once. Read by the explanation panel (dashboard/tests/_components/
// ClockInfoDrawer.tsx), opened from the info icon beside each duration and from
// the dashboard header. Client-safe: no runtime import.
//
// The two clocks are the ledger's two columns (docs/architecture/
// dashboard-architecture.md, "Two clocks on every duration"):
//   ברוטו = wall_seconds — real elapsed time, nights and weekends included.
//   נטו   = work_seconds — the same span counted only inside working hours,
//           read off the work calendar built from the work-hours screen.

import type { WeekdayDefault } from "@/lib/workHours/types";

/** GET /api/work-clock. */
export interface WorkClockWire {
  /** ראשון…שבת: the hours net time is counted by, with their net minutes. */
  week: Array<WeekdayDefault & { netMinutes: number }>;
  /** Has anyone saved the weekly hours on the work-hours screen? false = the system defaults. */
  hoursCustomized: boolean;
  /** Special days and department holidays entered on the work-hours screen. */
  exceptions: number;
  /** Last day the work calendar covers; null = not built, so net time cannot be computed. */
  calendarHorizonTo: string | null;
}

/** GET /api/work-clock/windows. */
export interface WorkWindowsWire {
  /** false = no work calendar yet: net time cannot be counted. */
  built: boolean;
  /** Working windows as epoch-ms pairs [start, end, start, end, …], ascending. */
  windows: number[];
}

/**
 * Net seconds between two instants: the parts of [from, to) that fall inside
 * the working windows (WorkWindowsWire.windows). The browser twin of
 * work_seconds_between, for timers that tick on screen.
 */
export function netSecondsBetween(windows: ArrayLike<number>, from: number, to: number): number {
  if (!(to > from)) return 0;
  // First window whose end is after `from` (binary search over the pairs).
  let lo = 0;
  let hi = windows.length / 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (windows[mid * 2 + 1] <= from) lo = mid + 1;
    else hi = mid;
  }
  let ms = 0;
  for (let i = lo * 2; i < windows.length && windows[i] < to; i += 2) {
    ms += Math.min(windows[i + 1], to) - Math.max(windows[i], from);
  }
  return ms / 1000;
}

export const CLOCK_TEXT = {
  wall: {
    label: "ברוטו",
    short: "זמן אמיתי לפי השעון, כולל לילות, סופי שבוע וחגים",
    long: "כמה זמן עבר בפועל לפי השעון — 24 שעות ביממה, כולל לילות, סופי שבוע, חגים והפסקות. זה הזמן שהלקוח חווה.",
  },
  work: {
    label: "נטו",
    short: "רק הזמן שנפל בתוך שעות העבודה של המעבדה",
    long: "אותו פרק זמן, אבל נספרות רק הדקות שבתוך שעות העבודה (לפי מסך שעות עבודה וחגי ישראל). זה הזמן שהמעבדה עצמה הייתה פתוחה לטפל בפריט.",
  },
  offhours: {
    label: "מחוץ לשעות",
    short: "ברוטו פחות נטו",
    long: "ההפרש בין ברוטו לנטו: החלק מהזמן שנפל בלילות, בסופי שבוע, בחגים ובהפסקות — עיכוב של הלוח, לא של העבודה.",
  },
  example:
    "פריט נכנס לתור ביום חמישי ב-15:00 ונלקח לבדיקה ביום ראשון ב-07:10: ברוטו = 64 שע׳ 10 דק׳, נטו = 45 דק׳ (35 דק׳ עד סוף יום חמישי + 10 דק׳ ביום ראשון).",
  missingWork: "נטו לא חושב",
  missingWorkWhy:
    "לוח שעות העבודה עוד לא נבנה, ולכן אי אפשר לחשב נטו. המערכת בונה אותו לבד משעות העבודה שבמסך שעות עבודה — רעננו את הדף בעוד רגע.",
} as const;

export type ClockMetricKey =
  | "wait"
  | "processing"
  | "offhours"
  | "queueAge"
  | "workHours"
  | "routeTurnaround"
  | "boxRoute"
  | "slowStep"
  | "itemStep"
  | "itemTotal"
  | "testingTimer";

export interface ClockMetric {
  key: ClockMetricKey;
  title: string;
  /** What is measured: from when to when. */
  what: string;
  /** Which clocks the screens show it in. */
  clocks: "both" | "work" | "wall";
}

/** Every duration the screens show, in panel order. */
export const CLOCK_METRICS: readonly ClockMetric[] = [
  {
    key: "wait",
    title: "זמן המתנה",
    what: "מהרגע שהפריט נכנס לתור של סוג העמדה (או לתור המחקר, או המתין לפריטי המארז) ועד שבדיקה התחילה.",
    clocks: "both",
  },
  {
    key: "processing",
    title: "זמן ביצוע",
    what: "מתחילת הבדיקה בעמדה (או הטיפול במחקר) ועד הגשת התוצאה או ההעברה הלאה. במארז — נספר פעם אחת, על המארז.",
    clocks: "both",
  },
  {
    key: "offhours",
    title: "מחוץ לשעות / פער",
    what: "ברוטו פחות נטו של אותו מדד: כמה מהזמן נפל מחוץ לשעות העבודה.",
    clocks: "both",
  },
  {
    key: "queueAge",
    title: "הוותיק בתור",
    what: "כמה זמן ממתין כרגע הפריט שמחכה הכי הרבה לסוג העמדה הזה — נמדד מכניסתו לתור ועד עכשיו.",
    clocks: "both",
  },
  {
    key: "workHours",
    title: "שעות עבודה בעמדה",
    what: "סך זמני הביצוע שנסגרו בעמדה בתקופה, בנטו בלבד. העמדה העמוסה היא זו עם הכי הרבה שעות כאלה.",
    clocks: "work",
  },
  {
    key: "routeTurnaround",
    title: "זמן ממוצע (לקוח / סוג פריט)",
    what: "מפתיחת המסלול של הפריט ועד שהמסלול נסגר — כל התחנות, כולל ההמתנות ביניהן. רק מסלולים שהסתיימו.",
    clocks: "both",
  },
  {
    key: "boxRoute",
    title: "זמן מסלול למארז (לוח ניהול)",
    what: "מכניסת המארז למסלול (עמדה 1) ועד שהמסלול שלו נסגר — כל התחנות, כולל ההמתנות ביניהן. ממוצע על המארזים שהמסלול שלהם הסתיים בטווח שנבחר.",
    clocks: "both",
  },
  {
    key: "slowStep",
    title: "הצעדים האיטיים",
    what: "לכל צעד: ההמתנה לפניו, הביצוע שלו, וסה״כ = המתנה + ביצוע. הרשימה ממוינת לפי הנטו.",
    clocks: "both",
  },
  {
    key: "itemStep",
    title: "משך עיבוד בתחנה (כרטיס פריט)",
    what: "מתחילת הבדיקה בתחנה ועד סיומה, בנטו. ההמתנה בתור שלפניה מוצגת בברוטו.",
    clocks: "work",
  },
  {
    key: "testingTimer",
    title: "הזמן במסך בדיקה",
    what: "פריט בתור: מכניסתו לתור ועד עכשיו. פריט בבדיקה: מתחילת הבדיקה ועד עכשיו. נספר בנטו בלבד — מחוץ לשעות העבודה השעון עומד.",
    clocks: "work",
  },
  {
    key: "itemTotal",
    title: "זמן כולל במערכת (כרטיס פריט)",
    what: "מקליטת הפריט ועד סיומו (או עד עכשיו), בברוטו.",
    clocks: "wall",
  },
];

export function clockMetric(key: ClockMetricKey): ClockMetric {
  return CLOCK_METRICS.find((m) => m.key === key) ?? CLOCK_METRICS[0];
}
