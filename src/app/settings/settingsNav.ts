import type { SvgIconComponent } from "@mui/icons-material";
import PeopleIcon from "@mui/icons-material/People";
import CategoryIcon from "@mui/icons-material/Category";
import SourceIcon from "@mui/icons-material/Source";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import EventNoteIcon from "@mui/icons-material/EventNote";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing";
import AltRouteIcon from "@mui/icons-material/AltRoute";
import BadgeIcon from "@mui/icons-material/Badge";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";

/**
 * Single source of truth for the /settings/* routes.
 *
 * Consumed by both the main sidebar's collapsible "הגדרות מערכת" group
 * (src/app/components/navBar.tsx) and the settings sub-nav tab strip
 * (src/app/settings/components/SettingsSubNav.tsx). `icon` is the MUI icon
 * component itself so each consumer can render it at its own size.
 */
export interface SettingsLink {
  path: string;
  label: string;
  icon: SvgIconComponent;
}

export const settingsLinks: SettingsLink[] = [
  { path: "/settings/customers", label: "לקוחות", icon: PeopleIcon },
  { path: "/settings/item-types", label: "סוגי פריטים", icon: CategoryIcon },
  { path: "/settings/sources", label: "ניהול מקורות", icon: SourceIcon },
  { path: "/settings/item-status", label: "סטטוסי פריט", icon: AssignmentTurnedInIcon },
  { path: "/settings/test-station-status", label: "סטטוסי עמדת בדיקה", icon: EventNoteIcon },
  { path: "/settings/test-stations", label: "עמדות בדיקה", icon: PrecisionManufacturingIcon },
  { path: "/settings/testing-routes", label: "מסלולי בדיקה", icon: AltRouteIcon },
  { path: "/settings/reference-items", label: "פריטי ייחוס", icon: PhotoLibraryIcon },
  { path: "/settings/workers", label: "ניהול עובדים", icon: BadgeIcon },
];
