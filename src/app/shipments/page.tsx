"use client";
import { Box } from "@/components/ui";
import ShipmentTable from "../components/shipments/ShipmentTable";
import "./shipments.css";

export default function ShipmentsPage() {
    return (
        <Box sx={{ p: 3 }}>
            <ShipmentTable />
        </Box>
    );
}
