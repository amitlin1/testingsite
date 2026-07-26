import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "@/styles/shifthouse.css";
import AppShell from "./components/AppShell";
import { Providers } from "@/app/providers";

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
        <Providers isDev={process.env.IS_DEV === "1"}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
