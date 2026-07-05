// import React from "react";
// import { Box, Typography } from "@mui/material";
// import LocalShippingIcon from '@mui/icons-material/LocalShipping';
// import ShipmentTable from "../components/shipments/ShipmentTable";

// export default function ShipmentsPage() {
//     return (
//         <Box sx={{
//             minHeight: "100%",
//             bgcolor: "#f5f5f7",
//             p: 3,
//             direction: "rtl"
//         }}>
//             <Box sx={{ display: 'flex', alignItems: 'center', mb: 4, gap: 2 }}>
//                 <LocalShippingIcon sx={{ fontSize: 40, color: "primary.main" }} />
//                 <Typography
//                     variant="h4"
//                     fontWeight={700}
//                     sx={{ color: "text.primary", letterSpacing: "-0.3px" }}
//                 >
//                     ניהול משלוחים נכנסים
//                 </Typography>
//             </Box>
//             <ShipmentTable />
//         </Box>
//     );
// }

"use client";
import React from "react";
import { Box } from "@mui/material";
import ShipmentTable from "../components/shipments/ShipmentTable";
import PageHeader from "../settings/components/PageHeader";

export default function ShipmentsPage() {
    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            p: 2
        }}>
            <PageHeader
                title="ניהול משלוחים נכנסים"
                subtitle="צפייה וניהול של כל המשלוחים הנכנסים למערכת"
            />
            <Box sx={{ flex: 1, overflow: 'hidden', mt: 2 }}>
                <ShipmentTable />
            </Box>
        </Box>
    );
}