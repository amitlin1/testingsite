"use client";

/**
 * The shared settings layout now owns the padding, height and scroll context,
 * so this nested layout is a simple passthrough (kept only for route grouping).
 * It intentionally adds no wrapper of its own so the page inherits the same
 * height:100% flex context as every other settings page.
 */
export default function TestingRoutesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
