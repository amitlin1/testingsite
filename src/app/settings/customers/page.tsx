"use client";
import CrudTable, { Column } from "../components/CrudTable";

export default function CustomersPage() {
  const columns: Column[] = [
    { field: "id", headerName: "מזהה", width: 80 },
    { field: "name", headerName: "שם לקוח" },
    { field: "customer_code", headerName: "קוד לקוח" },
  ];

  return (
    <CrudTable
      apiUrl="/api/settings/customers"
      columns={columns}
      idField="id"
      nameField="name"
      entityName="לקוח"
      title="ניהול לקוחות"
      subtitle="הלקוחות שעבורם נבדקים פריטים במערכת."
      countLabel="לקוחות"
    />
  );
}
