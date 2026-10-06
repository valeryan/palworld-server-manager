"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { PALWORLD_SETTING_FIELD_MAP, PALWORLD_SETTING_TABS, settingLayoutSpan, settingPresentation } from "@/contracts/palworld-settings";
import { errorMessage } from "@/lib/errors";
import { settingGroupKey } from "@/lib/localization-resources";
import { usePlatformLabel, useHostPlatform } from "@/lib/use-platform-label";
import { SettingHelp } from "../setting-help";
import { ManagerField, RegistrationActions } from "./manager-field";
import { SettingControl } from "./setting-control";
import { exportConfiguration, fetchAdministration, fetchRegistration, importConfiguration, MAX_IMPORT_ARCHIVE_BYTES, reconcileConfiguration, registrationFileName, saveAdministration, saveRegistrationFile, settingsQueryKeys, unregisterWorld } from "./settings-io";
import { presets, type AdminConfiguration, type ManagerKey, type Structured } from "./types";
import { managedChanges, useManagerDraft } from "./use-manager-draft";
import { useSettingsDraft } from "./use-settings-draft";
import { sectionChangeCount, tabChangeCount, visibleTabs, type VisibleSection } from "./visible-tabs";

// The guided settings page: game options and PSM-owned settings edited together and saved as one
// revision. `use-settings-draft` and `use-manager-draft` hold the two drafts, `visible-tabs` the
// search/review filtering, `setting-control` and `manager-field` render one field each, and
// `settings-io` talks to the server.

export function StructuredSettings({ worldId, onNotice }: { worldId: string; onNotice(message: string): void }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["configuration-options", worldId], queryFn: () => fetchAdministration(worldId) });
  if (query.isLoading) return <p className="muted">{t("structured.loading")}</p>;
  if (query.error || !query.data) return <p className="error-text">{query.error?.message ?? t("structured.unavailable")}</p>;
  // Remount (discarding drafts) only when a new settings revision loads, not when status-only fields refresh.
  return <StructuredForm key={`${worldId}:${query.data.configuration.desiredRevision}:${query.data.configuration.appliedRevision}`} worldId={worldId} configuration={query.data.configuration} admin={query.data.admin} appliedAdmin={query.data.appliedAdmin} onNotice={onNotice} />;
}

function StructuredForm({ worldId, configuration, admin, appliedAdmin, onNotice }: { worldId: string; configuration: Structured; admin: AdminConfiguration; appliedAdmin: AdminConfiguration; onNotice(message: string): void }) {
  const { t } = useTranslation(); const platformLabel = usePlatformLabel(); const host = useHostPlatform();
  const router = useRouter();
  const client = useQueryClient();
  const importInput = useRef<HTMLInputElement>(null);
  const settings = useSettingsDraft(configuration);
  const activeServerName = settings.activeStates.ServerName?.status === "valid" && typeof settings.activeStates.ServerName.value === "string" ? settings.activeStates.ServerName.value : undefined;
  const managerDraft = useManagerDraft(admin, activeServerName);
  const { manager, setManagerValue, changedKeys: managerChangedKeys } = managerDraft;
  const [activeTab, setActiveTab] = useState(0);
  const [search, setSearch] = useState("");
  const [reviewChanges, setReviewChanges] = useState(false);
  const [managementPending, setManagementPending] = useState(false);
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
  async function importArchive(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (file.size > MAX_IMPORT_ARCHIVE_BYTES) { onNotice(t("structured.archiveTooLarge")); return; }
    await importConfiguration(worldId, file, configuration.desiredRevision); onNotice(t("structured.imported")); void invalidate();
  }
  async function chooseDirectory() { const selected = await window.psmDesktop?.pickDirectory(); if (selected) setManagerValue("installDir", selected); }
  async function reconcile(action: "import-file" | "reapply-desired") { await reconcileConfiguration(worldId, action); onNotice(t(action === "import-file" ? "structured.reconcile.imported" : "structured.reconcile.reapplied")); await invalidate(); }
  async function exportRegistration() {
    setManagementPending(true);
    try {
      const fileName = registrationFileName(manager.displayName.trim() || stagedServerName || admin.displayName);
      const saved = await saveRegistrationFile(fileName, await fetchRegistration(worldId));
      onNotice(saved ? t("properties.exported", { path: saved }) : t("properties.exportCancelled"));
    } catch (error) { onNotice(errorMessage(error)); } finally { setManagementPending(false); }
  }
  async function unregister() {
    if (!window.confirm(t("properties.unregisterConfirm", { world: admin.displayName }))) return;
    setManagementPending(true);
    try { await unregisterWorld(worldId); router.push("/"); }
    catch (error) { onNotice(errorMessage(error)); setManagementPending(false); }
  }
  function discard() { settings.discard(); managerDraft.discard(); setReviewChanges(false); }

  function sectionGrid(section: VisibleSection) {
    const fields = new Map(section.fields.map((field) => [field.key, field]));
    const managerVisible = (key: string) => section.showManaged && (!reviewChanges || key === "registrationActions" || managerChangedKeys.has(key as ManagerKey));
    const layout = section.layout ?? section.fields.map((field) => { const presentation = settingPresentation(field); return { keys: [field.key], span: settingLayoutSpan(presentation), presentation }; });
    const items = layout.flatMap((item) => {
      const keys = item.keys.filter((key) => fields.has(key) || (!PALWORLD_SETTING_FIELD_MAP.has(key) && managerVisible(key)));
      if (!keys.length) return [];
      const presentation = item.presentation ?? (keys.length === 1 && fields.get(keys[0]!) ? settingPresentation(fields.get(keys[0]!)!) : "standard");
      const controls = keys.map((key) => {
        const field = fields.get(key);
        if (field) return <SettingControl key={key} field={field} presentation={presentation} value={settings.staged(key)} activeState={settings.activeStates[key]!} appliedState={settings.appliedStates[key]!} pendingApply={configuration.pendingApply} defaultState={settings.defaultStates[key]!} changed={settings.changedKeys.has(key)} resetScheduled={settings.resetToDefaults.has(key)} onChange={(value) => settings.setValue(key, value)} onReplaceDefault={() => settings.stageDefaultRepair(field)} onRevert={() => settings.revertField(key)} />;
        if (key === "registrationActions") return <div className="manager-control" key={key}><RegistrationActions pending={managementPending} worldRunning={worldRunning} onExport={() => void exportRegistration()} onUnregister={() => void unregister()} /></div>;
        return <div className="manager-control" key={key}><ManagerField fieldKey={key as ManagerKey} manager={manager} admin={admin} appliedAdmin={appliedAdmin} pendingApply={configuration.pendingApply} changed={managerChangedKeys.has(key as ManagerKey)} stagedServerName={stagedServerName} host={host} platformLabel={platformLabel} onChange={setManagerValue} onChooseDirectory={() => void chooseDirectory()} /></div>;
      });
      return [<div className={`structured-layout-item span-${item.span} ${presentation} ${"grouped" in item && item.grouped && keys.length > 1 ? "service-block" : ""} ${keys[0] === "registrationActions" ? "registration-item" : ""}`} key={item.keys.join("+")}>{controls}</div>];
    });
    return <>{items.length > 0 && <div className="structured-grid">{items}</div>}</>;
  }

  return <Tooltip.Provider delayDuration={250}><div>
    {configuration.pendingApply && <div className="restart-required">{configuration.drift ? (configuration.driftReason ?? t("structured.driftDefault")) : configuration.applyError ? t("structured.pendingApplyError", { error: configuration.applyError }) : t("structured.restartRequired")}{!worldRunning && (configuration.drift || configuration.applyError) && <span className="management-actions"><button className="button ghost" onClick={() => void reconcile("reapply-desired").catch((error) => onNotice(error.message))}>{t("structured.reconcile.reapply")}</button>{configuration.drift && <button className="button ghost" onClick={() => void reconcile("import-file").catch((error) => onNotice(error.message))}>{t("structured.reconcile.importFile")}</button>}</span>}</div>}
    {!configuration.shippedDefaults.available && <div className="settings-compatibility-warning">{t("structured.templateUnavailable")}</div>}
    {(configuration.schemaWarnings.unknownActiveKeys.length > 0 || configuration.schemaWarnings.unknownDefaultKeys.length > 0 || configuration.schemaWarnings.missingDefaultKeys.length > 0) && <div className="settings-compatibility-warning">{t("structured.schemaWarning", { keys: [...configuration.schemaWarnings.unknownActiveKeys, ...configuration.schemaWarnings.unknownDefaultKeys, ...configuration.schemaWarnings.missingDefaultKeys].join(", ") })}</div>}
    <div className="structured-notice">{t("structured.changedOnly")}</div>
    <div className="settings-tools"><input value={search} onChange={(event) => { setSearch(event.target.value); setReviewChanges(false); }} placeholder={t("structured.search")} /><button className={`button review-changes ${reviewChanges ? "active" : ""}`} disabled={!changedCount && !reviewChanges} onClick={() => { setSearch(""); setReviewChanges((value) => !value); }}>{reviewChanges ? t("structured.showAll") : t("structured.reviewChanges", { count: changedCount })}</button><div className="settings-preset-actions"><span>{t("structured.presets")}</span>{Object.entries(presets).map(([name, preset]) => <button key={name} className="button ghost" onClick={() => applyPreset(name)}>{t(preset.labelKey)}</button>)}</div><span className="tool-spacer" /><div className="settings-file-actions"><button className="button ghost" onClick={() => void exportConfiguration(worldId).catch((error) => onNotice(error.message))}>{t("structured.export")}</button><button className="button ghost" onClick={() => importInput.current?.click()}>{t("structured.import")}</button></div><input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => void importArchive(event).catch((error) => onNotice(error.message))} /></div>
    <div className="settings-groups" role="tablist">{PALWORLD_SETTING_TABS.map((tab, index) => { const title = t(settingGroupKey(tab.id, "title")); const description = t(settingGroupKey(tab.id, "description")); const count = tabChangeCount(tab, changes); const active = !searchTerm && !reviewChanges && index === activeTab; return <button key={tab.id} role="tab" aria-selected={active} title={description} className={active ? "active" : ""} onClick={() => { setActiveTab(index); setSearch(""); setReviewChanges(false); }}>{title}{count > 0 && <span className="change-count">{count}</span>}</button>; })}</div>
    {(searchTerm || reviewChanges) && <div className="settings-results-heading"><strong>{reviewChanges ? t("structured.reviewHeading", { count: changedCount }) : t("structured.searchResults")}</strong><span>{reviewChanges ? t("structured.reviewDescription") : t("structured.searchDescription")}</span></div>}
    {tabs.length ? tabs.map((tab) => { const title = t(settingGroupKey(tab.id, "title")); const description = t(settingGroupKey(tab.id, "description")); return <div className="settings-tab-content" key={tab.id}><header className="settings-tab-heading"><h2>{title}<SettingHelp label={t("structured.helpFor", { setting: title })} heading={title} guidance={description} /></h2></header>{tab.sections.map((section) => { const sectionTitle = t(settingGroupKey(section.id, "title")); const sectionDescription = t(settingGroupKey(section.id, "description")); const count = sectionChangeCount(section, changes); return <section className="settings-group" key={section.id}><header><h3>{sectionTitle}<SettingHelp label={t("structured.helpFor", { setting: sectionTitle })} heading={sectionTitle} guidance={sectionDescription} />{count > 0 && <span className="section-change-count">{t("structured.changedCount", { count })}</span>}</h3></header>{section.id === "access-security" && <div className="password-storage-notice">{t("structured.passwordStorageNotice")}</div>}{sectionGrid(section)}</section>; })}</div>; }) : <div className="settings-empty">{t("structured.noResults")}</div>}
    <div className="structured-actions"><span>{changedCount ? t("structured.unsaved", { count: changedCount }) : t("structured.noChanges")}</span><button className="button ghost" disabled={!changedCount || save.isPending} onClick={discard}>{t("structured.discard")}</button><button className="button primary" disabled={!changedCount || save.isPending} onClick={() => save.mutate()}>{t(save.isPending ? "common.saving" : "structured.save")}</button></div>
  </div></Tooltip.Provider>;
}
