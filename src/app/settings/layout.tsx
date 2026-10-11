"use client";
import SettingsSubNav from "./components/SettingsSubNav";
import "./settings.css";

/**
 * Settings section wrapper.
 *
 * The shared AppShell already owns the viewport, margins and the single
 * scroll container (its content box is `height: calc(100vh - 56px);
 * overflow-y: auto`). This layout must NOT reset html/body or force a
 * full-viewport height — it fills the shell's content box with a
 * definite-height column: the sub-nav, then the ONE page frame every settings
 * page shares (settings.css `.settings-content` / `.settings-page`): its
 * scroll, its padding and the 1180 column live here, so no page adds a frame
 * of its own. A table page marks its root `.settings-fill` to fill the frame
 * and scroll the table inside instead.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", direction: "rtl" }}>
      <SettingsSubNav />
      {/* min-height:0 lets the frame shrink instead of pushing the sub-nav
          out; the sub-nav stays full-bleed above it. */}
      <div className="settings-content">
        <div className="settings-page">{children}</div>
      </div>
    </div>
  );
}
