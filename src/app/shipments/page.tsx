import React from "react";
import { Box, Typography } from "@mui/material";
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import ShipmentTable from "../components/shipments/ShipmentTable";

export default function ShipmentsPage() {
    return (
        <Box sx={{
            minHeight: "100%",
            bgcolor: "#f5f5f7",
            p: 3,
            direction: "rtl"
        }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 4, gap: 2 }}>
                <LocalShippingIcon sx={{ fontSize: 40, color: "primary.main" }} />
                <Typography
                    variant="h4"
                    fontWeight={700}
                    sx={{ color: "text.primary", letterSpacing: "-0.3px" }}
                >
                 ניהול משלוחים נכנסים
                </Typography>
            </Box>
            <ShipmentTable />
        </Box>
    );
}
