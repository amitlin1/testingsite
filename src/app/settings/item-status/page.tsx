"use client";
import { Box } from "@mui/material";
import CrudTable, { Column } from "../components/CrudTable";
import PageHeader from "../components/PageHeader";

export default function ItemStatusPage() {
  const columns: Column[] = [
    { field: "item_status_id", headerName: "מזהה", width: 80 },
    { field: "item_status_desc", headerName: "תיאור סטטוס" },
  ];

  return (
    <Box sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}>
        <PageHeader
          title="ניהול סטטוסי פריט"
          subtitle="הגדרת הסטטוסים האפשריים לפריט בתהליך"
        />
        <Box sx={{ flex: 1, overflow: "hidden", width: "100%", p: 0 }}>
          <CrudTable
            apiUrl="/api/settings/item-status"
            columns={columns}
            idField="item_status_id"
            nameField="item_status_desc"
            entityName="סטטוס פריט"
          />
        </Box>
    </Box>
  );
}
