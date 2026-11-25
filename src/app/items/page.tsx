"use client";
import ItemTable from "./_components/ItemTable";

// "דוחות וניהול פריטים" — the old home page, kept at /items (hidden from the
// menu, src/app/navigation.ts). "/" now opens מארזים ופריטים (app/page.tsx).
import "@/components/items.css";

export default function Page() {
  return (
    // .items-home fills AppShell's content box, so the items table can take
    // the remaining height and scroll inside it (header pinned).
    <div className="items-home">
      <ItemTable />
    </div>
  );
}
