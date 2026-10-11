"use client";
import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
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

  // The settings layout owns the frame (scroll, padding, 1180 column).
  return (
    <div dir="rtl">
      <SettingsToolbar
        title="עמדות בדיקה"
        subtitle="הגדרת סוגי העמדות והעמדות המשויכות אליהן."
      />

      {/* master–detail grid: types (master) · stations (detail); one column
          on narrow screens (settings.css .stations-grid) */}
      <div className="stations-grid">
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
          <div className="settings-card settings-empty" style={{ minHeight: 240, padding: "64px var(--space-lg)" }}>
            <LayoutGrid size={34} strokeWidth={1.5} color="var(--color-ink-muted-48)" aria-hidden />
            <div className="settings-empty__title">בחר סוג עמדה מהרשימה</div>
            <div>העמדות המשויכות יוצגו כאן.</div>
          </div>
        )}
      </div>
    </div>
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
