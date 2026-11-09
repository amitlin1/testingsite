"use client";
import { Suspense } from "react";
import ItemTable from "../components/ItemTable";

// "דוחות וניהול פריטים" — the old home page, kept at /items (hidden from the
// menu, navBar.tsx). "/" now opens מארזים ופריטים (app/page.tsx).
import "@/components/items.css";

export default function Page() {
  return (
    // .items-home fills AppShell's content box, so the items table can take
    // the remaining height and scroll inside it (header pinned).
    <div className="items-home">
      {/* ItemTable reads ?q=/?status= (command-palette deep links) via
          useSearchParams, which needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <ItemTable />
      </Suspense>
    </div>
  );
}
