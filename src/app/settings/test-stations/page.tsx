"use client";
import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Box } from "@/components/ui";
import { LayoutGrid } from "lucide-react";
import SettingsToolbar from "../components/SettingsToolbar";
import StationTypesTable from "./StationTypesTable";
import StationsTable from "./StationsTable";

function TestStationsView() {
  // Deep-link params from the command palette (Ctrl+K):
  //   ?type=<id>            → open that station type in the master–detail
  //   ?type=<id>&station=<id> → …and pre-filter the detail table to that station
  const params = useSearchParams();
  const linkedTypeId = Number(params.get("type")) || null;
  const linkedStationId = Number(params.get("station")) || null;

  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(linkedTypeId);
  const [selectedTypeName, setSelectedTypeName] = useState<string>("");

  // Memoized because StationTypesTable depends on it in the effect that
  // resolves a deep-linked ?type= id to its name.
  const handleTypeSelect = React.useCallback((id: number, name: string) => {
    // id === 0 signals a cleared selection (e.g. the selected type was deleted)
    if (!id) {
      setSelectedTypeId(null);
      setSelectedTypeName("");
      return;
    }
    setSelectedTypeId(id);
    setSelectedTypeName(name);
  }, []);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", direction: "rtl" }}>
      {/* single internal scroll region */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Box sx={{ maxWidth: 1180, mx: "auto", px: 1, py: 1 }}>
          <SettingsToolbar
            title="עמדות בדיקה"
            subtitle="הגדרת סוגי העמדות והעמדות המשויכות אליהן."
          />

          {/* master–detail grid: types (master) · stations (detail) */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "330px 1fr" },
              gap: 2.5,
              mt: 3,
              alignItems: "start",
            }}
          >
            <StationTypesTable selectedId={selectedTypeId} onSelect={handleTypeSelect} />

            {selectedTypeId ? (
              <StationsTable
                typeId={selectedTypeId}
                typeName={selectedTypeName}
                // Only honour ?station= while its parent type is the one the
                // link opened — once the user picks a different type by hand,
                // the stale highlight would filter the table to nothing.
                highlightStationId={selectedTypeId === linkedTypeId ? linkedStationId : null}
              />
            ) : (
              <Box
                sx={{
                  background: "#fff",
                  border: "1px solid #e0e0e0",
                  borderRadius: "16px",
                  minHeight: 240,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1.25,
                  p: "64px 24px",
                  textAlign: "center",
                  color: "#7a7a7a",
                }}
              >
                <LayoutGrid size={34} strokeWidth={1.5} color="#0066cc" />
                <Box sx={{ fontSize: 15, color: "#1d1d1f", fontWeight: 600 }}>בחר סוג עמדה מהרשימה</Box>
                <Box sx={{ fontSize: 13 }}>העמדות המשויכות יוצגו כאן.</Box>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default function TestStationsPage() {
  // useSearchParams needs a Suspense boundary to avoid opting the whole route
  // into client-side rendering at build time.
  return (
    <Suspense fallback={null}>
      <TestStationsView />
    </Suspense>
  );
}
