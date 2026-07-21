"use client";
import VerdictStation, { type VerdictStationConfig } from "./VerdictStation";
import type { StationTestDialogProps } from "../../../types";

// עמדת שיקוף — סריקת מק״ט יצרן → "נא לשקף עפ״י תכנית [מק״ט]" + אישור תקינות.
// אין צילום ואין שליפת תמונות ייחוס: רק ההנחיה והכרעת תקין/לא-תקין.
const CONFIG: VerdictStationConfig = {
  stationKey: "xray",
  contextLabel: "שיקוף",
  phaseTitle: "שיקוף הפריט",
  phaseDesc: "שקף את הפריט לפי התכנית ואשר את תקינותו.",
  buildMessage: (sku) => `נא לשקף עפ״י תכנית ${sku || "—"}`,
  finishLabel: "סיום בדיקת שיקוף",
};

export default function Xray(props: StationTestDialogProps) {
  return <VerdictStation {...props} config={CONFIG} />;
}
