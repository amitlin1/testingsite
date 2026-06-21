"use client";

import * as React from "react";
import { Box, Typography, Button } from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import Link from "next/link";
import ItemTypeTrackingTable from "@/app/components/dashboard/ItemTypeTrackingTable";
import { ItemTypeTrackingRow } from "@/types/dashboard";

export default function ItemTypesPage() {
  const [data, setData] = React.useState<ItemTypeTrackingRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/dashboard/tests/item-types");
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch (error) {
      console.error("Failed to fetch item types", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 4, direction: "rtl" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 4 }}>
        <Typography variant="h4" fontWeight="bold" color="primary">
          מעקב סוגי פריטים
        </Typography>
        <Link href="/dashboard/tests" passHref>
          <Button variant="outlined" startIcon={<ArrowForwardIcon />}>
            חזרה ללוח ראשי
          </Button>
        </Link>
      </Box>

      <ItemTypeTrackingTable data={data} loading={loading} />
    </Box>
  );
}
