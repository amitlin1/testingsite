"use client";
import { Box } from "@mui/material";
import CrudTable, { Column } from "../components/CrudTable";
import PageHeader from "../components/PageHeader";

export default function SourcesPage() {
  const columns: Column[] = [
    { field: "source_id", headerName: "מזהה", width: 80 },
    { field: "source_desc", headerName: "תיאור מקור" },
  ];

  return (
    <Box sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}>
        <PageHeader
          title="ניהול מקורות"
          subtitle="הגדרת מקורות המשלוחים במערכת"
        />
        <Box sx={{ flex: 1, overflow: "hidden", width: "100%", p: 0 }}>
          <CrudTable
            apiUrl="/api/settings/sources"
            columns={columns}
            idField="source_id"
            nameField="source_desc"
            entityName="מקור"
          />
        </Box>
    </Box>
  );
}

