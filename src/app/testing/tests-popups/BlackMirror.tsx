"use client";
import VerdictStation, { type VerdictStationConfig } from "./VerdictStation";
import type { StationTestDialogProps } from "../../../types";

// עמדת מראה שחורה — סריקת מק״ט יצרן → "נא להשוות עפ״י מוצר [מק״ט]" + אישור תקינות.
// אותו מבנה כמו שיקוף, רק הודעת המערכת שונה.
const CONFIG: VerdictStationConfig = {
  stationKey: "blackMirror",
  contextLabel: "מראה שחורה",
  phaseTitle: "השוואת מוצר",
  phaseDesc: "השווה את הפריט מול המוצר במראה השחורה ואשר את תקינותו.",
  buildMessage: (sku) => `נא להשוות עפ״י מוצר ${sku || "—"}`,
  finishLabel: "סיום בדיקת מראה שחורה",
};

export default function BlackMirror(props: StationTestDialogProps) {
  return <VerdictStation {...props} config={CONFIG} />;
}
