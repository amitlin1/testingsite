"use client";
import PhotoStation, { type PhotoStationConfig } from "./PhotoStation";
import type { StationTestDialogProps } from "../../../types";

// עמדת הרכבה — סריקת מק״ט יצרן → צילום הרכבה (מונחה תמונות ייחוס) + אישור תקינות.
// photo_types.code = "assembly": התמונות נשלפות ומתויגות לפי הקוד הזה.
const CONFIG: PhotoStationConfig = {
  stationKey: "assembly",
  photoType: "assembly",
  contextLabel: "הרכבה",
  photoTitle: "צילום הרכבה",
  photoDesc: "צלם את הפריט בשלב ההרכבה לפי תמונות הייחוס, ואשר את תקינותו.",
  finishLabel: "סיום בדיקת הרכבה",
};

export default function Assembly(props: StationTestDialogProps) {
  return <PhotoStation {...props} config={CONFIG} />;
}
