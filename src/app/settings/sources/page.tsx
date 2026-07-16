"use client";
import CrudTable, { Column } from "../components/CrudTable";

export default function SourcesPage() {
  const columns: Column[] = [
    { field: "source_id", headerName: "מזהה", width: 80 },
    { field: "source_desc", headerName: "תיאור מקור" },
  ];

  return (
    <CrudTable
      apiUrl="/api/settings/sources"
      columns={columns}
      idField="source_id"
      nameField="source_desc"
      entityName="מקור"
      title="ניהול מקורות"
      subtitle="מקורות המשלוחים הנכנסים למערכת."
      countLabel="מקורות"
    />
  );
}
