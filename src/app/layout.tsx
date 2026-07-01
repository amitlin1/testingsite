import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v14-appRouter";
import Providers from "./components/providers";
import AppShell from "./components/AppShell";

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
          backgroundColor: "#f5f5f7",
        }}
      >
        <AppRouterCacheProvider
          options={{
            enableCssLayer: true,
            key: "mui",
          }}
        >
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
