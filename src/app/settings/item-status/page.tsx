"use client";
import CrudTable, { Column } from "../components/CrudTable";

export default function ItemStatusPage() {
  const columns: Column[] = [
    { field: "item_status_id", headerName: "מזהה", width: 80 },
    { field: "item_status_desc", headerName: "תיאור סטטוס" },
  ];

  return (
    <CrudTable
      apiUrl="/api/settings/item-status"
      columns={columns}
      idField="item_status_id"
      nameField="item_status_desc"
      entityName="סטטוס פריט"
      title="סטטוסי פריט"
      subtitle="הסטטוסים האפשריים לפריט לאורך תהליך הבדיקה."
      countLabel="סטטוסים"
    />
  );
}
