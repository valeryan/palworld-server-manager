import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./remote.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Palworld Server Manager",
  description: "Manage multiple Palworld dedicated servers",
  icons: { icon: process.env.NODE_ENV === "development" ? "/icons/app-dev.ico" : "/icons/app.ico" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full"><Providers>{children}</Providers></body>
    </html>
  );
}
