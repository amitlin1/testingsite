"use client";
import { Box } from "@mui/material";
import CrudTable, { Column } from "../components/CrudTable";
import PageHeader from "../components/PageHeader";

export default function TestStationStatusPage() {
  const columns: Column[] = [
    { field: "test_station_status_id", headerName: "מזהה", width: 80 },
    { field: "test_station_status_desc", headerName: "תיאור סטטוס" },
  ];

  return (
    <Box sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}>
        <PageHeader
          title="ניהול סטטוסי עמדה"
          subtitle="הגדרת הסטטוסים האפשריים לעמדות בדיקה"
        />
        <Box sx={{ flex: 1, overflow: "hidden", width: "100%", p: 0 }}>
          <CrudTable
            apiUrl="/api/settings/test-station-status"
            columns={columns}
            idField="test_station_status_id"
            nameField="test_station_status_desc"
            entityName="סטטוס עמדה"
          />
        </Box>
    </Box>
  );
}
