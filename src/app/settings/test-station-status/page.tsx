"use client";
import CrudTable, { Column } from "../components/CrudTable";

export default function TestStationStatusPage() {
  const columns: Column[] = [
    { field: "test_station_status_id", headerName: "מזהה", width: 80 },
    { field: "test_station_status_desc", headerName: "תיאור סטטוס" },
  ];

  return (
    <CrudTable
      apiUrl="/api/settings/test-station-status"
      columns={columns}
      idField="test_station_status_id"
      nameField="test_station_status_desc"
      entityName="סטטוס עמדה"
      title="סטטוסי עמדת בדיקה"
      subtitle="מצבי הזמינות האפשריים לעמדות הבדיקה."
      countLabel="סטטוסים"
    />
  );
}
