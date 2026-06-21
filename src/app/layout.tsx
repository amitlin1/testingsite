import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v14-appRouter";
import { Box } from "@mui/material";
import Providers from "./components/providers";
import NavBar from "./components/navBar";

const rubik = localFont({
  src: [
    {
      path: "./fonts/Rubik-VariableFont_wght.ttf",
      style: "normal",
    },
    {
      path: "./fonts/Rubik-Italic-VariableFont_wght.ttf",
      style: "italic",
    },
  ],
  variable: "--font-rubik",
  weight: "300 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "מערכת בדיקות",
  description: "מערכת לניהול בדיקות ומשלוחים",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${rubik.className} ${rubik.variable}`}
        style={{
          margin: 0,
          minHeight: "100vh",
          overflowX: "hidden",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "white",
        }}
      >
        <AppRouterCacheProvider
          options={{
            enableCssLayer: true,
            key: "mui",
          }}
        >
          <Providers>
            <NavBar />
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                overflowX: "hidden",
                overflowY: "auto",
              }}
            >
              <Box sx={{ minHeight: "100%", width: "100%" }}>{children}</Box>
            </Box>
          </Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
