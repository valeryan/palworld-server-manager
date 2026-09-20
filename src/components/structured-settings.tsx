"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

type Kind = "text" | "number" | "bool" | "select";
type Field = { key: string; label: string; kind: Kind; group: string; defaultValue: string | number | boolean; min?: number; max?: number; step?: number; choices?: string[]; hint?: string };
const fields: Field[] = [
  { key: "ServerName", label: "Server name", kind: "text", group: "Identity", defaultValue: "Default Palworld Server" },
  { key: "ServerDescription", label: "Description", kind: "text", group: "Identity", defaultValue: "" },
  { key: "ServerPlayerMaxNum", label: "Maximum players", kind: "number", group: "Identity", defaultValue: 32, min: 1, max: 128, step: 1 },
  { key: "DayTimeSpeedRate", label: "Day speed", kind: "number", group: "World", defaultValue: 1, min: 0.1, max: 5, step: 0.1 },
  { key: "NightTimeSpeedRate", label: "Night speed", kind: "number", group: "World", defaultValue: 1, min: 0.1, max: 5, step: 0.1 },
  { key: "ExpRate", label: "Experience rate", kind: "number", group: "World", defaultValue: 1, min: 0.1, max: 20, step: 0.1 },
  { key: "PalCaptureRate", label: "Pal capture rate", kind: "number", group: "World", defaultValue: 1, min: 0.1, max: 20, step: 0.1 },
  { key: "PalSpawnNumRate", label: "Pal spawn rate", kind: "number", group: "World", defaultValue: 1, min: 0.1, max: 10, step: 0.1 },
  { key: "CollectionDropRate", label: "Gathered item rate", kind: "number", group: "Drops", defaultValue: 1, min: 0.1, max: 20, step: 0.1 },
  { key: "EnemyDropItemRate", label: "Enemy drop rate", kind: "number", group: "Drops", defaultValue: 1, min: 0.1, max: 20, step: 0.1 },
  { key: "DeathPenalty", label: "Death penalty", kind: "select", group: "Players", defaultValue: "All", choices: ["None", "Item", "ItemAndEquipment", "All"] },
  { key: "bEnablePlayerToPlayerDamage", label: "Player-versus-player damage", kind: "bool", group: "Players", defaultValue: false },
  { key: "bEnableFriendlyFire", label: "Friendly fire", kind: "bool", group: "Players", defaultValue: false },
  { key: "bEnableFastTravel", label: "Fast travel", kind: "bool", group: "Players", defaultValue: true },
  { key: "bIsStartLocationSelectByMap", label: "Choose starting location", kind: "bool", group: "Players", defaultValue: true },
  { key: "bEnableInvaderEnemy", label: "Base raid events", kind: "bool", group: "World", defaultValue: true },
];
type Structured = { options: Record<string, string>; exists: boolean; running: boolean; path: string };
async function get(worldId: string): Promise<Structured> { const response = await fetch(`/api/worlds/${worldId}/configuration/options`); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.configuration; }
function decode(field: Field, raw: string | undefined): string | number | boolean { if (raw == null || raw === "") return field.defaultValue; if (field.kind === "bool") return raw.toLowerCase() === "true"; if (field.kind === "number") return Number(raw); if (raw.startsWith('"') && raw.endsWith('"')) { try { return JSON.parse(raw); } catch { return raw.slice(1, -1); } } return raw; }
function encode(field: Field, value: string | number | boolean): string { if (field.kind === "bool") return value ? "True" : "False"; if (field.kind === "text") return JSON.stringify(String(value)); return String(value); }

export function StructuredSettings({ worldId, onNotice }: { worldId: string; onNotice(message: string): void }) {
  const query = useQuery({ queryKey: ["configuration-options", worldId], queryFn: () => get(worldId) });
  if (query.isLoading) return <p className="muted">Loading structured settings…</p>;
  if (query.error || !query.data) return <p className="error-text">{query.error?.message ?? "Settings are unavailable."}</p>;
  return <StructuredForm key={JSON.stringify(query.data.options)} worldId={worldId} configuration={query.data} onNotice={onNotice} />;
}

function StructuredForm({ worldId, configuration, onNotice }: { worldId: string; configuration: Structured; onNotice(message: string): void }) {
  const client = useQueryClient(); const initial = useMemo(() => Object.fromEntries(fields.map((field) => [field.key, decode(field, configuration.options[field.key])])), [configuration]); const [draft, setDraft] = useState<Record<string, string | number | boolean>>(initial);
  const changed = fields.filter((field) => draft[field.key] !== initial[field.key]);
  const save = useMutation({ mutationFn: async () => { const changes = Object.fromEntries(changed.map((field) => [field.key, encode(field, draft[field.key] ?? field.defaultValue)])); const response = await fetch(`/api/worlds/${worldId}/configuration/options`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; }, onSuccess: () => { onNotice(`Saved ${changed.length} setting${changed.length === 1 ? "" : "s"}; restart to apply changes`); void client.invalidateQueries({ queryKey: ["configuration-options", worldId] }); void client.invalidateQueries({ queryKey: ["configuration", worldId] }); void client.invalidateQueries({ queryKey: ["configuration-versions", worldId] }); }, onError: (error) => onNotice(error.message) });
  const groups = [...new Set(fields.map((field) => field.group))];
  return <div><div className="structured-notice">Only changed fields are written. Unknown and advanced INI options remain untouched.</div>{groups.map((group) => <section className="settings-group" key={group}><h2>{group}</h2><div className="structured-grid">{fields.filter((field) => field.group === group).map((field) => <label className={changed.includes(field) ? "changed" : ""} key={field.key}><span>{field.label}<small>{field.key}</small></span>{field.kind === "bool" ? <button type="button" className={`toggle ${draft[field.key] ? "on" : ""}`} onClick={() => setDraft((value) => ({ ...value, [field.key]: !value[field.key] }))}><i />{draft[field.key] ? "On" : "Off"}</button> : field.kind === "select" ? <select value={String(draft[field.key])} onChange={(event) => setDraft((value) => ({ ...value, [field.key]: event.target.value }))}>{field.choices?.map((choice) => <option key={choice}>{choice}</option>)}</select> : <input type={field.kind === "number" ? "number" : "text"} value={String(draft[field.key])} min={field.min} max={field.max} step={field.step} onChange={(event) => setDraft((value) => ({ ...value, [field.key]: field.kind === "number" ? Number(event.target.value) : event.target.value }))} />}</label>)}</div></section>)}<div className="structured-actions"><span>{changed.length ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}` : "No changes"}</span><button className="button ghost" disabled={!changed.length || save.isPending} onClick={() => setDraft(initial)}>Discard</button><button className="button primary" disabled={!changed.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save changes"}</button></div></div>;
}
