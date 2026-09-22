"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { PALWORLD_SETTING_GROUPS, type PalworldSettingField } from "@/contracts/palworld-settings";
import { settingFieldKey, settingGroupKey } from "@/lib/localization-resources";

type Value = string | number | boolean;
type Structured = { options: Record<string, string>; exists: boolean; running: boolean; restartRequired: boolean; path: string };
type AdminConfiguration = { adminPasswordSet: boolean; serverPasswordSet: boolean; restApiEnabled: boolean; restApiPort: number; rconEnabled: boolean; rconPort: number };
type StructuredResponse = { configuration: Structured; admin: AdminConfiguration };
const presets: Record<string, { labelKey: string; values: Record<string, Value> }> = {
  casual: { labelKey: "structured.preset.casual", values: { EnemyDropItemRate: 1.25, CollectionDropRate: 1.15, DeathPenalty: "Item", SupplyDropSpan: 50, PalSpawnNumRate: 1, ServerPlayerMaxNum: 20 } },
  balanced: { labelKey: "structured.preset.balanced", values: { EnemyDropItemRate: 1.05, CollectionDropRate: 1, DeathPenalty: "ItemAndEquipment", SupplyDropSpan: 60, PalSpawnNumRate: 1, ServerPlayerMaxNum: 40 } },
  smallGroup: { labelKey: "structured.preset.smallGroup", values: { EnemyDropItemRate: 1.1, CollectionDropRate: 1.05, DeathPenalty: "Item", SupplyDropSpan: 55, PalSpawnNumRate: 1, ServerPlayerMaxNum: 24 } },
};

async function get(worldId: string): Promise<StructuredResponse> { const response = await fetch(`/api/worlds/${worldId}/configuration/admin`); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; }
function decode(field: PalworldSettingField, raw: string | undefined): Value { if (raw == null || raw === "") return field.default; if (field.type === "bool") return raw.toLowerCase() === "true"; if (field.type === "int" || field.type === "float") return Number(raw); if ((field.type === "text" || field.type === "select") && raw.startsWith('"') && raw.endsWith('"')) { try { return JSON.parse(raw); } catch { return raw.slice(1, -1); } } return raw; }

export function StructuredSettings({ worldId, onNotice }: { worldId: string; onNotice(message: string): void }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["configuration-options", worldId], queryFn: () => get(worldId) });
  if (query.isLoading) return <p className="muted">{t("structured.loading")}</p>;
  if (query.error || !query.data) return <p className="error-text">{query.error?.message ?? t("structured.unavailable")}</p>;
  return <StructuredForm key={JSON.stringify(query.data)} worldId={worldId} configuration={query.data.configuration} admin={query.data.admin} onNotice={onNotice} />;
}

function StructuredForm({ worldId, configuration, admin, onNotice }: { worldId: string; configuration: Structured; admin: AdminConfiguration; onNotice(message: string): void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const importInput = useRef<HTMLInputElement>(null);
  const initial = useMemo(() => Object.fromEntries(PALWORLD_SETTING_GROUPS.flatMap((group) => group.fields).map((field) => [field.key, decode(field, configuration.options[field.key])])), [configuration]);
  const [draft, setDraft] = useState<Record<string, Value>>(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [activeGroup, setActiveGroup] = useState(0);
  const [search, setSearch] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [clearAdminPassword, setClearAdminPassword] = useState(false);
  const [clearServerPassword, setClearServerPassword] = useState(false);
  const [restApiEnabled, setRestApiEnabled] = useState(admin.restApiEnabled);
  const [restApiPort, setRestApiPort] = useState(admin.restApiPort);
  const [rconEnabled, setRconEnabled] = useState(admin.rconEnabled);
  const [rconPort, setRconPort] = useState(admin.rconPort);
  const fields = PALWORLD_SETTING_GROUPS.flatMap((group) => group.fields);
  const changed = fields.filter((field) => draft[field.key] !== initial[field.key] || (touched.has(field.key) && !Object.hasOwn(configuration.options, field.key)));
  const managedChangedCount = [adminPassword !== "" || clearAdminPassword, serverPassword !== "" || clearServerPassword, restApiEnabled !== admin.restApiEnabled, restApiPort !== admin.restApiPort, rconEnabled !== admin.rconEnabled, rconPort !== admin.rconPort].filter(Boolean).length;
  const changedCount = changed.length + managedChangedCount;
  const setValue = (key: string, value: Value) => { setDraft((current) => ({ ...current, [key]: value })); setTouched((current) => new Set(current).add(key)); };
  const save = useMutation({ mutationFn: async () => {
    const changes = Object.fromEntries(changed.map((field) => [field.key, draft[field.key] ?? field.default]));
    const managed = {
      ...(adminPassword ? { adminPassword } : clearAdminPassword ? { adminPassword: "" } : {}),
      ...(serverPassword ? { serverPassword } : clearServerPassword ? { serverPassword: "" } : {}),
      ...(restApiEnabled !== admin.restApiEnabled ? { restApiEnabled } : {}), ...(restApiPort !== admin.restApiPort ? { restApiPort } : {}),
      ...(rconEnabled !== admin.rconEnabled ? { rconEnabled } : {}), ...(rconPort !== admin.rconPort ? { rconPort } : {}),
    };
    const response = await fetch(`/api/worlds/${worldId}/configuration/admin`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes, managed }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error); return body;
  }, onSuccess: () => { onNotice(t("structured.saved", { count: changedCount })); void client.invalidateQueries({ queryKey: ["configuration-options", worldId] }); void client.invalidateQueries({ queryKey: ["configuration", worldId] }); void client.invalidateQueries({ queryKey: ["configuration-versions", worldId] }); void client.invalidateQueries({ queryKey: ["world", worldId] }); }, onError: (error) => onNotice(error.message) });
  const visibleGroups = search.trim() ? PALWORLD_SETTING_GROUPS.map((group) => ({ ...group, fields: group.fields.filter((field) => `${field.label} ${field.key} ${field.hint ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())) })).filter((group) => group.fields.length) : [PALWORLD_SETTING_GROUPS[activeGroup]!];
  function applyPreset(name: string) { const preset = presets[name]; if (!preset) return; setDraft((current) => ({ ...current, ...preset.values })); setTouched((current) => new Set([...current, ...Object.keys(preset.values)])); onNotice(t("structured.presetStaged", { name: t(preset.labelKey) })); }
  async function exportConfiguration() { const response = await fetch(`/api/worlds/${worldId}/configuration/export`); if (!response.ok) { const body = await response.json(); throw new Error(body.error); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `palworld-settings-${worldId}.zip`; anchor.click(); URL.revokeObjectURL(url); }
  async function importConfiguration(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > 5_000_000) { onNotice(t("structured.archiveTooLarge")); return; } const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); const response = await fetch(`/api/worlds/${worldId}/configuration/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ zipBase64: btoa(binary) }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); onNotice(t("structured.imported")); void client.invalidateQueries({ queryKey: ["configuration-options", worldId] }); void client.invalidateQueries({ queryKey: ["configuration", worldId] }); void client.invalidateQueries({ queryKey: ["configuration-versions", worldId] }); }
  return <div>
    {configuration.restartRequired && <div className="restart-required">{t("structured.restartRequired")}</div>}
    <div className="structured-notice">{t("structured.changedOnly")}</div>
    <div className="settings-tools"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("structured.search")} /><span>{t("structured.presets")}</span>{Object.entries(presets).map(([name, preset]) => <button key={name} className="button ghost" onClick={() => applyPreset(name)}>{t(preset.labelKey)}</button>)}<span className="tool-spacer" /><button className="button ghost" onClick={() => void exportConfiguration().catch((error) => onNotice(error.message))}>{t("structured.export")}</button><button className="button ghost" onClick={() => importInput.current?.click()}>{t("structured.import")}</button><input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => void importConfiguration(event).catch((error) => onNotice(error.message))} /></div>
    {!search.trim() && <div className="settings-groups">{PALWORLD_SETTING_GROUPS.map((group, index) => { const title = t(settingGroupKey(group.title, "title")); const description = t(settingGroupKey(group.title, "description")); return <button key={group.title} title={description} className={index === activeGroup ? "active" : ""} onClick={() => setActiveGroup(index)}>{title}</button>; })}</div>}
    {visibleGroups.map((group) => { const title = t(settingGroupKey(group.title, "title")); const description = t(settingGroupKey(group.title, "description")); return <section className="settings-group" key={group.title}><header title={description}><h2>{title} <span className="help-tip" aria-label={description}>?</span></h2><p>{description}</p></header>{group.title === "Admin" && <div className="admin-managed-settings"><h3>{t("serverSetup.title")}</h3><p>{t("serverSetup.description")}</p><div className="structured-grid"><label><span>{t("properties.adminPassword")}<small>{t(admin.adminPasswordSet ? "properties.passwordStored" : "properties.passwordMissing")}</small></span><input type="password" value={adminPassword} disabled={configuration.running || clearAdminPassword} placeholder={t("properties.keepPassword")} onChange={(event) => setAdminPassword(event.target.value)} /></label><label><span>{t("properties.serverPassword")}<small>{t(admin.serverPasswordSet ? "properties.passwordStored" : "properties.passwordMissing")}</small></span><input type="password" value={serverPassword} disabled={configuration.running || clearServerPassword} placeholder={t("properties.keepPassword")} onChange={(event) => setServerPassword(event.target.value)} /></label><label><span>{t("properties.restApi")}</span><button type="button" className={`toggle ${restApiEnabled ? "on" : ""}`} disabled={configuration.running} onClick={() => setRestApiEnabled((value) => !value)}><i />{t(restApiEnabled ? "common.on" : "common.off")}</button></label><label><span>{t("properties.restPort")}</span><input type="number" min={1} max={65535} value={restApiPort} disabled={configuration.running} onChange={(event) => setRestApiPort(Number(event.target.value))} /></label><label><span>{t("properties.rcon")}</span><button type="button" className={`toggle ${rconEnabled ? "on" : ""}`} disabled={configuration.running} onClick={() => setRconEnabled((value) => !value)}><i />{t(rconEnabled ? "common.on" : "common.off")}</button></label><label><span>{t("properties.rconPort")}</span><input type="number" min={1} max={65535} value={rconPort} disabled={configuration.running} onChange={(event) => setRconPort(Number(event.target.value))} /></label></div><div className="credential-actions"><label><input type="checkbox" checked={clearAdminPassword} disabled={configuration.running || !admin.adminPasswordSet} onChange={(event) => { setClearAdminPassword(event.target.checked); if (event.target.checked) setAdminPassword(""); }} /> {t("properties.clearAdmin")}</label><label><input type="checkbox" checked={clearServerPassword} disabled={configuration.running || !admin.serverPasswordSet} onChange={(event) => { setClearServerPassword(event.target.checked); if (event.target.checked) setServerPassword(""); }} /> {t("properties.clearServer")}</label></div>{configuration.running && <p className="form-warning">{t("serverSetup.stopToEdit")}</p>}</div>}<div className="structured-grid">{group.fields.map((field) => <SettingControl key={field.key} field={field} value={draft[field.key] ?? field.default} saved={initial[field.key] ?? field.default} present={Object.hasOwn(configuration.options, field.key)} changed={changed.includes(field)} onChange={(value) => setValue(field.key, value)} onRevert={() => { setDraft((current) => ({ ...current, [field.key]: initial[field.key] ?? field.default })); setTouched((current) => { const next = new Set(current); next.delete(field.key); return next; }); }} />)}</div></section>; })}
    <div className="structured-actions"><span>{changedCount ? t("structured.unsaved", { count: changedCount }) : t("structured.noChanges")}</span><button className="button ghost" disabled={!changedCount || save.isPending} onClick={() => { setDraft(initial); setTouched(new Set()); setAdminPassword(""); setServerPassword(""); setClearAdminPassword(false); setClearServerPassword(false); setRestApiEnabled(admin.restApiEnabled); setRestApiPort(admin.restApiPort); setRconEnabled(admin.rconEnabled); setRconPort(admin.rconPort); }}>{t("structured.discard")}</button><button className="button primary" disabled={!changedCount || save.isPending} onClick={() => save.mutate()}>{t(save.isPending ? "common.saving" : "structured.save")}</button></div>
  </div>;
}

function SettingControl({ field, value, saved, present, changed, onChange, onRevert }: { field: PalworldSettingField; value: Value; saved: Value; present: boolean; changed: boolean; onChange(value: Value): void; onRevert(): void }) {
  const { t } = useTranslation(); const label = t(settingFieldKey(field.key, "label")); const hint = field.hint ? t(settingFieldKey(field.key, "hint")) : ""; const description = hint || `${label} (${field.key})`;
  return <label className={changed ? "changed" : ""} title={description}><span><span>{label} <i className="help-tip">?</i>{!present && <em>{t("structured.default")}</em>}</span><small>{field.key}</small>{hint && <small className="field-hint">{hint}</small>}</span>{field.type === "bool" ? <button type="button" className={`toggle ${value ? "on" : ""}`} onClick={() => onChange(!value)}><i />{t(value ? "common.on" : "common.off")}</button> : field.type === "select" ? <select value={String(value)} onChange={(event) => onChange(event.target.value)}>{field.options?.map((choice) => <option key={choice}>{choice}</option>)}</select> : <input type={field.type === "int" || field.type === "float" ? "number" : "text"} value={String(value)} min={field.min} max={field.max} step={field.type === "int" ? 1 : field.type === "float" ? 0.1 : undefined} onChange={(event) => onChange(field.type === "int" || field.type === "float" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)} />}{changed && <button type="button" className="field-revert" onClick={onRevert}>{t("structured.revert", { value: String(saved) })}</button>}</label>;
}
