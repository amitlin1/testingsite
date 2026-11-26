// The app's places, listed once: the sidebar's sections and settings pages, the settings tabs, the
// top bar's title, the role panel's screens and the command palette's destinations all read them.
// Who may open each is the middleware's table (src/lib/routes.ts) — menus filter with canSeeInNav.
import type { LucideIcon } from "lucide-react";
import { FlaskConical, Folder, LayoutDashboard, Monitor, Package, Settings as SettingsGlyph, Tag, Truck } from "lucide-react";
import {
  type SvgIconComponent,
  AccessTime,
  AltRoute,
  Analytics,
  AssignmentTurnedIn,
  Category,
  Dashboard,
  EventNote,
  FolderCopy,
  History,
  Inventory,
  LocalShipping,
  Lock,
  People,
  PhotoLibrary,
  PrecisionManufacturing,
  Science,
  Settings,
  Source,
} from "@/components/ui/icons";

export interface NavEntry {
  href: string;
  label: string;
  icon: SvgIconComponent;
}

export interface Section extends NavEntry {
  /** Where the section's pages start, when not at href (the top bar's title covers them all). */
  root?: string;
  /** Pages elsewhere that belong to the section: the sidebar lights it for them. */
  claims?: (pathname: string) => boolean;
}

/** `pathname` is `base` or a page under it. */
export function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + "/");
}

/** Where the dashboard's pages start (the shell pins its rail to icons there, §14.1). */
export const DASHBOARD_ROOT = "/dashboard";

/** The main sections, in sidebar order. */
export const SECTIONS = [
  // An item's pages (/items/…) are opened from here and lead back here.
  { href: "/packages", label: "מארזים ופריטים", icon: Inventory, claims: (p: string) => p.startsWith("/items/") },
  { href: "/testing", label: "מסך בדיקה", icon: Science },
  // The managers' summary; its detailed board (/dashboard/tests) lights the same entry.
  { href: DASHBOARD_ROOT, label: "לוח ניהול", icon: Analytics },
  { href: "/shipments", label: "משלוחים נכנסים", icon: LocalShipping },
  { href: "/files", label: "ניהול קבצים", icon: FolderCopy },
] as const satisfies readonly Section[];

export const SETTINGS: NavEntry = { href: "/settings", label: "הגדרות מערכת", icon: Settings };

/** The settings pages, in menu and tab order. */
export const SETTINGS_PAGES = [
  { href: "/settings/users", label: "משתמשים והרשאות", icon: Lock },
  { href: "/settings/customers", label: "לקוחות", icon: People },
  { href: "/settings/item-types", label: "סוגי פריטים", icon: Category },
  { href: "/settings/packages", label: "מארזים", icon: Inventory },
  { href: "/settings/sources", label: "ניהול מקורות", icon: Source },
  { href: "/settings/item-status", label: "סטטוסי פריט", icon: AssignmentTurnedIn },
  { href: "/settings/test-station-status", label: "סטטוסי עמדת בדיקה", icon: EventNote },
  { href: "/settings/test-stations", label: "עמדות בדיקה", icon: PrecisionManufacturing },
  { href: "/settings/testing-routes", label: "מסלולי בדיקה", icon: AltRoute },
  { href: "/settings/popup-templates", label: "תבניות חלון", icon: Dashboard },
  { href: "/settings/reference-items", label: "פריטי ייחוס", icon: PhotoLibrary },
  { href: "/settings/work-hours", label: "שעות עבודה וחופשות", icon: AccessTime },
] as const satisfies readonly NavEntry[];

type SectionHref = (typeof SECTIONS)[number]["href"];
type SettingsHref = (typeof SETTINGS_PAGES)[number]["href"];

/** The entry a path lights up: the longest href that is the path or a parent of it, or that claims it. */
export function activeHref(pathname: string | null, entries: readonly Section[]): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const e of entries) {
    const hit = isUnder(pathname, e.href) || !!e.claims?.(pathname);
    if (hit && (best === null || e.href.length > best.length)) best = e.href;
  }
  return best;
}

const ITEMS_LIST = { title: "דוחות וניהול פריטים", icon: Dashboard };
const ITEM_HISTORY = { title: "היסטוריית פריט", icon: History };

/** The top bar's title and icon for a path: its section's; an item's own pages'; else the items
 *  list's ("/items", and anything unknown). */
export function pageTitle(pathname: string | null): { title: string; icon: SvgIconComponent } {
  const p = pathname ?? "";
  const titled: readonly Section[] = [...SECTIONS, SETTINGS];
  const section = titled.find((s) => isUnder(p, s.root ?? s.href));
  if (section) return { title: section.label, icon: section.icon };
  return p.startsWith("/items/") ? ITEM_HISTORY : ITEMS_LIST;
}

/** A command-palette destination, in the palette's own words and icons. */
export interface PaletteDestination {
  id: string;
  href: SectionHref | SettingsHref | "/";
  label: string;
  sub: string;
  icon: LucideIcon;
}

const NAV_LABEL: Readonly<Record<SectionHref | SettingsHref, string>> = Object.fromEntries(
  [...SECTIONS, ...SETTINGS_PAGES].map((e) => [e.href, e.label]),
) as Record<SectionHref | SettingsHref, string>;

/** A destination named as the sidebar names its page. */
const toPage = (id: string, href: SectionHref | SettingsHref, sub: string, icon: LucideIcon): PaletteDestination => ({
  id,
  href,
  label: NAV_LABEL[href],
  sub,
  icon,
});

/** The palette's destinations, in its order; the first six are its idle "מעברים מהירים". Three are
 *  named in the palette's own words. */
export const PALETTE_DESTINATIONS: readonly PaletteDestination[] = [
  { id: "packages", label: "מארזים", sub: "רשימת המארזים וקליטת מארז", icon: Package, href: "/packages" },
  { id: "items", label: "ניהול פריטים", sub: "דוחות ורשימת פריטים", icon: LayoutDashboard, href: "/" },
  toPage("testing", "/testing", "תור העמדה ובדיקות פעילות", FlaskConical),
  toPage("dashboard", DASHBOARD_ROOT, "תמונת מצב, מדדים וניתוחים", LayoutDashboard),
  toPage("shipments", "/shipments", "קליטת משלוחים", Truck),
  toPage("files", "/files", "קבצים מצורפים", Folder),
  toPage("stations", "/settings/test-stations", "הגדרות · סוגי עמדות ועמדות", Monitor),
  toPage("routes", "/settings/testing-routes", "הגדרות", SettingsGlyph),
  toPage("popup-templates", "/settings/popup-templates", "הגדרות", SettingsGlyph),
  toPage("itemtypes", "/settings/item-types", "הגדרות", Tag),
  { id: "pkgtypes", label: "סוגי מארזים", sub: "הגדרות · תכולת מארז ומסלול", icon: Package, href: "/settings/packages" },
  toPage("reference", "/settings/reference-items", "הגדרות", Package),
];
