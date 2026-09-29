"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { ModLibraryEntry } from "@/contracts/mod";
import { AppShell } from "./app-shell";

async function library(): Promise<ModLibraryEntry[]> { const response = await fetch("/api/mods"); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.library; }
function megabytes(bytes: number): string { return (bytes / 1_048_576).toFixed(1); }

export function ModLibraryPage() {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["mod-library"], queryFn: library });
  return <AppShell active="mods"><header className="topbar"><div><p className="eyebrow">{t("modLibrary.eyebrow")}</p><h1>{t("modLibrary.title")}</h1><p className="page-subtitle">{t("modLibrary.subtitle")}</p></div><button className="button ghost" onClick={() => void query.refetch()}>{t("common.refresh")}</button></header>
    <section className="mod-section"><h3>{t("modLibrary.runtimes")}</h3><p className="muted">{t("modLibrary.runtimesHelp")}</p>
      {query.isLoading ? <p className="muted">{t("modLibrary.loading")}</p> : query.error ? <div className="settings-compatibility-warning">{query.error.message}</div> : <div className="record-list">{(query.data ?? []).map((entry) => <div key={entry.id}><span>
        <strong>{entry.name} {entry.version}</strong>
        <small>{t(`mods.variant.${entry.variant}`)} · {t(entry.downloaded ? "modLibrary.downloaded" : "modLibrary.notDownloaded")} · {t("modLibrary.size", { size: megabytes(entry.sizeBytes) })} · {entry.license}</small>
        <small><a href={entry.projectUrl} target="_blank" rel="noreferrer">{entry.project}</a></small>
        <small title={entry.sha256}>{t("modLibrary.checksum", { sha256: entry.sha256 })}</small>
        <small>{entry.detectedIn.length ? <>{t("modLibrary.detectedIn")} {entry.detectedIn.map((world, index) => <span key={world.worldId}>{index > 0 && ", "}<Link href={`/worlds/${world.worldId}`}>{world.displayName}</Link></span>)}</> : t("modLibrary.notDetected")}</small>
      </span></div>)}</div>}
    </section>
  </AppShell>;
}
