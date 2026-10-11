"use client";
import Link from "next/link";
import { Tag } from "@/components/ui";
import CrudTable, { Column } from "../components/CrudTable";

export default function ItemTypesPage() {
  const columns: Column[] = [
    { field: "item_type_id", headerName: "מזהה", width: 80 },
    { field: "item_type_desc", headerName: "תיאור סוג פריט" },
    {
      field: "is_package",
      headerName: "",
      width: 140,
      readOnly: true,
      renderCell: (row) =>
        row.is_package ? (
          // The "מארז" tag (design/Settings.dc.html): a package type is an item
          // type flagged is_package; its contents are edited under /settings/packages.
          <Link href="/settings/packages" title="תכולת המארז מוגדרת במסך מארזים" aria-label="מארז: פתח את תכולת המארז במסך מארזים" style={{ textDecoration: "none" }}>
            <Tag tone="primary">מארז</Tag>
          </Link>
        ) : null,
    },
  ];

  return (
    <CrudTable
      apiUrl="/api/settings/item-types"
      columns={columns}
      idField="item_type_id"
      nameField="item_type_desc"
      entityName="סוג פריט"
      title="סוגי פריטים"
      subtitle="הגדרת סוגי הפריטים הנבדקים במערכת. סוגי מארז נוצרים ומקבלים תכולה במסך מארזים."
      countLabel="סוגים"
    />
  );
}
