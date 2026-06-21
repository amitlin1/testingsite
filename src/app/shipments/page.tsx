import React from "react";
import { Box, Typography } from "@mui/material";
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import ShipmentTable from "../components/shipments/ShipmentTable";

export default function ShipmentsPage() {
    return (
        <Box sx={{ 
            minHeight: "100vh",
            background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
            p: 3,
            direction: "rtl"
        }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 4, gap: 2 }}>
                <LocalShippingIcon sx={{ fontSize: 40, color: "#1976d2" }} />
                <Typography 
                    variant="h4" 
                    fontWeight="800"
                    sx={{ 
                        background: "linear-gradient(45deg, #1976d2, #90caf9)",
                        backgroundClip: "text",
                        textFillColor: "transparent",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                    }}
                >
                 ניהול משלוחים נכנסים
                </Typography>
            </Box>
            <ShipmentTable />
        </Box>
    );
}
