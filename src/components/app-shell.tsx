"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationUpdateStatus } from "@/contracts/application-update";
import { SphereMark } from "./sphere-mark";

export function AppShell({ active, children, className = "" }: { active: "worlds" | "operations" | "settings"; children: ReactNode; className?: string }) {
  const { t } = useTranslation();
  const update = useQuery({ queryKey: ["application-update"], queryFn: async () => { const response = await fetch("/api/application/update"); if (!response.ok) throw new Error("Update check failed."); return (await response.json() as { status: ApplicationUpdateStatus }).status; }, staleTime: 6 * 60 * 60 * 1_000, refetchInterval: 6 * 60 * 60 * 1_000, retry: false });
  return <div className="app-shell"><aside className="sidebar"><Link className="brand" href="/"><span className="brand-mark"><SphereMark label="P" /></span><div><strong>{t("app.name")}</strong><small>{t("app.subtitle")}</small></div></Link><nav><Link className={active === "worlds" ? "active" : ""} href="/">{t("nav.worlds")}</Link><Link className={active === "operations" ? "active" : ""} href="/operations">{t("nav.operations")}</Link><Link className={active === "settings" ? "active" : ""} href="/settings">{t("nav.settings")}</Link></nav><div className="sidebar-foot"><span className="pulse" />{t("app.status.online")}{process.env.NODE_ENV === "development" && <strong className="development-indicator">{t("app.runtime.development")}</strong>}<small>{t("app.version", { version: update.data?.currentVersion ?? "…" })}</small>{update.data?.updateAvailable && update.data.releaseUrl && <a className="application-update" href={update.data.releaseUrl} target="_blank" rel="noreferrer">{t("app.updateAvailable", { version: update.data.publishedVersion })}</a>}</div></aside><main className={`workspace ${className}`}>{children}</main></div>;
}
