"use client";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

export function useHostPlatform() {
  return useQuery({ queryKey: ["host"], staleTime: Infinity, queryFn: async () => { const response = await fetch("/api/host"); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.host.platform as string; } }).data;
}

// A Windows server build on a non-Windows host runs under Wine, so say so.
export function usePlatformLabel() {
  const { t } = useTranslation();
  const host = useHostPlatform();
  return (platform: "linux" | "windows") => t(platform === "linux" ? "platform.linux" : host && host !== "win32" ? "platform.windowsWine" : "platform.windows");
}
