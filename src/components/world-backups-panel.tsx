"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocaleDateTime } from "@/lib/use-locale-format";

type Backup = { id: string; filePath: string; sizeBytes: number; reason: string; verified: boolean; createdAt: number };
type Settings = { destinationDir: string | null; retentionCount: number };
async function request<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } }); const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body; }
export function WorldBackupsPanel({ worldId, running, onBackup, onRestore, onNotice }: { worldId: string; running: boolean; onBackup(): void; onRestore(id: string): void; onNotice(message: string): void }) {
  const { t } = useTranslation();
  const stamp = useLocaleDateTime();
  const client = useQueryClient();
  const backupsQuery = useQuery({ queryKey: ["backups", worldId], queryFn: async () => (await request<{ backups: Backup[] }>(`/api/worlds/${worldId}/backups`)).backups });
  const settingsQuery = useQuery({ queryKey: ["backup-settings", worldId], queryFn: async () => (await request<{ settings: Settings }>(`/api/worlds/${worldId}/backups/settings`)).settings });
  const [destinationDraft, setDestinationDraft] = useState<string>(); const [retentionDraft, setRetentionDraft] = useState<number>();
  const destination = destinationDraft ?? settingsQuery.data?.destinationDir ?? ""; const retention = retentionDraft ?? settingsQuery.data?.retentionCount ?? 0;
  const save = useMutation({ mutationFn: (payload: Settings) => request(`/api/worlds/${worldId}/backups/settings`, { method: "PUT", body: JSON.stringify(payload) }), onSuccess: () => { setDestinationDraft(undefined); setRetentionDraft(undefined); onNotice(t("backups.saved")); void settingsQuery.refetch(); }, onError: (error) => onNotice(error.message) });
  const remove = useMutation({ mutationFn: (id: string) => request(`/api/worlds/${worldId}/backups/${id}`, { method: "DELETE" }), onSuccess: () => { onNotice(t("backups.deleted")); void client.invalidateQueries({ queryKey: ["backups", worldId] }); }, onError: (error) => onNotice(error.message) });
  async function chooseDestination() { const selected = await window.psmDesktop?.pickDirectory(); if (selected) setDestinationDraft(selected); }
  function submit(event: FormEvent) { event.preventDefault(); save.mutate({ destinationDir: destination.trim() || null, retentionCount: retention }); }
  function confirmDelete(item: Backup) { if (window.confirm(t("backups.deleteConfirm", { date: stamp(item.createdAt), path: item.filePath }))) remove.mutate(item.id); }
  const records = [...(backupsQuery.data ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  return <div><div className="panel-heading"><div><h2>{t("backups.title")}</h2><p>{t("backups.description")}</p></div><button className="button primary" onClick={onBackup}>{t("backups.create")}</button></div>
    <form className="backup-settings" onSubmit={submit}><label>{t("backups.destination")} <span className="path-picker"><input value={destination} onChange={(event) => setDestinationDraft(event.target.value)} placeholder={t("backups.defaultDestination")} /><button type="button" onClick={() => void chooseDestination()}>{t("backups.browse")}</button></span><small>{t("backups.destinationHelp")}</small></label><label>{t("backups.retention")}<input type="number" min="0" max="500" value={retention} onChange={(event) => setRetentionDraft(Number(event.target.value))} /><small>{t("backups.retentionHelp")}</small></label><button className="button ghost" disabled={save.isPending || settingsQuery.isLoading}>{t(save.isPending ? "common.saving" : "backups.save")}</button></form>
    <div className="record-list">{backupsQuery.isLoading ? <p className="muted">{t("backups.loading")}</p> : records.length ? records.map((item) => <div key={item.id}><span><strong>{stamp(item.createdAt)}</strong><small>{Math.ceil(item.sizeBytes / 1_048_576)} MiB · {item.reason} · {t(item.verified ? "backups.verified" : "backups.unverified")}</small><small title={item.filePath}>{item.filePath}</small></span><span className="backup-actions"><a className="button ghost" href={`/api/worlds/${worldId}/backups/${item.id}/download`}>{t("backups.download")}</a><button disabled={running || !item.verified} onClick={() => onRestore(item.id)}>{t("backups.restore")}</button><button className="danger" disabled={remove.isPending} onClick={() => confirmDelete(item)}>{t("common.delete")}</button></span></div>) : <p className="muted">{t("backups.empty")}</p>}</div>{running && <p className="muted">{t("backups.stopToRestore")}</p>}
  </div>;
}
