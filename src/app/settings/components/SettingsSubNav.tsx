"use client";
import { Box, Typography } from "@/components/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { settingsLinks } from "../settingsNav";
import { canSeeInNav } from "@/lib/routes";

/**
 * Settings secondary navigation — a horizontal tab strip pinned to the top of
 * the settings content area (rendered once by settings/layout.tsx, so it shows
 * on every /settings/** route). Light/frosted surface per the Shifthouse design
 * system; Action Blue (var(--color-primary)) active state because this is a light surface.
 * Routes/labels/icons come from the shared `settingsLinks` single source.
 */
export default function SettingsSubNav() {
  const pathname = usePathname();
  // Only show tabs the current role may open (same gate as the middleware), so a
  // tester never sees "לקוחות"/"משתמשים והרשאות" tabs that would bounce to /no-auth.
  // canSeeInNav (not resolveAccess) so the tab strip stays correct while the
  // session is still loading — see the note on canSeeInNav.
  const { data: session } = useSession();
  const roles = session?.roles ?? null;
  const links = settingsLinks.filter((l) => canSeeInNav(l.path, roles));

  return (
    <Box
      component="nav"
      aria-label="הגדרות מערכת"
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: 2,
        height: 52,
        borderBottom: "1px solid var(--color-hairline)",
        background: "var(--bg-frosted-parchment)",
        backdropFilter: "var(--blur-frosted)",
        WebkitBackdropFilter: "var(--blur-frosted)",
      }}
    >
      <Typography
        sx={{ fontSize: "var(--text-body-sm)", fontWeight: 700, color: "var(--color-ink)", whiteSpace: "nowrap", flexShrink: 0 }}
      >
        הגדרות מערכת
      </Typography>

      {/* Scrolls horizontally on overflow so all 8 tabs stay reachable, never wraps */}
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
          const active = pathname === item.path || pathname?.startsWith(item.path + "/");
          return (
            // States in ui.css (.sh-subnav-tab): hover, the blue active text with its
            // underline, keyboard focus.
            <Link
              key={item.path}
              href={item.path}
              className="sh-subnav-tab"
              aria-current={active ? "page" : undefined}
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
