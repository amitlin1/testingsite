import type { SvgIconComponent } from "@/components/ui/icons";
import {
  People as PeopleIcon,
  Category as CategoryIcon,
  Source as SourceIcon,
  AssignmentTurnedIn as AssignmentTurnedInIcon,
  EventNote as EventNoteIcon,
  PrecisionManufacturing as PrecisionManufacturingIcon,
  AltRoute as AltRouteIcon,
  Badge as BadgeIcon,
  PhotoLibrary as PhotoLibraryIcon,
} from "@/components/ui/icons";

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
