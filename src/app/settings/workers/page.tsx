"use client";
import { Box, GlobalStyles } from "@mui/material";
import WorkersTable from "./WorkersTable";
import PageHeader from "../components/PageHeader";

export default function WorkersPage() {
  return (
    <>
      <GlobalStyles 
        styles={{ 
          html: { overflow: "hidden", margin: 0, padding: 0, height: "100%", width: "100%" }, 
          body: { overflow: "hidden", margin: 0, padding: 0, height: "100%", width: "100%" },
          "#__next": { height: "100%", width: "100%" } 
        }} 
      />
      <Box sx={{ 
        position: "fixed",
        top: { xs: "56px", sm: "64px" },
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        overflow: "hidden",
        direction: "rtl",
        bgcolor: "background.default",
        zIndex: 100,
        display: "flex", 
        flexDirection: "column",
        m: 0,
        p: 0,
      }}>
        <PageHeader 
          title="ניהול עובדים" 
          subtitle="הוספה, עריכה ומחיקה של עובדים במערכת"
        />
        <Box sx={{ flex: 1, overflow: "hidden", width: "100%", p: 0 }}>
          <WorkersTable />
        </Box>
      </Box>
    </>
  );
}

