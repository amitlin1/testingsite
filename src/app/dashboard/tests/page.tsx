// §1 — /dashboard/tests IS the dashboard now, not a hub of eight cards linking
// to eight pages that each re-declared the same filter state.
//
// The shell is a client component because the whole screen is one live view:
// shared filters, a 60s refresh and a URL that is a projection of the state.
// `useSearchParams` inside it needs a Suspense boundary, and `force-dynamic`
// keeps the deep-link (`?tab=slow&customerId=4821`) meaningful on first paint
// instead of serving a prerendered "overview".

import { Suspense } from "react";
import type { Metadata } from "next";

import DashboardShell from "./DashboardShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "לוח ניהול",
  description: "עומס עמדות, זמנים, משלוחים ולקוחות במסך אחד",
};

export default function DashboardTestsPage() {
  return (
    <Suspense fallback={null}>
      <DashboardShell />
    </Suspense>
  );
}
