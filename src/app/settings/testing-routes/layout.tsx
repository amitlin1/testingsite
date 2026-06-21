"use client";

export default function TestingRoutesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Return children directly without any wrapper to allow full control over layout
  return <>{children}</>;
}

