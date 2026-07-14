"use client";
import { Box } from "@mui/material";
import CrudTable, { Column } from "../components/CrudTable";
import PageHeader from "../components/PageHeader";

export default function CustomersPage() {
  const columns: Column[] = [
    { field: "id", headerName: "מזהה", width: 80 },
    { field: "name", headerName: "שם לקוח" },
    { field: "customer_code", headerName: "קוד לקוח" },
  ];

  return (
    <Box sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}>
        <PageHeader
          title="ניהול לקוחות"
          subtitle="צפייה, הוספה ועריכה של לקוחות במערכת"
        />
        <Box sx={{ flex: 1, overflow: "hidden", width: "100%", p: 0 }}>
          <CrudTable
            apiUrl="/api/settings/customers"
            columns={columns}
            idField="id"
            nameField="name"
            entityName="לקוח"
          />
        </Box>
    </Box>
  );
}
