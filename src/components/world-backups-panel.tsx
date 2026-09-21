"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

type Backup = { id: string; filePath: string; sizeBytes: number; reason: string; verified: boolean; createdAt: number };
type Settings = { destinationDir: string | null; retentionCount: number };
async function request<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } }); const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body; }
const stamp = (value: number) => new Date(value).toLocaleString();

export function WorldBackupsPanel({ worldId, running, onBackup, onRestore, onNotice }: { worldId: string; running: boolean; onBackup(): void; onRestore(id: string): void; onNotice(message: string): void }) {
  const client = useQueryClient();
  const backupsQuery = useQuery({ queryKey: ["backups", worldId], queryFn: async () => (await request<{ backups: Backup[] }>(`/api/worlds/${worldId}/backups`)).backups });
  const settingsQuery = useQuery({ queryKey: ["backup-settings", worldId], queryFn: async () => (await request<{ settings: Settings }>(`/api/worlds/${worldId}/backups/settings`)).settings });
  const [destinationDraft, setDestinationDraft] = useState<string>(); const [retentionDraft, setRetentionDraft] = useState<number>();
  const destination = destinationDraft ?? settingsQuery.data?.destinationDir ?? ""; const retention = retentionDraft ?? settingsQuery.data?.retentionCount ?? 0;
  const save = useMutation({ mutationFn: (payload: Settings) => request(`/api/worlds/${worldId}/backups/settings`, { method: "PUT", body: JSON.stringify(payload) }), onSuccess: () => { setDestinationDraft(undefined); setRetentionDraft(undefined); onNotice("Backup settings saved"); void settingsQuery.refetch(); }, onError: (error) => onNotice(error.message) });
  const remove = useMutation({ mutationFn: (id: string) => request(`/api/worlds/${worldId}/backups/${id}`, { method: "DELETE" }), onSuccess: () => { onNotice("Backup deleted"); void client.invalidateQueries({ queryKey: ["backups", worldId] }); }, onError: (error) => onNotice(error.message) });
  async function chooseDestination() { const selected = await window.psmDesktop?.pickDirectory(); if (selected) setDestinationDraft(selected); }
  function submit(event: FormEvent) { event.preventDefault(); save.mutate({ destinationDir: destination.trim() || null, retentionCount: retention }); }
  function confirmDelete(item: Backup) { if (window.confirm(`Permanently delete the backup from ${stamp(item.createdAt)}?\n\n${item.filePath}`)) remove.mutate(item.id); }
  const records = [...(backupsQuery.data ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  return <div><div className="panel-heading"><div><h2>Backups</h2><p>Verified snapshots of this world&apos;s Saved directory.</p></div><button className="button primary" onClick={onBackup}>Back up now</button></div>
    <form className="backup-settings" onSubmit={submit}><label>Custom destination <span className="path-picker"><input value={destination} onChange={(event) => setDestinationDraft(event.target.value)} placeholder="Manager default" /><button type="button" onClick={() => void chooseDestination()}>Browse…</button></span><small>Leave blank to use isolated manager storage. Game installation paths are rejected.</small></label><label>Keep newest backups<input type="number" min="0" max="500" value={retention} onChange={(event) => setRetentionDraft(Number(event.target.value))} /><small>0 keeps all backups. Retention runs only after a new archive verifies.</small></label><button className="button ghost" disabled={save.isPending || settingsQuery.isLoading}>{save.isPending ? "Saving…" : "Save backup settings"}</button></form>
    <div className="record-list">{backupsQuery.isLoading ? <p className="muted">Loading backups…</p> : records.length ? records.map((item) => <div key={item.id}><span><strong>{stamp(item.createdAt)}</strong><small>{Math.ceil(item.sizeBytes / 1_048_576)} MiB · {item.reason} · {item.verified ? "verified" : "unverified"}</small><small title={item.filePath}>{item.filePath}</small></span><span className="backup-actions"><a className="button ghost" href={`/api/worlds/${worldId}/backups/${item.id}/download`}>Download</a><button disabled={running || !item.verified} onClick={() => onRestore(item.id)}>Restore</button><button className="danger" disabled={remove.isPending} onClick={() => confirmDelete(item)}>Delete</button></span></div>) : <p className="muted">No backups yet.</p>}</div>{running && <p className="muted">Stop the server before restoring a backup.</p>}
  </div>;
}
