"use client";
import PhotoStation, { type PhotoStationConfig } from "./PhotoStation";
import type { StationTestDialogProps } from "../../../types";

// עמדת פירוק — סריקת מק״ט יצרן → צילום פירוק (מונחה תמונות ייחוס) + אישור תקינות.
// photo_types.code = "disassembly": התמונות נשלפות ומתויגות לפי הקוד הזה.
const CONFIG: PhotoStationConfig = {
  stationKey: "disassembly",
  photoType: "disassembly",
  contextLabel: "פירוק",
  photoTitle: "צילום פירוק",
  photoDesc: "צלם את הפריט בשלב הפירוק לפי תמונות הייחוס, ואשר את תקינותו.",
  finishLabel: "סיום בדיקת פירוק",
};

export default function Disassembly(props: StationTestDialogProps) {
  return <PhotoStation {...props} config={CONFIG} />;
}
