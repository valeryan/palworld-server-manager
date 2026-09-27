import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import "./globals.css";
import "./remote.css";
import { Providers } from "@/components/providers";
import { themeStorageKey, themes } from "@/lib/themes";

const themeInitializer = `try{var t=localStorage.getItem(${JSON.stringify(themeStorageKey)});if(${JSON.stringify(themes.map((theme) => theme.id))}.includes(t))document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  title: "Palworld Server Manager",
  description: "Manage multiple Palworld dedicated servers",
  icons: { icon: process.env.NODE_ENV === "development" ? "/icons/app-dev.ico" : "/icons/app.ico" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head><Script id="psm-theme" strategy="beforeInteractive">{themeInitializer}</Script></head>
      <body className="min-h-full"><Providers>{children}</Providers></body>
    </html>
  );
}
