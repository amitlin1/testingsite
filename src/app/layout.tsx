import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
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
      >
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
