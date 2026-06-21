"use client";
import { Box, Container } from "@mui/material";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ flexGrow: 1, py: 4, px: { xs: 2, md: 4 }, direction: "rtl" }}>
      <Container maxWidth="xl" sx={{ maxWidth: "1400px !important" }}>
        {children}
      </Container>
    </Box>
  );
}


