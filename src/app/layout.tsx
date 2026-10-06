import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import "./globals.css";
import { Providers } from "@/components/providers";
import { themeStyleSheet } from "@/lib/themes";
import { getTheme } from "@/server/services/appearance";

export const metadata: Metadata = {
  title: "Palworld Server Manager",
  description: "Manage multiple Palworld dedicated servers",
  icons: { icon: process.env.NODE_ENV === "development" ? "/icons/app-dev.ico" : "/icons/app.ico" },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  const theme = await getTheme();
  return (
    <html lang="en" className="h-full antialiased" data-theme={theme}>
      <head><style id="psm-theme-palettes">{themeStyleSheet()}</style></head>
      <body className="min-h-full"><Providers initialTheme={theme}>{children}</Providers></body>
    </html>
  );
}
