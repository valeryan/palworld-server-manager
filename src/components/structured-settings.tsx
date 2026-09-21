"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { PALWORLD_SETTING_GROUPS, type PalworldSettingField } from "@/contracts/palworld-settings";

type Value = string | number | boolean;
type Structured = { options: Record<string, string>; exists: boolean; running: boolean; restartRequired: boolean; path: string };
const presets: Record<string, Record<string, Value>> = {
  "Casual PvE": { EnemyDropItemRate: 1.25, CollectionDropRate: 1.15, DeathPenalty: "Item", SupplyDropSpan: 50, PalSpawnNumRate: 1, ServerPlayerMaxNum: 20 },
  "Balanced PvP": { EnemyDropItemRate: 1.05, CollectionDropRate: 1, DeathPenalty: "ItemAndEquipment", SupplyDropSpan: 60, PalSpawnNumRate: 1, ServerPlayerMaxNum: 40 },
  "Small-group PvP": { EnemyDropItemRate: 1.1, CollectionDropRate: 1.05, DeathPenalty: "Item", SupplyDropSpan: 55, PalSpawnNumRate: 1, ServerPlayerMaxNum: 24 },
};

async function get(worldId: string): Promise<Structured> { const response = await fetch(`/api/worlds/${worldId}/configuration/options`); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.configuration; }
function decode(field: PalworldSettingField, raw: string | undefined): Value { if (raw == null || raw === "") return field.default; if (field.type === "bool") return raw.toLowerCase() === "true"; if (field.type === "int" || field.type === "float") return Number(raw); if ((field.type === "text" || field.type === "select") && raw.startsWith('"') && raw.endsWith('"')) { try { return JSON.parse(raw); } catch { return raw.slice(1, -1); } } return raw; }

export function StructuredSettings({ worldId, onNotice }: { worldId: string; onNotice(message: string): void }) {
  const query = useQuery({ queryKey: ["configuration-options", worldId], queryFn: () => get(worldId) });
  if (query.isLoading) return <p className="muted">Loading structured settings…</p>;
  if (query.error || !query.data) return <p className="error-text">{query.error?.message ?? "Settings are unavailable."}</p>;
  return <StructuredForm key={JSON.stringify(query.data.options)} worldId={worldId} configuration={query.data} onNotice={onNotice} />;
}

function StructuredForm({ worldId, configuration, onNotice }: { worldId: string; configuration: Structured; onNotice(message: string): void }) {
  const client = useQueryClient();
  const importInput = useRef<HTMLInputElement>(null);
  const initial = useMemo(() => Object.fromEntries(PALWORLD_SETTING_GROUPS.flatMap((group) => group.fields).map((field) => [field.key, decode(field, configuration.options[field.key])])), [configuration]);
  const [draft, setDraft] = useState<Record<string, Value>>(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [activeGroup, setActiveGroup] = useState(0);
  const [search, setSearch] = useState("");
  const fields = PALWORLD_SETTING_GROUPS.flatMap((group) => group.fields);
  const changed = fields.filter((field) => draft[field.key] !== initial[field.key] || (touched.has(field.key) && !Object.hasOwn(configuration.options, field.key)));
  const setValue = (key: string, value: Value) => { setDraft((current) => ({ ...current, [key]: value })); setTouched((current) => new Set(current).add(key)); };
  const save = useMutation({ mutationFn: async () => { const changes = Object.fromEntries(changed.map((field) => [field.key, draft[field.key] ?? field.default])); const response = await fetch(`/api/worlds/${worldId}/configuration/options`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; }, onSuccess: () => { onNotice(`Saved ${changed.length} setting${changed.length === 1 ? "" : "s"}; restart to apply changes`); void client.invalidateQueries({ queryKey: ["configuration-options", worldId] }); void client.invalidateQueries({ queryKey: ["configuration", worldId] }); void client.invalidateQueries({ queryKey: ["configuration-versions", worldId] }); }, onError: (error) => onNotice(error.message) });
  const visibleGroups = search.trim() ? PALWORLD_SETTING_GROUPS.map((group) => ({ ...group, fields: group.fields.filter((field) => `${field.label} ${field.key} ${field.hint ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())) })).filter((group) => group.fields.length) : [PALWORLD_SETTING_GROUPS[activeGroup]!];
  function applyPreset(name: string) { const preset = presets[name]; if (!preset) return; setDraft((current) => ({ ...current, ...preset })); setTouched((current) => new Set([...current, ...Object.keys(preset)])); onNotice(`${name} preset staged; review before saving.`); }
  async function exportConfiguration() { const response = await fetch(`/api/worlds/${worldId}/configuration/export`); if (!response.ok) { const body = await response.json(); throw new Error(body.error); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `palworld-settings-${worldId}.zip`; anchor.click(); URL.revokeObjectURL(url); }
  async function importConfiguration(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > 5_000_000) { onNotice("Configuration archives must be smaller than 5 MB."); return; } const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); const response = await fetch(`/api/worlds/${worldId}/configuration/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ zipBase64: btoa(binary) }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); onNotice("Configuration imported; restart to apply changes."); void client.invalidateQueries({ queryKey: ["configuration-options", worldId] }); void client.invalidateQueries({ queryKey: ["configuration", worldId] }); void client.invalidateQueries({ queryKey: ["configuration-versions", worldId] }); }
  return <div>
    {configuration.restartRequired && <div className="restart-required">Restart required — configuration was saved after this server started.</div>}
    <div className="structured-notice">Only changed fields are written. Unknown advanced INI options remain untouched.</div>
    <div className="settings-tools"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search settings or keys…" /><span>Presets:</span>{Object.keys(presets).map((name) => <button key={name} className="button ghost" onClick={() => applyPreset(name)}>{name}</button>)}<span className="tool-spacer" /><button className="button ghost" onClick={() => void exportConfiguration().catch((error) => onNotice(error.message))}>Export ZIP</button><button className="button ghost" onClick={() => importInput.current?.click()}>Import ZIP</button><input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => void importConfiguration(event).catch((error) => onNotice(error.message))} /></div>
    {!search.trim() && <div className="settings-groups">{PALWORLD_SETTING_GROUPS.map((group, index) => <button key={group.title} title={group.description} className={index === activeGroup ? "active" : ""} onClick={() => setActiveGroup(index)}>{group.title}</button>)}</div>}
    {visibleGroups.map((group) => <section className="settings-group" key={group.title}><header title={group.description}><h2>{group.title} <span className="help-tip" aria-label={group.description}>?</span></h2><p>{group.description}</p></header><div className="structured-grid">{group.fields.map((field) => <SettingControl key={field.key} field={field} value={draft[field.key] ?? field.default} saved={initial[field.key] ?? field.default} present={Object.hasOwn(configuration.options, field.key)} changed={changed.includes(field)} onChange={(value) => setValue(field.key, value)} onRevert={() => { setDraft((current) => ({ ...current, [field.key]: initial[field.key] ?? field.default })); setTouched((current) => { const next = new Set(current); next.delete(field.key); return next; }); }} />)}</div></section>)}
    <div className="structured-actions"><span>{changed.length ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}` : "No changes"}</span><button className="button ghost" disabled={!changed.length || save.isPending} onClick={() => { setDraft(initial); setTouched(new Set()); }}>Discard</button><button className="button primary" disabled={!changed.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save changes"}</button></div>
  </div>;
}

function SettingControl({ field, value, saved, present, changed, onChange, onRevert }: { field: PalworldSettingField; value: Value; saved: Value; present: boolean; changed: boolean; onChange(value: Value): void; onRevert(): void }) {
  const description = field.hint ?? `${field.label} (${field.key})`;
  return <label className={changed ? "changed" : ""} title={description}><span><span>{field.label} <i className="help-tip">?</i>{!present && <em>Default</em>}</span><small>{field.key}</small>{field.hint && <small className="field-hint">{field.hint}</small>}</span>{field.type === "bool" ? <button type="button" className={`toggle ${value ? "on" : ""}`} onClick={() => onChange(!value)}><i />{value ? "On" : "Off"}</button> : field.type === "select" ? <select value={String(value)} onChange={(event) => onChange(event.target.value)}>{field.options?.map((choice) => <option key={choice}>{choice}</option>)}</select> : <input type={field.type === "int" || field.type === "float" ? "number" : "text"} value={String(value)} min={field.min} max={field.max} step={field.type === "int" ? 1 : field.type === "float" ? 0.1 : undefined} onChange={(event) => onChange(field.type === "int" || field.type === "float" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)} />}{changed && <button type="button" className="field-revert" onClick={onRevert}>Revert to {String(saved)}</button>}</label>;
}
