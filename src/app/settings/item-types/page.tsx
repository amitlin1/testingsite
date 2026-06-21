"use client";
import { Box, GlobalStyles } from "@mui/material";
import CrudTable, { Column } from "../components/CrudTable";
import PageHeader from "../components/PageHeader";

export default function ItemTypesPage() {
  const columns: Column[] = [
    { field: "item_type_id", headerName: "מזהה", width: 80 },
    { field: "item_type_desc", headerName: "תיאור סוג פריט" },
  ];

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
          title="ניהול סוגי פריטים" 
          subtitle="הגדרת סוגי הפריטים הנבדקים במערכת"
        />
        <Box sx={{ flex: 1, overflow: "hidden", width: "100%", p: 0 }}>
          <CrudTable
            apiUrl="/api/settings/item-types"
            columns={columns}
            idField="item_type_id"
            nameField="item_type_desc"
            entityName="סוג פריט"
          />
        </Box>
      </Box>
    </>
  );
}
