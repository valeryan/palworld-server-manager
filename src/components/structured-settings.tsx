"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { PALWORLD_SETTING_GROUPS, type PalworldSettingField } from "@/contracts/palworld-settings";
import { settingFieldKey, settingGroupKey } from "@/lib/localization-resources";

type Value = string | number | boolean;
type Structured = { options: Record<string, string>; exists: boolean; running: boolean; restartRequired: boolean; path: string };
const presets: Record<string, { labelKey: string; values: Record<string, Value> }> = {
  casual: { labelKey: "structured.preset.casual", values: { EnemyDropItemRate: 1.25, CollectionDropRate: 1.15, DeathPenalty: "Item", SupplyDropSpan: 50, PalSpawnNumRate: 1, ServerPlayerMaxNum: 20 } },
  balanced: { labelKey: "structured.preset.balanced", values: { EnemyDropItemRate: 1.05, CollectionDropRate: 1, DeathPenalty: "ItemAndEquipment", SupplyDropSpan: 60, PalSpawnNumRate: 1, ServerPlayerMaxNum: 40 } },
  smallGroup: { labelKey: "structured.preset.smallGroup", values: { EnemyDropItemRate: 1.1, CollectionDropRate: 1.05, DeathPenalty: "Item", SupplyDropSpan: 55, PalSpawnNumRate: 1, ServerPlayerMaxNum: 24 } },
};

async function get(worldId: string): Promise<Structured> { const response = await fetch(`/api/worlds/${worldId}/configuration/options`); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.configuration; }
function decode(field: PalworldSettingField, raw: string | undefined): Value { if (raw == null || raw === "") return field.default; if (field.type === "bool") return raw.toLowerCase() === "true"; if (field.type === "int" || field.type === "float") return Number(raw); if ((field.type === "text" || field.type === "select") && raw.startsWith('"') && raw.endsWith('"')) { try { return JSON.parse(raw); } catch { return raw.slice(1, -1); } } return raw; }

export function StructuredSettings({ worldId, onNotice }: { worldId: string; onNotice(message: string): void }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["configuration-options", worldId], queryFn: () => get(worldId) });
  if (query.isLoading) return <p className="muted">{t("structured.loading")}</p>;
  if (query.error || !query.data) return <p className="error-text">{query.error?.message ?? t("structured.unavailable")}</p>;
  return <StructuredForm key={JSON.stringify(query.data.options)} worldId={worldId} configuration={query.data} onNotice={onNotice} />;
}

function StructuredForm({ worldId, configuration, onNotice }: { worldId: string; configuration: Structured; onNotice(message: string): void }) {
  const { t } = useTranslation();
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
  const save = useMutation({ mutationFn: async () => { const changes = Object.fromEntries(changed.map((field) => [field.key, draft[field.key] ?? field.default])); const response = await fetch(`/api/worlds/${worldId}/configuration/options`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; }, onSuccess: () => { onNotice(t("structured.saved", { count: changed.length })); void client.invalidateQueries({ queryKey: ["configuration-options", worldId] }); void client.invalidateQueries({ queryKey: ["configuration", worldId] }); void client.invalidateQueries({ queryKey: ["configuration-versions", worldId] }); }, onError: (error) => onNotice(error.message) });
  const visibleGroups = search.trim() ? PALWORLD_SETTING_GROUPS.map((group) => ({ ...group, fields: group.fields.filter((field) => `${field.label} ${field.key} ${field.hint ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())) })).filter((group) => group.fields.length) : [PALWORLD_SETTING_GROUPS[activeGroup]!];
  function applyPreset(name: string) { const preset = presets[name]; if (!preset) return; setDraft((current) => ({ ...current, ...preset.values })); setTouched((current) => new Set([...current, ...Object.keys(preset.values)])); onNotice(t("structured.presetStaged", { name: t(preset.labelKey) })); }
  async function exportConfiguration() { const response = await fetch(`/api/worlds/${worldId}/configuration/export`); if (!response.ok) { const body = await response.json(); throw new Error(body.error); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `palworld-settings-${worldId}.zip`; anchor.click(); URL.revokeObjectURL(url); }
  async function importConfiguration(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > 5_000_000) { onNotice(t("structured.archiveTooLarge")); return; } const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); const response = await fetch(`/api/worlds/${worldId}/configuration/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ zipBase64: btoa(binary) }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); onNotice(t("structured.imported")); void client.invalidateQueries({ queryKey: ["configuration-options", worldId] }); void client.invalidateQueries({ queryKey: ["configuration", worldId] }); void client.invalidateQueries({ queryKey: ["configuration-versions", worldId] }); }
  return <div>
    {configuration.restartRequired && <div className="restart-required">{t("structured.restartRequired")}</div>}
    <div className="structured-notice">{t("structured.changedOnly")}</div>
    <div className="settings-tools"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("structured.search")} /><span>{t("structured.presets")}</span>{Object.entries(presets).map(([name, preset]) => <button key={name} className="button ghost" onClick={() => applyPreset(name)}>{t(preset.labelKey)}</button>)}<span className="tool-spacer" /><button className="button ghost" onClick={() => void exportConfiguration().catch((error) => onNotice(error.message))}>{t("structured.export")}</button><button className="button ghost" onClick={() => importInput.current?.click()}>{t("structured.import")}</button><input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => void importConfiguration(event).catch((error) => onNotice(error.message))} /></div>
    {!search.trim() && <div className="settings-groups">{PALWORLD_SETTING_GROUPS.map((group, index) => { const title = t(settingGroupKey(group.title, "title")); const description = t(settingGroupKey(group.title, "description")); return <button key={group.title} title={description} className={index === activeGroup ? "active" : ""} onClick={() => setActiveGroup(index)}>{title}</button>; })}</div>}
    {visibleGroups.map((group) => { const title = t(settingGroupKey(group.title, "title")); const description = t(settingGroupKey(group.title, "description")); return <section className="settings-group" key={group.title}><header title={description}><h2>{title} <span className="help-tip" aria-label={description}>?</span></h2><p>{description}</p></header><div className="structured-grid">{group.fields.map((field) => <SettingControl key={field.key} field={field} value={draft[field.key] ?? field.default} saved={initial[field.key] ?? field.default} present={Object.hasOwn(configuration.options, field.key)} changed={changed.includes(field)} onChange={(value) => setValue(field.key, value)} onRevert={() => { setDraft((current) => ({ ...current, [field.key]: initial[field.key] ?? field.default })); setTouched((current) => { const next = new Set(current); next.delete(field.key); return next; }); }} />)}</div></section>; })}
    <div className="structured-actions"><span>{changed.length ? t("structured.unsaved", { count: changed.length }) : t("structured.noChanges")}</span><button className="button ghost" disabled={!changed.length || save.isPending} onClick={() => { setDraft(initial); setTouched(new Set()); }}>{t("structured.discard")}</button><button className="button primary" disabled={!changed.length || save.isPending} onClick={() => save.mutate()}>{t(save.isPending ? "common.saving" : "structured.save")}</button></div>
  </div>;
}

function SettingControl({ field, value, saved, present, changed, onChange, onRevert }: { field: PalworldSettingField; value: Value; saved: Value; present: boolean; changed: boolean; onChange(value: Value): void; onRevert(): void }) {
  const { t } = useTranslation(); const label = t(settingFieldKey(field.key, "label")); const hint = field.hint ? t(settingFieldKey(field.key, "hint")) : ""; const description = hint || `${label} (${field.key})`;
  return <label className={changed ? "changed" : ""} title={description}><span><span>{label} <i className="help-tip">?</i>{!present && <em>{t("structured.default")}</em>}</span><small>{field.key}</small>{hint && <small className="field-hint">{hint}</small>}</span>{field.type === "bool" ? <button type="button" className={`toggle ${value ? "on" : ""}`} onClick={() => onChange(!value)}><i />{t(value ? "common.on" : "common.off")}</button> : field.type === "select" ? <select value={String(value)} onChange={(event) => onChange(event.target.value)}>{field.options?.map((choice) => <option key={choice}>{choice}</option>)}</select> : <input type={field.type === "int" || field.type === "float" ? "number" : "text"} value={String(value)} min={field.min} max={field.max} step={field.type === "int" ? 1 : field.type === "float" ? 0.1 : undefined} onChange={(event) => onChange(field.type === "int" || field.type === "float" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)} />}{changed && <button type="button" className="field-revert" onClick={onRevert}>{t("structured.revert", { value: String(saved) })}</button>}</label>;
}
