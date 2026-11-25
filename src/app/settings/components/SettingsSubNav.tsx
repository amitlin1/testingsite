"use client";
import { Box, Typography } from "@/components/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { SETTINGS, SETTINGS_PAGES, activeHref } from "@/app/navigation";
import { canSeeInNav } from "@/lib/routes";

/**
 * Settings secondary navigation — a horizontal tab strip pinned to the top of
 * the settings content area (rendered once by settings/layout.tsx, so it shows
 * on every /settings/** route). Light/frosted surface per the Shifthouse design
 * system; Action Blue (var(--color-primary)) active state because this is a light surface.
 */
export default function SettingsSubNav() {
  const pathname = usePathname();
  // Only show tabs the current role may open (same gate as the middleware), so a
  // tester never sees "לקוחות"/"משתמשים והרשאות" tabs that would bounce to /no-auth.
  // canSeeInNav (not resolveAccess) so the tab strip stays correct while the
  // session is still loading — see the note on canSeeInNav.
  const { data: session } = useSession();
  const roles = session?.roles ?? null;
  const links = SETTINGS_PAGES.filter((l) => canSeeInNav(l.href, roles));
  const current = activeHref(pathname, links);

  return (
    <Box
      component="nav"
      aria-label={SETTINGS.label}
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: 2,
        height: "var(--settings-subnav-h)",
        borderBottom: "1px solid var(--color-hairline)",
        background: "var(--bg-frosted-parchment)",
        backdropFilter: "var(--blur-frosted)",
        WebkitBackdropFilter: "var(--blur-frosted)",
      }}
    >
      <Typography
        sx={{ fontSize: "var(--text-body-sm)", fontWeight: 700, color: "var(--color-ink)", whiteSpace: "nowrap", flexShrink: 0 }}
      >
        {SETTINGS.label}
      </Typography>

      {/* Scrolls horizontally on overflow so every tab stays reachable, never wraps */}
      <Box
        sx={{
          display: "flex",
          alignItems: "stretch",
          gap: 0.5,
          flex: 1,
          minWidth: 0,
          height: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "thin",
        }}
      >
        {links.map((item) => {
          const Icon = item.icon;
          return (
            // States in settings.css (.sh-subnav-tab): hover, the blue active text with
            // its underline, keyboard focus.
            <Link
              key={item.href}
              href={item.href}
              className="sh-subnav-tab"
              aria-current={item.href === current ? "page" : undefined}
            >
              <Icon fontSize={18} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </Box>
    </Box>
  );
}
