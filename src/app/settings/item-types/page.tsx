"use client";
import Link from "next/link";
import CrudTable, { Column } from "../components/CrudTable";

/** The "מארז" pill from design/Settings.dc.html — a package type is an item
 *  type flagged is_package; its contents are edited under /settings/packages. */
function PackagePill() {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 600, color: "#0066cc", background: "#e6efff", borderRadius: 9999, padding: "2px 8px", whiteSpace: "nowrap" }}>
      מארז
    </span>
  );
}

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
          <Link href="/settings/packages" title="תכולת המארז מוגדרת במסך מארזים" style={{ textDecoration: "none" }}>
            <PackagePill />
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
