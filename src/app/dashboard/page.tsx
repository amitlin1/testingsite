// /dashboard — the managers' home: the summary screen. The detailed board,
// with its tabs and filters, stays at /dashboard/tests and is one link away.
// Manager-only through the /dashboard prefix of src/lib/routes.ts.

import type { Metadata } from "next";

import SummaryScreen from "./SummaryScreen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "לוח ניהול",
  description: "תמונת המצב של המעבדה במספרים: מה עבר בתקופה ומה נמצא בה עכשיו",
};

export default function DashboardSummaryPage() {
  return <SummaryScreen />;
}
