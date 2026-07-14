"use client";
import { Box } from "@/components/ui";
import WorkersTable from "./WorkersTable";
import PageHeader from "../components/PageHeader";

export default function WorkersPage() {
  return (
    <Box sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}>
        <PageHeader
          title="ניהול עובדים"
          subtitle="הוספה, עריכה ומחיקה של עובדים במערכת"
        />
        <Box sx={{ flex: 1, overflow: "hidden", width: "100%", p: 0 }}>
          <WorkersTable />
        </Box>
    </Box>
  );
}

