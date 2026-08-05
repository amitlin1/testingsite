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
 * system; Action Blue (#0066cc) active state because this is a light surface.
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
        borderBottom: "1px solid #e0e0e0",
        background: "rgba(245,245,247,0.8)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
      }}
    >
      <Typography
        sx={{ fontSize: 14, fontWeight: 700, color: "#1d1d1f", whiteSpace: "nowrap", flexShrink: 0 }}
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
          scrollbarColor: "rgba(0,0,0,0.2) transparent",
          "&::-webkit-scrollbar": { height: 6 },
          "&::-webkit-scrollbar-thumb": { background: "rgba(0,0,0,0.2)", borderRadius: "9999px" },
          "&::-webkit-scrollbar-track": { background: "transparent" },
        }}
      >
        {links.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.path || pathname?.startsWith(item.path + "/");
          return (
            <Box
              key={item.path}
              component={Link}
              href={item.path}
              sx={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                gap: 0.75,
                flexShrink: 0,
                px: 1.5,
                borderRadius: "8px",
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: active ? "#0066cc" : "#5a5a5f",
                textDecoration: "none",
                whiteSpace: "nowrap",
                transition: "background-color 0.15s ease, color 0.15s ease",
                "&:hover": { bgcolor: "rgba(0,0,0,0.04)" },
                ...(active && {
                  "&::after": {
                    content: '""',
                    position: "absolute",
                    insetInline: 0,
                    bottom: 0,
                    height: 2,
                    borderRadius: "2px 2px 0 0",
                    bgcolor: "#0066cc",
                  },
                }),
              }}
            >
              <Icon sx={{ fontSize: 18 }} />
              {item.label}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
