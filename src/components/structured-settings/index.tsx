"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PALWORLD_SETTING_FIELD_MAP, PALWORLD_SETTING_TABS, settingLayoutSpan, settingPresentation } from "@/contracts/palworld-settings";
import { settingGroupKey } from "@/lib/localization-resources";
import { usePlatformLabel, useHostPlatform } from "@/lib/use-platform-label";
import { SettingHelp } from "../setting-help";
import { ManagerField } from "./manager-field";
import { SettingControl } from "./setting-control";
import { fetchAdministration, reconcileConfiguration, saveAdministration, settingsQueryKeys } from "./settings-io";
import { SettingsMenu, type SettingsMenuProps } from "../world-settings-menu";
import { type AdminConfiguration, type ManagerKey, type Structured } from "./types";
import { managedChanges, useManagerDraft } from "./use-manager-draft";
import { useSettingsDraft } from "./use-settings-draft";
import { sectionChangeCount, tabChangeCount, visibleTabs, type VisibleSection } from "./visible-tabs";

// The guided settings page: game options and PSM-owned settings edited together and saved as one
// revision. `use-settings-draft` and `use-manager-draft` hold the two drafts, `visible-tabs` the
// search/review filtering, `setting-control` and `manager-field` render one field each, and
// `settings-io` talks to the server. The settings menu (view mode, presets, files, removal) is
// the cog at the right of the toolbar and stays reachable even when the guided page cannot load.

type MenuProps = Omit<SettingsMenuProps, "onPreset" | "baseRevision">;
function SearchIcon() { return <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>; }

export function StructuredSettings({ worldId, onNotice, menu }: { worldId: string; onNotice(message: string): void; menu: MenuProps }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["configuration-options", worldId], queryFn: () => fetchAdministration(worldId) });
  const toolbar = <div className="settings-tools"><span className="tool-spacer" /><SettingsMenu {...menu} /></div>;
  if (query.isLoading) return <>{toolbar}<p className="muted">{t("structured.loading")}</p></>;
  if (query.error || !query.data) return <>{toolbar}<p className="error-text">{query.error?.message ?? t("structured.unavailable")}</p></>;
  // Remount (discarding drafts) only when a new settings revision loads, not when status-only fields refresh.
  return <StructuredForm key={`${worldId}:${query.data.configuration.desiredRevision}:${query.data.configuration.appliedRevision}`} worldId={worldId} configuration={query.data.configuration} admin={query.data.admin} appliedAdmin={query.data.appliedAdmin} onNotice={onNotice} menu={menu} />;
}

function StructuredForm({ worldId, configuration, admin, appliedAdmin, onNotice, menu }: { worldId: string; configuration: Structured; admin: AdminConfiguration; appliedAdmin: AdminConfiguration; onNotice(message: string): void; menu: MenuProps }) {
  const { t } = useTranslation(); const platformLabel = usePlatformLabel(); const host = useHostPlatform();
  const client = useQueryClient();
  const settings = useSettingsDraft(configuration);
  const activeServerName = settings.activeStates.ServerName?.status === "valid" && typeof settings.activeStates.ServerName.value === "string" ? settings.activeStates.ServerName.value : undefined;
  const managerDraft = useManagerDraft(admin, activeServerName);
  const { manager, setManagerValue, changedKeys: managerChangedKeys } = managerDraft;
  const [activeTab, setActiveTab] = useState(0);
  const [search, setSearch] = useState(""); const [searchOpen, setSearchOpen] = useState(false);
  const [reviewChanges, setReviewChanges] = useState(false);
  const worldRunning = admin.status !== "stopped";
  const stagedName = settings.staged("ServerName"); const stagedServerName = typeof stagedName === "string" ? stagedName : activeServerName;
  const changes = { changedKeys: settings.changedKeys, managerChangedKeys };
  const changedCount = settings.changed.length + managerChangedKeys.size;
  const invalidate = () => Promise.all(settingsQueryKeys(worldId).map((queryKey) => client.invalidateQueries({ queryKey })));

  const save = useMutation({
    mutationFn: () => saveAdministration(worldId, { baseRevision: configuration.desiredRevision, changes: settings.changes(), resetToDefaults: [...settings.resetToDefaults], managed: managedChanges(manager, managerChangedKeys, t, host) }),
    onSuccess: (body) => { onNotice(t(body.configurationChanged && configuration.running ? "structured.savedRestart" : "structured.saved", { count: changedCount })); void invalidate(); },
    onError: (error) => onNotice(error.message),
  });
  const searchTerm = search.trim().toLowerCase();
  const tabs = visibleTabs(t, { searchTerm, reviewChanges, activeTab }, changes);

  function applyPreset(name: string) { const preset = settings.applyPreset(name); if (!preset) return; setSearch(""); setReviewChanges(true); onNotice(t("structured.presetStaged", { name: t(preset.labelKey) })); }
  async function chooseDirectory() { const selected = await window.psmDesktop?.pickDirectory(); if (selected) setManagerValue("installDir", selected); }
  async function reconcile(action: "import-file" | "reapply-desired") { await reconcileConfiguration(worldId, action); onNotice(t(action === "import-file" ? "structured.reconcile.imported" : "structured.reconcile.reapplied")); await invalidate(); }
  function discard() { settings.discard(); managerDraft.discard(); setReviewChanges(false); }

  function sectionGrid(section: VisibleSection) {
    const fields = new Map(section.fields.map((field) => [field.key, field]));
    const managerVisible = (key: string) => section.showManaged && (!reviewChanges || managerChangedKeys.has(key as ManagerKey));
    const layout = section.layout ?? section.fields.map((field) => { const presentation = settingPresentation(field); return { keys: [field.key], span: settingLayoutSpan(presentation), presentation }; });
    const items = layout.flatMap((item) => {
      const keys = item.keys.filter((key) => fields.has(key) || (!PALWORLD_SETTING_FIELD_MAP.has(key) && managerVisible(key)));
      if (!keys.length) return [];
      const presentation = item.presentation ?? (keys.length === 1 && fields.get(keys[0]!) ? settingPresentation(fields.get(keys[0]!)!) : "standard");
      const controls = keys.map((key) => {
        const field = fields.get(key);
        if (field) return <SettingControl key={key} field={field} presentation={presentation} value={settings.staged(key)} activeState={settings.activeStates[key]!} appliedState={settings.appliedStates[key]!} pendingApply={configuration.pendingApply} defaultState={settings.defaultStates[key]!} changed={settings.changedKeys.has(key)} resetScheduled={settings.resetToDefaults.has(key)} onChange={(value) => settings.setValue(key, value)} onReplaceDefault={() => settings.stageDefaultRepair(field)} onRevert={() => settings.revertField(key)} />;
        return <div className="manager-control" key={key}><ManagerField fieldKey={key as ManagerKey} manager={manager} admin={admin} appliedAdmin={appliedAdmin} pendingApply={configuration.pendingApply} changed={managerChangedKeys.has(key as ManagerKey)} stagedServerName={stagedServerName} host={host} platformLabel={platformLabel} onChange={setManagerValue} onChooseDirectory={() => void chooseDirectory()} /></div>;
      });
      return [<div className={`structured-layout-item span-${item.span} ${presentation} ${"grouped" in item && item.grouped && keys.length > 1 ? "service-block" : ""}`} key={item.keys.join("+")}>{controls}</div>];
    });
    return <>{items.length > 0 && <div className="structured-grid">{items}</div>}</>;
  }

  return <Tooltip.Provider delayDuration={250}><div>
    {configuration.pendingApply && <div className="restart-required">{configuration.drift ? (configuration.driftReason ?? t("structured.driftDefault")) : configuration.applyError ? t("structured.pendingApplyError", { error: configuration.applyError }) : t("structured.restartRequired")}{!worldRunning && (configuration.drift || configuration.applyError) && <span className="management-actions"><button className="button ghost" onClick={() => void reconcile("reapply-desired").catch((error) => onNotice(error.message))}>{t("structured.reconcile.reapply")}</button>{configuration.drift && <button className="button ghost" onClick={() => void reconcile("import-file").catch((error) => onNotice(error.message))}>{t("structured.reconcile.importFile")}</button>}</span>}</div>}
    {!configuration.shippedDefaults.available && <div className="settings-compatibility-warning">{t("structured.templateUnavailable")}</div>}
    {(configuration.schemaWarnings.unknownActiveKeys.length > 0 || configuration.schemaWarnings.unknownDefaultKeys.length > 0 || configuration.schemaWarnings.missingDefaultKeys.length > 0) && <div className="settings-compatibility-warning">{t("structured.schemaWarning", { keys: [...configuration.schemaWarnings.unknownActiveKeys, ...configuration.schemaWarnings.unknownDefaultKeys, ...configuration.schemaWarnings.missingDefaultKeys].join(", ") })}</div>}
    <div className="settings-tools"><div className="settings-groups" role="tablist">{PALWORLD_SETTING_TABS.map((tab, index) => { const title = t(settingGroupKey(tab.id, "title")); const description = t(settingGroupKey(tab.id, "description")); const count = tabChangeCount(tab, changes); const active = !searchTerm && !reviewChanges && index === activeTab; return <button key={tab.id} role="tab" aria-selected={active} title={description} className={active ? "active" : ""} onClick={() => { setActiveTab(index); setSearch(""); setReviewChanges(false); }}>{title}{count > 0 && <span className="change-count">{count}</span>}</button>; })}</div><span className="tool-spacer" /><div className="settings-tools-actions">{!(searchOpen || search) && <button className={`button review-changes ${reviewChanges ? "active" : ""}`} disabled={!changedCount && !reviewChanges} onClick={() => { setSearch(""); setReviewChanges((value) => !value); }}>{reviewChanges ? t("structured.showAll") : t("structured.reviewChanges", { count: changedCount })}</button>}{searchOpen || search ? <input autoFocus className="settings-search" value={search} onChange={(event) => { setSearch(event.target.value); setReviewChanges(false); }} onBlur={() => { if (!search.trim()) setSearchOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") { setSearch(""); setSearchOpen(false); } }} placeholder={t("structured.search")} aria-label={t("structured.searchOpen")} /> : <button type="button" className="icon-button settings-search-toggle" aria-label={t("structured.searchOpen")} title={t("structured.searchOpen")} onClick={() => setSearchOpen(true)}><SearchIcon /></button>}<SettingsMenu {...menu} baseRevision={configuration.desiredRevision} onPreset={applyPreset} /></div></div>
    <div className="structured-notice">{t("structured.changedOnly")}</div>
    {(searchTerm || reviewChanges) && <div className="settings-results-heading"><strong>{reviewChanges ? t("structured.reviewHeading", { count: changedCount }) : t("structured.searchResults")}</strong><span>{reviewChanges ? t("structured.reviewDescription") : t("structured.searchDescription")}</span></div>}
    {tabs.length ? tabs.map((tab) => { const title = t(settingGroupKey(tab.id, "title")); const description = t(settingGroupKey(tab.id, "description")); return <div className="settings-tab-content" key={tab.id}><header className="settings-tab-heading"><h2>{title}<SettingHelp label={t("structured.helpFor", { setting: title })} heading={title} guidance={description} /></h2></header>{tab.sections.map((section) => { const sectionTitle = t(settingGroupKey(section.id, "title")); const sectionDescription = t(settingGroupKey(section.id, "description")); const count = sectionChangeCount(section, changes); return <section className="settings-group" key={section.id}><header><h3>{sectionTitle}<SettingHelp label={t("structured.helpFor", { setting: sectionTitle })} heading={sectionTitle} guidance={sectionDescription} />{count > 0 && <span className="section-change-count">{t("structured.changedCount", { count })}</span>}</h3></header>{section.id === "access-security" && <div className="password-storage-notice">{t("structured.passwordStorageNotice")}</div>}{sectionGrid(section)}</section>; })}</div>; }) : <div className="settings-empty">{t("structured.noResults")}</div>}
    <div className="structured-actions"><span>{changedCount ? t("structured.unsaved", { count: changedCount }) : t("structured.noChanges")}</span><button className="button ghost" disabled={!changedCount || save.isPending} onClick={discard}>{t("structured.discard")}</button><button className="button primary" disabled={!changedCount || save.isPending} onClick={() => save.mutate()}>{t(save.isPending ? "common.saving" : "structured.save")}</button></div>
  </div></Tooltip.Provider>;
}
