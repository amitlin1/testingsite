"use client";
import React, { useState } from "react";
import { Grid, Paper, Typography, Box } from "@/components/ui";
import StationTypesTable from "./StationTypesTable";
import StationsTable from "./StationsTable";

export default function TestStationsPage() {
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [selectedTypeName, setSelectedTypeName] = useState<string>("");

  const handleTypeSelect = (id: number, name: string) => {
    setSelectedTypeId(id);
    setSelectedTypeName(name);
  };

  return (
    <Box sx={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
    }}>

        {/* Page Header */}
        <Box sx={{
          textAlign: "center",
          flexShrink: 0,
          width: "100%",
          p: 1,
          borderBottom: "1px solid",
          borderColor: "divider"
        }}>
          <Typography variant="h5" sx={{ fontWeight: 700, color: "#333", fontSize: "1.4rem" }}>
            ניהול עמדות בדיקה
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8rem" }}>
            הגדרת סוגי עמדות והעמדות המשויכות אליהן
          </Typography>
        </Box>

        {/* Main Content Grid Container */}
        <Box sx={{
          flex: 1,
          overflow: "hidden",
          width: "100%",
          p: 0
        }}>
          <Grid container spacing={0} sx={{ height: "100%", minHeight: 0, width: "100%", m: 0 }}>

            {/* Left Panel: Station Types (Master) */}
            <Grid size={{ xs: 12, md: 4 }} sx={{ height: "100%", minHeight: 0 }}>
              <Paper
                elevation={0}
                square
                sx={{
                  p: 0,
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  borderLeft: "1px solid", // Separator for RTL
                  borderColor: "divider"
                }}
              >
                <StationTypesTable
                  selectedId={selectedTypeId}
                  onSelect={handleTypeSelect}
                />
              </Paper>
            </Grid>

            {/* Right Panel: Stations (Detail) */}
            <Grid size={{ xs: 12, md: 8 }} sx={{ height: "100%", minHeight: 0 }}>
              <Paper
                elevation={0}
                square
                sx={{
                  p: 0,
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden"
                }}
              >
                {selectedTypeId ? (
                  <StationsTable
                    typeId={selectedTypeId}
                    typeName={selectedTypeName}
                  />
                ) : (
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 2, opacity: 0.6 }}>
                    <Box sx={{ fontSize: "3rem", opacity: 0.2 }}>📋</Box>
                    <Typography variant="h6" sx={{ color: "text.secondary" }}>בחר סוג עמדה לצפייה בעמדות</Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>יש לבחור סוג עמדה מהרשימה מימין</Typography>
                  </Box>
                )}
              </Paper>
            </Grid>
          </Grid>
        </Box>
    </Box>
  );
}
