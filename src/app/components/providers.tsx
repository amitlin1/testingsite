"use client";
import * as React from "react";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { theme } from "../theme/muiTheme";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
