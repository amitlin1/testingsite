import type { Metadata } from "next";
import TestsSidebar from "@/app/components/dashboard/TestsSidebar";

export const metadata: Metadata = {
  title: "Tests Dashboard",
  description: "Advanced analytics and tracking for current tests",
};

export default function TestsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", width: "100%", minHeight: "100vh", backgroundColor: "#f4f6f8" }}>
      <TestsSidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflowX: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
