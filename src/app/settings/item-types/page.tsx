"use client";
import CrudTable, { Column } from "../components/CrudTable";

export default function ItemTypesPage() {
  const columns: Column[] = [
    { field: "item_type_id", headerName: "מזהה", width: 80 },
    { field: "item_type_desc", headerName: "תיאור סוג פריט" },
  ];

  return (
    <CrudTable
      apiUrl="/api/settings/item-types"
      columns={columns}
      idField="item_type_id"
      nameField="item_type_desc"
      entityName="סוג פריט"
      title="סוגי פריטים"
      subtitle="הגדרת סוגי הפריטים הנבדקים במערכת."
      countLabel="סוגים"
    />
  );
}
