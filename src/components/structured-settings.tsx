"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { decodeDefaultSettingValue, decodeSettingValue, PALWORLD_SETTING_FIELD_MAP, PALWORLD_SETTING_FIELDS, PALWORLD_SETTING_TABS, settingLayoutSpan, settingPresentation, type DecodedSettingValue, type PalworldSettingField, type PalworldSettingPresentation, type PalworldSettingValue } from "@/contracts/palworld-settings";
import type { WorldRegistration } from "@/contracts/world";
import { settingFieldKey, settingGroupKey } from "@/lib/localization-resources";
import { SettingHelp } from "./setting-help";

type Value = PalworldSettingValue;
type Structured = {
  options: Record<string, string>; exists: boolean; running: boolean; restartRequired: boolean; path: string;
  appliedOptions: Record<string, string>; desiredRevision: number; appliedRevision: number; pendingApply: boolean; drift: boolean; driftReason: string | null; applyError: string | null;
  shippedDefaults: { available: boolean; options: Record<string, string> };
  schemaWarnings: { unknownActiveKeys: string[]; unknownDefaultKeys: string[]; missingDefaultKeys: string[] };
};
type AdvertisedPort = { mode: "inherit"; effectivePort: number } | { mode: "override"; effectivePort: number } | { mode: "invalid"; raw: string; effectivePort: number };
type AdminConfiguration = {
  restApiEnabled: boolean; restApiPort: number; rconEnabled: boolean; rconPort: number;
  displayName: string; installDir: string; platform: "linux" | "windows"; gamePort: number; queryPort: number; advertisedPort: AdvertisedPort;
  status: "stopped" | "starting" | "running" | "stopping" | "crashed" | "unknown";
  communityServer: boolean; autostart: boolean; crashGuard: boolean; legacyPerfFlags: boolean; extraArgs: string; environment: Record<string, string>;
  wineBinary: string; winePrefix: string | null; wineLaunchFlags: string;
};
type StructuredResponse = { configuration: Structured; admin: AdminConfiguration; appliedAdmin: AdminConfiguration };
type ManagerDraft = {
  displayName: string; installDir: string; platform: "linux" | "windows"; gamePort: string; queryPort: string; publicPort: string;
  communityServer: boolean; autostart: boolean; crashGuard: boolean; legacyPerfFlags: boolean; extraArgs: string; environment: string;
  wineBinary: string; winePrefix: string; wineLaunchFlags: string; restApiEnabled: boolean; restApiPort: string; rconEnabled: boolean; rconPort: string;
};
const presets: Record<string, { labelKey: string; values: Record<string, Value> }> = {
  casual: { labelKey: "structured.preset.casual", values: { EnemyDropItemRate: 1.25, CollectionDropRate: 1.15, DeathPenalty: "Item", SupplyDropSpan: 50, PalSpawnNumRate: 1, ServerPlayerMaxNum: 20 } },
  balanced: { labelKey: "structured.preset.balanced", values: { EnemyDropItemRate: 1.05, CollectionDropRate: 1, DeathPenalty: "ItemAndEquipment", SupplyDropSpan: 60, PalSpawnNumRate: 1, ServerPlayerMaxNum: 40 } },
  smallGroup: { labelKey: "structured.preset.smallGroup", values: { EnemyDropItemRate: 1.1, CollectionDropRate: 1.05, DeathPenalty: "Item", SupplyDropSpan: 55, PalSpawnNumRate: 1, ServerPlayerMaxNum: 24 } },
};
type ManagedSection = NonNullable<(typeof PALWORLD_SETTING_TABS)[number]["sections"][number]["managed"]>;
const managerSectionKeys: Record<ManagedSection, readonly (keyof ManagerDraft)[]> = {
  identity: ["displayName"],
  listing: ["communityServer", "publicPort"],
  network: ["gamePort", "queryPort", "restApiEnabled", "restApiPort", "rconEnabled", "rconPort"],
  lifecycle: ["autostart", "crashGuard"],
  performance: ["legacyPerfFlags"],
  launch: ["installDir", "platform", "extraArgs", "environment", "wineBinary", "winePrefix", "wineLaunchFlags"],
  registration: [],
};

async function get(worldId: string): Promise<StructuredResponse> { const response = await fetch(`/api/worlds/${worldId}/configuration/admin`); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; }
function registrationFileName(name: string) { const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "world"; return `${slug}.psm-next.json`; }
function downloadInBrowser(name: string, content: string) { const url = URL.createObjectURL(new Blob([content], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
function valuesEqual(left: Value | undefined, right: Value | undefined) { return Array.isArray(left) && Array.isArray(right) ? left.length === right.length && left.every((value, index) => value === right[index]) : left === right; }
export function StructuredSettings({ worldId, onNotice }: { worldId: string; onNotice(message: string): void }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["configuration-options", worldId], queryFn: () => get(worldId) });
  if (query.isLoading) return <p className="muted">{t("structured.loading")}</p>;
  if (query.error || !query.data) return <p className="error-text">{query.error?.message ?? t("structured.unavailable")}</p>;
  return <StructuredForm key={JSON.stringify(query.data)} worldId={worldId} configuration={query.data.configuration} admin={query.data.admin} appliedAdmin={query.data.appliedAdmin} onNotice={onNotice} />;
}

function StructuredForm({ worldId, configuration, admin, appliedAdmin, onNotice }: { worldId: string; configuration: Structured; admin: AdminConfiguration; appliedAdmin: AdminConfiguration; onNotice(message: string): void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const importInput = useRef<HTMLInputElement>(null);
  const activeStates = useMemo(() => Object.fromEntries(PALWORLD_SETTING_FIELDS.map((field) => [field.key, decodeSettingValue(field, configuration.options[field.key])])) as Record<string, DecodedSettingValue>, [configuration]);
  const appliedStates = useMemo(() => Object.fromEntries(PALWORLD_SETTING_FIELDS.map((field) => [field.key, decodeSettingValue(field, configuration.appliedOptions[field.key])])) as Record<string, DecodedSettingValue>, [configuration]);
  const defaultStates = useMemo(() => Object.fromEntries(PALWORLD_SETTING_FIELDS.map((field) => [field.key, decodeDefaultSettingValue(field, configuration.shippedDefaults.options[field.key])])) as Record<string, DecodedSettingValue>, [configuration]);
  const initial = useMemo(() => Object.fromEntries(PALWORLD_SETTING_FIELDS.map((field) => {
    const active = activeStates[field.key]!; const shipped = defaultStates[field.key]!;
    return [field.key, active.status === "valid" ? active.value : active.status === "missing" && shipped.status === "valid" ? shipped.value : undefined];
  })) as Record<string, Value | undefined>, [activeStates, defaultStates]);
  const [draft, setDraft] = useState<Record<string, Value | undefined>>(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [resetToDefaults, setResetToDefaults] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState(0);
  const [search, setSearch] = useState("");
  const [reviewChanges, setReviewChanges] = useState(false);
  const [managementPending, setManagementPending] = useState(false);
  const activeServerName = activeStates.ServerName?.status === "valid" && typeof activeStates.ServerName.value === "string" ? activeStates.ServerName.value : undefined;
  const initialManager: ManagerDraft = {
    displayName: admin.displayName === activeServerName ? "" : admin.displayName, installDir: admin.installDir, platform: admin.platform,
    gamePort: String(admin.gamePort), queryPort: String(admin.queryPort), publicPort: admin.advertisedPort.mode === "inherit" ? "" : admin.advertisedPort.mode === "override" ? String(admin.advertisedPort.effectivePort) : admin.advertisedPort.raw,
    communityServer: admin.communityServer, autostart: admin.autostart, crashGuard: admin.crashGuard,
    legacyPerfFlags: admin.legacyPerfFlags, extraArgs: admin.extraArgs, environment: JSON.stringify(admin.environment, null, 2),
    wineBinary: admin.wineBinary, winePrefix: admin.winePrefix ?? "", wineLaunchFlags: admin.wineLaunchFlags,
    restApiEnabled: admin.restApiEnabled, restApiPort: String(admin.restApiPort), rconEnabled: admin.rconEnabled, rconPort: String(admin.rconPort),
  };
  const [manager, setManager] = useState<ManagerDraft>(initialManager);
  const managerLocked = false;
  const worldRunning = admin.status !== "stopped";
  const changed = PALWORLD_SETTING_FIELDS.filter((field) => resetToDefaults.has(field.key) || (touched.has(field.key) && !valuesEqual(draft[field.key], initial[field.key])));
  const changedKeys = new Set(changed.map((field) => field.key));
  const managerChangedKeys = new Set((Object.keys(initialManager) as Array<keyof ManagerDraft>).filter((key) => manager[key] !== initialManager[key]));
  const managedChangedCount = managerChangedKeys.size;
  const changedCount = changed.length + managedChangedCount;
  const setManagerValue = <K extends keyof ManagerDraft>(key: K, value: ManagerDraft[K]) => setManager((current) => ({ ...current, [key]: value }));
  const setValue = (key: string, value: Value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setTouched((current) => new Set(current).add(key));
    setResetToDefaults((current) => { const next = new Set(current); next.delete(key); return next; });
  };
  const stageDefaultRepair = (field: PalworldSettingField) => {
    const shipped = defaultStates[field.key]; if (shipped?.status !== "valid") return;
    setDraft((current) => ({ ...current, [field.key]: shipped.value }));
    setResetToDefaults((current) => new Set(current).add(field.key));
    setTouched((current) => new Set(current).add(field.key));
  };
  const revertField = (key: string) => {
    setDraft((current) => ({ ...current, [key]: initial[key] }));
    setTouched((current) => { const next = new Set(current); next.delete(key); return next; });
    setResetToDefaults((current) => { const next = new Set(current); next.delete(key); return next; });
  };
  const save = useMutation({ mutationFn: async () => {
    const changes = Object.fromEntries(changed.filter((field) => !resetToDefaults.has(field.key)).map((field) => [field.key, draft[field.key]]));
    const parsePort = (value: string, label: string) => { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(t("properties.portInvalid", { label })); return parsed; };
    let parsedEnvironment: Record<string, string> | undefined;
    if (managerChangedKeys.has("environment")) {
      const parsed: unknown = JSON.parse(manager.environment);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || Object.values(parsed).some((value) => typeof value !== "string")) throw new Error(t("properties.environmentInvalid"));
      parsedEnvironment = parsed as Record<string, string>;
    }
    const managed = {
      ...(managerChangedKeys.has("displayName") ? { displayNameOverride: manager.displayName.trim() || null } : {}),
      ...(managerChangedKeys.has("installDir") ? { installDir: manager.installDir } : {}), ...(managerChangedKeys.has("platform") ? { platform: manager.platform } : {}),
      ...(managerChangedKeys.has("gamePort") ? { gamePort: parsePort(manager.gamePort, t("properties.gamePort")) } : {}),
      ...(managerChangedKeys.has("queryPort") ? { queryPort: parsePort(manager.queryPort, t("properties.queryPort")) } : {}),
      ...(managerChangedKeys.has("publicPort") ? { publicPortOverride: manager.publicPort.trim() ? parsePort(manager.publicPort, t("properties.publicPort")) : null } : {}),
      ...(managerChangedKeys.has("communityServer") ? { communityServer: manager.communityServer } : {}),
      ...(managerChangedKeys.has("autostart") ? { autostart: manager.autostart } : {}), ...(managerChangedKeys.has("crashGuard") ? { crashGuard: manager.crashGuard } : {}),
      ...(managerChangedKeys.has("legacyPerfFlags") ? { legacyPerfFlags: manager.legacyPerfFlags } : {}), ...(managerChangedKeys.has("extraArgs") ? { extraArgs: manager.extraArgs } : {}),
      ...(parsedEnvironment ? { env: parsedEnvironment } : {}), ...(managerChangedKeys.has("wineBinary") ? { wineBinary: manager.wineBinary } : {}),
      ...(managerChangedKeys.has("winePrefix") ? { winePrefix: manager.winePrefix.trim() || null } : {}), ...(managerChangedKeys.has("wineLaunchFlags") ? { wineLaunchFlags: manager.wineLaunchFlags } : {}),
      ...(managerChangedKeys.has("restApiEnabled") ? { restApiEnabled: manager.restApiEnabled } : {}),
      ...(managerChangedKeys.has("restApiPort") ? { restApiPort: parsePort(manager.restApiPort, t("properties.restPort")) } : {}),
      ...(managerChangedKeys.has("rconEnabled") ? { rconEnabled: manager.rconEnabled } : {}),
      ...(managerChangedKeys.has("rconPort") ? { rconPort: parsePort(manager.rconPort, t("properties.rconPort")) } : {}),
    };
    const response = await fetch(`/api/worlds/${worldId}/configuration/admin`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseRevision: configuration.desiredRevision, changes, resetToDefaults: [...resetToDefaults], managed }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error); return body;
  }, onSuccess: (body) => { onNotice(t(body.configurationChanged && configuration.running ? "structured.savedRestart" : "structured.saved", { count: changedCount })); void client.invalidateQueries({ queryKey: ["configuration-options", worldId] }); void client.invalidateQueries({ queryKey: ["configuration", worldId] }); void client.invalidateQueries({ queryKey: ["configuration-versions", worldId] }); void client.invalidateQueries({ queryKey: ["world", worldId] }); }, onError: (error) => onNotice(error.message) });
  const searchTerm = search.trim().toLowerCase();
  const managedSearchText: Record<ManagedSection, string> = {
    identity: ["identity name", t("managerProperties.displayName")].join(" ").toLowerCase(),
    listing: ["listing community public ip public port advertised", t("properties.community"), t("properties.publicPort")].join(" ").toLowerCase(),
    network: ["game query port network rest api rcon", t("properties.gamePort"), t("properties.queryPort"), t("properties.restApi"), t("properties.rcon")].join(" ").toLowerCase(),
    lifecycle: ["lifecycle autostart crash recovery save logs", t("properties.autostart"), t("properties.crashRecovery")].join(" ").toLowerCase(),
    performance: ["performance flags synchronization", t("properties.performance")].join(" ").toLowerCase(),
    launch: ["installation path platform launch wine environment", t("properties.installDirectory"), t("properties.environment")].join(" ").toLowerCase(),
    registration: ["registration export unregister removal"].join(" ").toLowerCase(),
  };
  const managedCount = (kind: ManagedSection) => managerSectionKeys[kind].filter((key) => managerChangedKeys.has(key)).length;
  const sourceTabs = searchTerm || reviewChanges ? PALWORLD_SETTING_TABS : [PALWORLD_SETTING_TABS[activeTab]!];
  const visibleTabs = sourceTabs.map((tab) => ({ ...tab, sections: tab.sections.map((section) => {
    const fields = section.fields.filter((field) => reviewChanges ? changedKeys.has(field.key) : searchTerm ? `${t(settingFieldKey(field.key, "label"))} ${field.key} ${t(settingFieldKey(field.key, "hint"))}`.toLowerCase().includes(searchTerm) : true);
    const showManaged = Boolean(section.managed && (reviewChanges ? managedCount(section.managed) : searchTerm ? managedSearchText[section.managed].includes(searchTerm) : true));
    return { ...section, fields, showManaged };
  }).filter((section) => section.fields.length || section.showManaged) })).filter((tab) => tab.sections.length);
  const sectionChangeCount = (section: (typeof PALWORLD_SETTING_TABS)[number]["sections"][number]) => section.fields.filter((field) => changedKeys.has(field.key)).length + (section.managed ? managedCount(section.managed) : 0);
  const tabChangeCount = (tab: (typeof PALWORLD_SETTING_TABS)[number]) => tab.sections.reduce((count, section) => count + sectionChangeCount(section), 0);
  function applyPreset(name: string) { const preset = presets[name]; if (!preset) return; setDraft((current) => ({ ...current, ...preset.values })); setTouched((current) => new Set([...current, ...Object.keys(preset.values)])); setResetToDefaults((current) => new Set([...current].filter((key) => !Object.hasOwn(preset.values, key)))); setSearch(""); setReviewChanges(true); onNotice(t("structured.presetStaged", { name: t(preset.labelKey) })); }
  async function exportConfiguration() { const response = await fetch(`/api/worlds/${worldId}/configuration/export`); if (!response.ok) { const body = await response.json(); throw new Error(body.error); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `palworld-settings-${worldId}.zip`; anchor.click(); URL.revokeObjectURL(url); }
  async function importConfiguration(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > 5_000_000) { onNotice(t("structured.archiveTooLarge")); return; } const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); const response = await fetch(`/api/worlds/${worldId}/configuration/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ zipBase64: btoa(binary), baseRevision: configuration.desiredRevision }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); onNotice(t("structured.imported")); void client.invalidateQueries({ queryKey: ["configuration-options", worldId] }); void client.invalidateQueries({ queryKey: ["configuration", worldId] }); void client.invalidateQueries({ queryKey: ["configuration-versions", worldId] }); }
  async function chooseDirectory() { const selected = await window.psmDesktop?.pickDirectory(); if (selected) setManagerValue("installDir", selected); }
  async function reconcile(action: "import-file" | "reapply-desired") { const response = await fetch(`/api/worlds/${worldId}/configuration/reconcile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); onNotice(action === "import-file" ? "Imported the external configuration." : "Reapplied desired settings."); await client.invalidateQueries({ queryKey: ["configuration-options", worldId] }); await client.invalidateQueries({ queryKey: ["configuration", worldId] }); await client.invalidateQueries({ queryKey: ["world", worldId] }); }
  async function exportRegistration() {
    setManagementPending(true);
    try {
      const response = await fetch(`/api/worlds/${worldId}/registration`); const body = await response.json(); if (!response.ok) throw new Error(body.error);
      const registration = body.registration as WorldRegistration; const stagedServerName = typeof draft.ServerName === "string" ? draft.ServerName : activeServerName; const fileName = registrationFileName(manager.displayName.trim() || stagedServerName || admin.displayName); const content = `${JSON.stringify(registration, null, 2)}\n`;
      const saved = window.psmDesktop ? await window.psmDesktop.saveRegistration(fileName, content) : (downloadInBrowser(fileName, content), fileName);
      onNotice(saved ? t("properties.exported", { path: saved }) : t("properties.exportCancelled"));
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); } finally { setManagementPending(false); }
  }
  async function unregister() {
    if (!window.confirm(t("properties.unregisterConfirm", { world: admin.displayName }))) return;
    setManagementPending(true);
    try { const response = await fetch(`/api/worlds/${worldId}`, { method: "DELETE" }); const body = await response.json(); if (!response.ok) throw new Error(body.error); router.push("/"); }
    catch (error) { onNotice(error instanceof Error ? error.message : String(error)); setManagementPending(false); }
  }
  const changeBadge = (key: keyof ManagerDraft) => managerChangedKeys.has(key) ? <em className="change-badge">{t("structured.changedBadge")}</em> : null;
  const persistedManagerValue = (key: keyof ManagerDraft) => key === "environment" ? appliedAdmin.environment : key === "publicPort" ? appliedAdmin.advertisedPort : appliedAdmin[key as keyof AdminConfiguration];
  const desiredManagerValue = (key: keyof ManagerDraft) => key === "environment" ? admin.environment : key === "publicPort" ? admin.advertisedPort : admin[key as keyof AdminConfiguration];
  const managerPendingApply = (key: keyof ManagerDraft) => configuration.pendingApply && JSON.stringify(persistedManagerValue(key)) !== JSON.stringify(desiredManagerValue(key));
  const managerHelp = (key: keyof ManagerDraft) => {
    const keys: Record<keyof ManagerDraft, string> = {
      displayName: "managerProperties.displayNameHelp", installDir: "managerProperties.locationHelp", platform: "properties.platformHelp",
      gamePort: "properties.gamePortHelp", queryPort: "properties.queryPortHelp", publicPort: "properties.publicPortHelp",
      communityServer: "properties.communityHelp", autostart: "properties.autostartHelp", crashGuard: "properties.crashRecoveryHelp",
      legacyPerfFlags: "properties.performanceHelp", extraArgs: "properties.extraArgsHelp", environment: "properties.environmentHelp",
      wineBinary: "properties.wineBinaryHelp", winePrefix: "properties.winePrefixHelp", wineLaunchFlags: "properties.wineFlagsHelp",
      restApiEnabled: "properties.restApiHelp", restApiPort: "properties.restPortHelp", rconEnabled: "properties.rconHelp", rconPort: "properties.rconPortHelp",
    };
    return t(keys[key], key === "publicPort" ? { port: manager.gamePort || admin.gamePort } : undefined);
  };
  function managerControl(key: string) {
    const changedClass = managerChangedKeys.has(key as keyof ManagerDraft) ? "changed" : "";
    const typedKey = key as keyof ManagerDraft;
    const label = (text: string) => <span>{text}<SettingHelp label={t("structured.helpFor", { setting: text })} heading={t("structured.psmSetting")} guidance={managerHelp(typedKey)} />{changeBadge(typedKey)}{managerPendingApply(typedKey) && <em className="change-badge">Applies after restart</em>}</span>;
    if (key === "displayName") { const stagedServerName = typeof draft.ServerName === "string" ? draft.ServerName : activeServerName ?? admin.displayName; return <label className={`manager-field ${changedClass}`}>{label(t("managerProperties.displayName"))}<input aria-label={t("managerProperties.displayName")} value={manager.displayName} placeholder={stagedServerName} onChange={(event) => setManagerValue("displayName", event.target.value)} /></label>; }
    if (key === "communityServer") return <label className={`manager-field ${changedClass}`}>{label(t("properties.community"))}<button type="button" className={`toggle ${manager.communityServer ? "on" : ""}`} disabled={managerLocked} aria-label={t("properties.community")} aria-pressed={manager.communityServer} onClick={() => setManagerValue("communityServer", !manager.communityServer)}><i />{t(manager.communityServer ? "common.on" : "common.off")}</button></label>;
    if (key === "publicPort") return <label className={`manager-field ${changedClass} ${admin.advertisedPort.mode === "invalid" && !managerChangedKeys.has("publicPort") ? "invalid" : ""}`}>{label(t("properties.publicPort"))}<span className="inline-control"><input aria-label={t("properties.publicPort")} inputMode="numeric" value={manager.publicPort} disabled={managerLocked} placeholder={manager.gamePort || String(admin.gamePort)} aria-invalid={admin.advertisedPort.mode === "invalid" && !managerChangedKeys.has("publicPort")} onChange={(event) => setManagerValue("publicPort", event.target.value)} />{admin.advertisedPort.mode === "invalid" && !managerChangedKeys.has("publicPort") && <button type="button" className="button ghost" disabled={managerLocked} onClick={() => setManagerValue("publicPort", "")}>{t("properties.useGamePort")}</button>}</span></label>;
    if (key === "gamePort" || key === "queryPort") { const text = t(key === "gamePort" ? "properties.gamePort" : "properties.queryPort"); return <label className={`manager-field ${changedClass}`}>{label(text)}<input aria-label={text} type="number" min={1} max={65535} value={manager[key]} disabled={managerLocked} onChange={(event) => setManagerValue(key, event.target.value)} /></label>; }
    if (key === "restApiEnabled" || key === "rconEnabled") { const text = t(key === "restApiEnabled" ? "properties.restApi" : "properties.rcon"); return <label className={`manager-field service-toggle ${changedClass}`}>{label(text)}<button type="button" className={`toggle ${manager[key] ? "on" : ""}`} disabled={managerLocked} aria-label={text} aria-pressed={manager[key]} onClick={() => setManagerValue(key, !manager[key])}><i />{t(manager[key] ? "common.on" : "common.off")}</button></label>; }
    if (key === "restApiPort" || key === "rconPort") { const text = t(key === "restApiPort" ? "properties.restPort" : "properties.rconPort"); return <label className={`manager-field service-port ${changedClass}`}>{label(text)}<input aria-label={text} type="number" min={1} max={65535} value={manager[key]} disabled={managerLocked} onChange={(event) => setManagerValue(key, event.target.value)} /></label>; }
    if (key === "autostart" || key === "crashGuard" || key === "legacyPerfFlags") { const text = t(key === "autostart" ? "properties.autostart" : key === "crashGuard" ? "properties.crashRecovery" : "properties.performance"); return <label className={`manager-field ${changedClass}`}>{label(text)}<button type="button" className={`toggle ${manager[key] ? "on" : ""}`} disabled={key === "legacyPerfFlags" && managerLocked} aria-label={text} aria-pressed={manager[key]} onClick={() => setManagerValue(key, !manager[key])}><i />{t(manager[key] ? "common.on" : "common.off")}</button></label>; }
    if (key === "platform") return <label className={`manager-field ${changedClass}`}>{label(t("properties.platform"))}<select aria-label={t("properties.platform")} value={manager.platform} disabled={managerLocked} onChange={(event) => setManagerValue("platform", event.target.value as "linux" | "windows")}><option value="linux">{t("properties.linux")}</option><option value="windows">{t("properties.windows")}</option></select></label>;
    if (key === "installDir") return <label className={`manager-field ${changedClass}`}>{label(t("properties.installDirectory"))}<span className="path-picker"><input aria-label={t("properties.installDirectory")} required value={manager.installDir} disabled={managerLocked} onChange={(event) => setManagerValue("installDir", event.target.value)} /><button type="button" disabled={managerLocked} onClick={() => void chooseDirectory()}>{t("properties.browse")}</button></span></label>;
    if (key === "environment") return <label className={`manager-field ${changedClass}`}>{label(t("properties.environment"))}<textarea className="environment-editor" aria-label={t("properties.environment")} value={manager.environment} disabled={managerLocked} onChange={(event) => setManagerValue("environment", event.target.value)} spellCheck={false} /></label>;
    const textKeys = { extraArgs: "properties.extraArgs", wineBinary: "properties.wineBinary", winePrefix: "properties.winePrefix", wineLaunchFlags: "properties.wineFlags" } as const;
    if (key in textKeys) { const typedKey = key as keyof typeof textKeys; const text = t(textKeys[typedKey]); return <label className={`manager-field ${changedClass}`}>{label(text)}<input aria-label={text} value={manager[typedKey]} disabled={managerLocked} onChange={(event) => setManagerValue(typedKey, event.target.value)} /></label>; }
    return <div className="registration-actions"><p>{t("properties.security")}</p><div className="management-actions"><button type="button" className="button ghost" disabled={managementPending} onClick={() => void exportRegistration()}>{t("properties.export")}</button><button type="button" className="button danger" disabled={managementPending || worldRunning} onClick={() => void unregister()}>{t("properties.unregister")}</button></div></div>;
  }
  function sectionGrid(section: (typeof visibleTabs)[number]["sections"][number]) {
    const fields = new Map(section.fields.map((field) => [field.key, field]));
    const managerVisible = (key: string) => section.showManaged && (!reviewChanges || key === "registrationActions" || managerChangedKeys.has(key as keyof ManagerDraft));
    const layout = section.layout ?? section.fields.map((field) => { const presentation = settingPresentation(field); return { keys: [field.key], span: settingLayoutSpan(presentation), presentation }; });
    const items = layout.flatMap((item) => {
      const keys = item.keys.filter((key) => fields.has(key) || (!PALWORLD_SETTING_FIELD_MAP.has(key) && managerVisible(key)));
      if (!keys.length) return [];
      const presentation = item.presentation ?? (keys.length === 1 && fields.get(keys[0]!) ? settingPresentation(fields.get(keys[0]!)!) : "standard");
      const controls = keys.map((key) => { const field = fields.get(key); return field ? <SettingControl key={key} field={field} presentation={presentation} value={draft[key]} activeState={activeStates[key]!} appliedState={appliedStates[key]!} pendingApply={configuration.pendingApply} defaultState={defaultStates[key]!} changed={changedKeys.has(key)} resetScheduled={resetToDefaults.has(key)} onChange={(value) => setValue(key, value)} onReplaceDefault={() => stageDefaultRepair(field)} onRevert={() => revertField(key)} /> : <div className="manager-control" key={key}>{managerControl(key)}</div>; });
      return [<div className={`structured-layout-item span-${item.span} ${presentation} ${"grouped" in item && item.grouped && keys.length > 1 ? "service-block" : ""} ${keys[0] === "registrationActions" ? "registration-item" : ""}`} key={item.keys.join("+")}>{controls}</div>];
    });
    return <>{items.length > 0 && <div className="structured-grid">{items}</div>}{managerLocked && section.managed === "listing" && <p className="form-warning">{t("properties.stopToEditListing")}</p>}{managerLocked && section.managed === "network" && <p className="form-warning">{t("properties.stopToEditNetwork")}</p>}{managerLocked && section.managed === "launch" && <p className="form-warning">{t("properties.stopToEdit")}</p>}</>;
  }
  return <Tooltip.Provider delayDuration={250}><div>
    {configuration.pendingApply && <div className="restart-required">{configuration.drift ? (configuration.driftReason ?? "The active file differs from the applied settings.") : configuration.applyError ? `Settings are pending: ${configuration.applyError}` : t("structured.restartRequired")}{!worldRunning && (configuration.drift || configuration.applyError) && <span className="management-actions"><button className="button ghost" onClick={() => void reconcile("reapply-desired").catch((error) => onNotice(error.message))}>Reapply desired</button>{configuration.drift && <button className="button ghost" onClick={() => void reconcile("import-file").catch((error) => onNotice(error.message))}>Import file</button>}</span>}</div>}
    {!configuration.shippedDefaults.available && <div className="settings-compatibility-warning">{t("structured.templateUnavailable")}</div>}
    {(configuration.schemaWarnings.unknownActiveKeys.length > 0 || configuration.schemaWarnings.unknownDefaultKeys.length > 0 || configuration.schemaWarnings.missingDefaultKeys.length > 0) && <div className="settings-compatibility-warning">{t("structured.schemaWarning", { keys: [...configuration.schemaWarnings.unknownActiveKeys, ...configuration.schemaWarnings.unknownDefaultKeys, ...configuration.schemaWarnings.missingDefaultKeys].join(", ") })}</div>}
    <div className="structured-notice">{t("structured.changedOnly")}</div>
    <div className="settings-tools"><input value={search} onChange={(event) => { setSearch(event.target.value); setReviewChanges(false); }} placeholder={t("structured.search")} /><button className={`button review-changes ${reviewChanges ? "active" : ""}`} disabled={!changedCount && !reviewChanges} onClick={() => { setSearch(""); setReviewChanges((value) => !value); }}>{reviewChanges ? t("structured.showAll") : t("structured.reviewChanges", { count: changedCount })}</button><div className="settings-preset-actions"><span>{t("structured.presets")}</span>{Object.entries(presets).map(([name, preset]) => <button key={name} className="button ghost" onClick={() => applyPreset(name)}>{t(preset.labelKey)}</button>)}</div><span className="tool-spacer" /><div className="settings-file-actions"><button className="button ghost" onClick={() => void exportConfiguration().catch((error) => onNotice(error.message))}>{t("structured.export")}</button><button className="button ghost" onClick={() => importInput.current?.click()}>{t("structured.import")}</button></div><input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => void importConfiguration(event).catch((error) => onNotice(error.message))} /></div>
    <div className="settings-groups" role="tablist">{PALWORLD_SETTING_TABS.map((tab, index) => { const title = t(settingGroupKey(tab.id, "title")); const description = t(settingGroupKey(tab.id, "description")); const count = tabChangeCount(tab); return <button key={tab.id} role="tab" aria-selected={!searchTerm && !reviewChanges && index === activeTab} title={description} className={!searchTerm && !reviewChanges && index === activeTab ? "active" : ""} onClick={() => { setActiveTab(index); setSearch(""); setReviewChanges(false); }}>{title}{count > 0 && <span className="change-count">{count}</span>}</button>; })}</div>
    {(searchTerm || reviewChanges) && <div className="settings-results-heading"><strong>{reviewChanges ? t("structured.reviewHeading", { count: changedCount }) : t("structured.searchResults")}</strong><span>{reviewChanges ? t("structured.reviewDescription") : t("structured.searchDescription")}</span></div>}
    {visibleTabs.length ? visibleTabs.map((tab) => { const title = t(settingGroupKey(tab.id, "title")); const description = t(settingGroupKey(tab.id, "description")); return <div className="settings-tab-content" key={tab.id}><header className="settings-tab-heading"><h2>{title}<SettingHelp label={t("structured.helpFor", { setting: title })} heading={title} guidance={description} /></h2></header>{tab.sections.map((section) => { const sectionTitle = t(settingGroupKey(section.id, "title")); const sectionDescription = t(settingGroupKey(section.id, "description")); const count = sectionChangeCount(section); return <section className="settings-group" key={section.id}><header><h3>{sectionTitle}<SettingHelp label={t("structured.helpFor", { setting: sectionTitle })} heading={sectionTitle} guidance={sectionDescription} />{count > 0 && <span className="section-change-count">{t("structured.changedCount", { count })}</span>}</h3></header>{section.id === "access-security" && <div className="password-storage-notice">{t("structured.passwordStorageNotice")}</div>}{sectionGrid(section)}</section>; })}</div>; }) : <div className="settings-empty">{t("structured.noResults")}</div>}
    <div className="structured-actions"><span>{changedCount ? t("structured.unsaved", { count: changedCount }) : t("structured.noChanges")}</span><button className="button ghost" disabled={!changedCount || save.isPending} onClick={() => { setDraft(initial); setTouched(new Set()); setResetToDefaults(new Set()); setManager(initialManager); setReviewChanges(false); }}>{t("structured.discard")}</button><button className="button primary" disabled={!changedCount || save.isPending} onClick={() => save.mutate()}>{t(save.isPending ? "common.saving" : "structured.save")}</button></div>
  </div></Tooltip.Provider>;
}

function SettingControl({ field, presentation, value, activeState, appliedState, pendingApply, defaultState, changed, resetScheduled, onChange, onReplaceDefault, onRevert }: { field: PalworldSettingField; presentation: PalworldSettingPresentation; value: Value | undefined; activeState: DecodedSettingValue; appliedState: DecodedSettingValue; pendingApply: boolean; defaultState: DecodedSettingValue; changed: boolean; resetScheduled: boolean; onChange(value: Value): void; onReplaceDefault(): void; onRevert(): void }) {
  const { t } = useTranslation(); const label = t(settingFieldKey(field.key, "label")); const guidance = t(settingFieldKey(field.key, "hint")); const inputId = `setting-${field.key}`;
  const [passwordVisible, setPasswordVisible] = useState(false);
  const invalid = activeState.status === "invalid";
  const unavailable = value === undefined;
  const savedDisplay = field.type === "password" ? t("structured.savedPassword") : activeState.status === "valid" ? Array.isArray(activeState.value) ? activeState.value.join(", ") : String(activeState.value) : activeState.status === "missing" ? t("structured.unset") : activeState.raw;
  const differsFromApplied = pendingApply && JSON.stringify(activeState) !== JSON.stringify(appliedState);
  const appliedDisplay = field.type === "password" ? t("structured.savedPassword") : appliedState.status === "valid" ? Array.isArray(appliedState.value) ? appliedState.value.join(", ") : String(appliedState.value) : t("structured.unset");
  return <div className={`structured-field ${presentation} ${changed ? "changed" : ""} ${invalid && !changed ? "invalid" : ""}`}>
    <div className="setting-label"><span><label htmlFor={field.type === "bool" ? undefined : inputId}>{label}</label><SettingHelp label={t("structured.helpFor", { setting: label })} heading={field.key} guidance={guidance} />{changed && <em className="change-badge">{resetScheduled ? t("structured.repairStaged") : t("structured.changedBadge")}</em>}{differsFromApplied && <em className="change-badge">Applies after restart · Active: {appliedDisplay}</em>}{activeState.status === "missing" && defaultState.status === "valid" && !changed && <em>{t("structured.shippedDefault")}</em>}</span></div>
    {invalid && !changed ? <div className="invalid-setting"><code>{activeState.raw}</code><span>{activeState.reason}</span>{defaultState.status === "valid" && <button type="button" className="button ghost" onClick={onReplaceDefault}>{t("structured.replaceDefault")}</button>}</div> : unavailable ? <div className="unsupported-setting">{defaultState.status === "unsupported-default" ? t("structured.unsupportedDefault", { value: defaultState.raw }) : t("structured.unsetNoDefault")}</div> : field.type === "bool" ? <button type="button" className={`toggle ${value ? "on" : ""}`} aria-label={label} aria-pressed={Boolean(value)} onClick={() => onChange(!value)}><i />{t(value ? "common.on" : "common.off")}</button> : field.type === "select" ? <select id={inputId} value={String(value)} onChange={(event) => onChange(event.target.value)}>{field.options?.map((choice) => <option key={choice}>{choice}</option>)}</select> : field.type === "multi-select" ? <div id={inputId} className="setting-pill-select" role="group" aria-label={label}>{field.options?.map((choice) => { const selected = Array.isArray(value) && value.includes(choice); const lastSelected = selected && value.length === 1; return <button key={choice} type="button" className={selected ? "selected" : ""} aria-pressed={selected} disabled={lastSelected} onClick={() => onChange(selected ? value.filter((item) => item !== choice) : [...(Array.isArray(value) ? value : []), choice])}>{selected && <span aria-hidden="true">✓</span>}{choice}</button>; })}</div> : field.type === "password" ? <span className="password-control"><input id={inputId} type={passwordVisible ? "text" : "password"} value={String(value)} autoComplete="new-password" onChange={(event) => onChange(event.target.value)} /><button type="button" className="button ghost" aria-label={t(passwordVisible ? "structured.hidePassword" : "structured.showPassword")} onClick={() => setPasswordVisible((visible) => !visible)}>{t(passwordVisible ? "structured.hide" : "structured.show")}</button></span> : <input id={inputId} type={field.type === "int" || field.type === "float" ? "number" : "text"} value={String(value)} min={field.min} max={field.max} step={field.type === "int" ? 1 : field.type === "float" ? 0.1 : undefined} onChange={(event) => onChange(field.type === "int" || field.type === "float" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)} />}
    {changed && <button type="button" className="field-revert" onClick={onRevert}>{t("structured.revert", { value: savedDisplay })}</button>}
  </div>;
}
