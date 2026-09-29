"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useEffectEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import type { JobView } from "@/contracts/job";
import type { ModLibraryEntry } from "@/contracts/mod";
import { useJobPresentation } from "@/lib/use-job-presentation";
import { AppShell } from "./app-shell";
import { Toast } from "./toast";

async function request<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, init); const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body; }
function mebibytes(bytes: number): string { return (bytes / 1_048_576).toFixed(1); }

export function ModLibraryPage() {
  const { t } = useTranslation(); const client = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null); const [confirming, setConfirming] = useState<ModLibraryEntry | null>(null); const [jobs, setJobs] = useState<Record<string, string>>({});
  const query = useQuery({ queryKey: ["mod-library"], queryFn: async () => (await request<{ library: ModLibraryEntry[] }>("/api/mods")).library, refetchInterval: (state) => state.state.data?.some((entry) => entry.downloading) ? 2_000 : false });
  const download = useMutation({
    mutationFn: (entry: ModLibraryEntry) => request<{ jobId: string }>(`/api/mods/${entry.id}/download`, { method: "POST" }),
    onSuccess: ({ jobId }, entry) => { setConfirming(null); setJobs((current) => ({ ...current, [entry.id]: jobId })); void client.invalidateQueries({ queryKey: ["mod-library"] }); void client.invalidateQueries({ queryKey: ["jobs"] }); },
    onError: (error) => { setConfirming(null); setNotice(error.message); },
  });
  const remove = useMutation({
    mutationFn: (entry: ModLibraryEntry) => request(`/api/mods/${entry.id}`, { method: "DELETE" }),
    onSuccess: (_, entry) => { setNotice(t("modLibrary.removed", { name: `${entry.name} ${entry.version}` })); void client.invalidateQueries({ queryKey: ["mod-library"] }); },
    onError: (error) => setNotice(error.message),
  });
  function confirmRemove(entry: ModLibraryEntry) { if (window.confirm(t(entry.detectedIn.length ? "modLibrary.removeConfirmInUse" : "modLibrary.removeConfirm", { name: `${entry.name} ${entry.version}` }))) remove.mutate(entry); }
  return <AppShell active="mods"><Toast message={notice} onDismiss={() => setNotice(null)} /><header className="topbar"><div><p className="eyebrow">{t("modLibrary.eyebrow")}</p><h1>{t("modLibrary.title")}</h1><p className="page-subtitle">{t("modLibrary.subtitle")}</p></div><button className="button ghost" onClick={() => void query.refetch()}>{t("common.refresh")}</button></header>
    <section className="mod-section"><h3>{t("modLibrary.runtimes")}</h3><p className="muted">{t("modLibrary.runtimesHelp")}</p>
      {query.isLoading ? <p className="muted">{t("modLibrary.loading")}</p> : query.error ? <div className="settings-compatibility-warning">{query.error.message}</div> : <div className="record-list">{(query.data ?? []).map((entry) => <div key={entry.id}><span>
        <strong>{entry.name} {entry.version}</strong>
        <small>{t(`mods.variant.${entry.variant}`)} · {t(entry.downloaded ? "modLibrary.downloaded" : entry.downloading ? "modLibrary.downloading" : "modLibrary.notDownloaded")} · {t("modLibrary.size", { size: mebibytes(entry.sizeBytes) })} · {entry.license}</small>
        <small><a href={entry.projectUrl} target="_blank" rel="noreferrer">{entry.project}</a></small>
        <small title={entry.sha256}>{t("modLibrary.checksum", { sha256: entry.sha256 })}</small>
        <small>{entry.detectedIn.length ? <>{t("modLibrary.detectedIn")} {entry.detectedIn.map((world, index) => <span key={world.worldId}>{index > 0 && ", "}<Link href={`/worlds/${world.worldId}`}>{world.displayName}</Link></span>)}</> : t("modLibrary.notDetected")}</small>
        {jobs[entry.id] && <DownloadProgress jobId={jobs[entry.id]!} onFinished={(job) => { setJobs((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== entry.id))); setNotice(job.state === "succeeded" ? t("modLibrary.downloadComplete", { name: `${entry.name} ${entry.version}` }) : t("modLibrary.downloadFailed", { error: job.error ?? job.message })); void client.invalidateQueries({ queryKey: ["mod-library"] }); }} />}
      </span><span className="backup-actions">{entry.downloaded ? <button className="danger" disabled={remove.isPending} onClick={() => confirmRemove(entry)}>{t("modLibrary.remove")}</button> : <button disabled={entry.downloading || Boolean(jobs[entry.id])} onClick={() => setConfirming(entry)}>{t("modLibrary.download")}</button>}</span></div>)}</div>}
    </section>
    <Dialog.Root open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog">{confirming && <>
      <Dialog.Title>{t("modLibrary.confirmTitle", { name: `${confirming.name} ${confirming.version}` })}</Dialog.Title>
      <Dialog.Description>{t("modLibrary.confirmDescription")}</Dialog.Description>
      <dl className="consent-details">
        <dt>{t("modLibrary.confirmProject")}</dt><dd><a href={confirming.projectUrl} target="_blank" rel="noreferrer">{confirming.project}</a></dd>
        <dt>{t("modLibrary.confirmSource")}</dt><dd><code>{confirming.url}</code></dd>
        <dt>{t("modLibrary.confirmLicense")}</dt><dd>{confirming.license}</dd>
        <dt>{t("modLibrary.confirmSize")}</dt><dd>{t("modLibrary.size", { size: mebibytes(confirming.sizeBytes) })}</dd>
        <dt>{t("modLibrary.confirmChecksum")}</dt><dd><code>{confirming.sha256}</code></dd>
      </dl>
      <p className="muted">{t("modLibrary.confirmVerification")}</p>
      <div className="dialog-actions"><Dialog.Close asChild><button type="button" className="button ghost">{t("common.cancel")}</button></Dialog.Close><button className="button primary" disabled={download.isPending} onClick={() => download.mutate(confirming)}>{t("modLibrary.confirmDownload")}</button></div>
    </>}</Dialog.Content></Dialog.Portal></Dialog.Root>
  </AppShell>;
}

function DownloadProgress({ jobId, onFinished }: { jobId: string; onFinished(job: JobView): void }) {
  const presentation = useJobPresentation();
  const job = useQuery({ queryKey: ["job", jobId], queryFn: async () => (await request<{ job: JobView }>(`/api/jobs/${jobId}`)).job, refetchInterval: (state) => state.state.data && state.state.data.state !== "running" && state.state.data.state !== "queued" ? false : 1_000 });
  const finish = useEffectEvent(onFinished);
  const finished = job.data && job.data.state !== "running" && job.data.state !== "queued" ? job.data : null;
  useEffect(() => { if (finished) finish(finished); }, [finished]);
  if (!job.data) return null;
  return <><span className="progress"><i style={{ width: `${job.data.progress}%` }} /></span><small>{presentation.displayMessage(job.data)}</small></>;
}
