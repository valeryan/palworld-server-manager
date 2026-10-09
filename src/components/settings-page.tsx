"use client";
import { fetchJson as responseJson, requestJson } from "@/lib/http-client";
import { useHostPlatform } from "@/lib/use-platform-label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { defaultLaunchAtLoginOptions, type LaunchAtLoginOptions } from "../../electron/launch-options";
import { updateChannels, type UpdateChannel } from "@/contracts/application-update";
import type { LanguageCatalog } from "@/contracts/localization";
import { defaultRetentionSettings, retentionLimits, retentionSettingKeys, type RetentionSettingKey, type RetentionSettings } from "@/contracts/retention";
import { AppShell } from "./app-shell";
import { ServerBuildsSettings } from "./server-builds-settings";
import { SettingHelp } from "./setting-help";
import { Toast } from "./toast";
import { useTheme } from "./theme-provider";
import { themes } from "@/lib/themes";
import { useNoticeAction } from "@/lib/use-notice-action";

type Paths = { dataDirectory: string; database: string; steamCmd: string; logs: string; retention: RetentionSettings; theme: string; updateChannel: UpdateChannel; updateChecksDisabled: "development" | null };
const retentionLabels: Record<RetentionSettingKey, string> = { operationDays: "operationDays", operationCount: "operationCount", operationLogLines: "operationLines", activityDays: "activityDays", activityCountPerWorld: "activityCount", serverLogFilesPerWorld: "logFiles", configurationVersionsPerWorld: "configVersions" };

export function SettingsPage() {
  const host = useHostPlatform();
  const { t, i18n } = useTranslation();
  const { theme: activeTheme, setTheme } = useTheme();
  const languageFile = useRef<HTMLInputElement>(null);
  const query = useQuery({ queryKey: ["app-settings"], queryFn: async () => (await responseJson<{ settings: Paths }>("/api/settings")).settings });
  const languages = useQuery({ queryKey: ["languages"], queryFn: async () => (await responseJson<{ catalog: LanguageCatalog }>("/api/i18n/languages")).catalog });
  const [closeToTray, setCloseToTray] = useState(true); const [startMinimized, setStartMinimized] = useState(false);
  const [loginDisabledByOS, setLoginDisabledByOS] = useState(false); const [loginUnavailable, setLoginUnavailable] = useState(false);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [launchOptions, setLaunchOptions] = useState<LaunchAtLoginOptions>(defaultLaunchAtLoginOptions);
  const [desktopReady, setDesktopReady] = useState(false);
  const [retentionDraft, setRetentionDraft] = useState<RetentionSettings | null>(null);
  const [documentLocale, setDocumentLocale] = useState({ code: "en", direction: "ltr" as "ltr" | "rtl" });
  const [notice, setNotice] = useState<string | null>(null); const client = useQueryClient();
  // One pending flag per control group; `notify` covers actions that never disabled anything.
  const notify = useNoticeAction(setNotice); const launchSave = useNoticeAction(setNotice); const retentionSave = useNoticeAction(setNotice); const themeSave = useNoticeAction(setNotice); const languageChange = useNoticeAction(setNotice); const channelSave = useNoticeAction(setNotice);
  const savingLaunchOptions = launchSave.pending; const savingRetention = retentionSave.pending; const savingTheme = themeSave.pending; const changingLanguage = languageChange.pending; const savingChannel = channelSave.pending;
  async function chooseUpdateChannel(updateChannel: UpdateChannel) {
    await channelSave.run(async () => { await requestJson("/api/settings", { method: "PATCH", body: JSON.stringify({ updateChannel }) }); await Promise.all([query.refetch(), client.invalidateQueries({ queryKey: ["application-update"] })]); setNotice(t(`settings.updates.savedNotice.${updateChannel}`)); });
  }
  const retention = retentionDraft ?? query.data?.retention ?? defaultRetentionSettings;

  useEffect(() => {
    const desktop = window.psmDesktop; if (!desktop) return;
    void desktop.getLoginStatus().then((state) => { setLoginDisabledByOS(state.disabledByOS); setLoginUnavailable(Boolean(state.unavailable)); }).catch(() => undefined);
    void Promise.all([desktop.getCloseToTray(), desktop.getStartMinimized(), desktop.getLaunchAtLogin(), desktop.getLaunchAtLoginOptions()]).then(([close, minimized, launch, options]) => {
      setCloseToTray(close); setStartMinimized(minimized); setLaunchAtLogin(launch); setLaunchOptions(options); setDesktopReady(true);
    });
  }, []);
  useEffect(() => {
    document.documentElement.lang = documentLocale.code;
    document.documentElement.dir = documentLocale.direction;
  }, [documentLocale]);

  async function toggleClose() {
    const desktop = window.psmDesktop; if (!desktop) return;
    const value = await desktop.setCloseToTray(!closeToTray); setCloseToTray(value);
    setNotice(t(value ? "settings.tray.enabledNotice" : "settings.tray.disabledNotice"));
  }
  async function toggleStartMinimized() {
    const desktop = window.psmDesktop; if (!desktop) return;
    const value = await desktop.setStartMinimized(!startMinimized); setStartMinimized(value);
    setNotice(t(value ? "settings.startMinimized.enabledNotice" : "settings.startMinimized.disabledNotice"));
  }
  async function toggleLaunch() {
    const desktop = window.psmDesktop; if (!desktop) return;
    await notify.run(async () => {
      if (!launchAtLogin) setLaunchOptions(await desktop.setLaunchAtLoginOptions(launchOptions));
      const value = await desktop.setLaunchAtLogin(!launchAtLogin); setLaunchAtLogin(value);
      setNotice(t(value ? startMinimized ? "settings.launch.enabledHiddenNotice" : "settings.launch.enabledWindowNotice" : "settings.launch.disabledNotice"));
    });
  }
  async function saveLaunchOptions() {
    const desktop = window.psmDesktop; if (!desktop) return;
    await launchSave.run(async () => { const saved = await desktop.setLaunchAtLoginOptions(launchOptions); setLaunchOptions(saved); setNotice(t(launchAtLogin ? "settings.launch.savedEnabledNotice" : "settings.launch.savedDisabledNotice")); });
  }
  async function saveRetention() {
    await retentionSave.run(async () => {
      const body = await requestJson<{ settings: { retention: RetentionSettings }; report: Record<string, number> }>("/api/settings", { method: "PATCH", body: JSON.stringify({ retention }) });
      setRetentionDraft(body.settings.retention); const removed = Object.values(body.report).reduce((total, value) => total + value, 0);
      setNotice(removed ? t("settings.retention.removedNotice", { count: removed }) : t("settings.retention.emptyNotice"));
    });
  }
  async function chooseTheme(theme: Parameters<typeof setTheme>[0]) {
    if (theme === activeTheme) return;
    await themeSave.run(() => setTheme(theme));
  }
  async function chooseLanguage(code: string) {
    await languageChange.run(async () => {
      const { catalog } = await requestJson<{ catalog: LanguageCatalog }>("/api/i18n/languages", { method: "POST", body: JSON.stringify({ action: "select", code }) });
      let direction = catalog.languages.find((item) => item.code === code)?.direction ?? "ltr";
      if (!i18n.hasResourceBundle(code, "translation")) {
        const { pack } = await responseJson<{ pack: { meta: { direction: "ltr" | "rtl" }; translations: Record<string, string> } }>(`/api/i18n/languages/${encodeURIComponent(code)}`);
        i18n.addResourceBundle(code, "translation", pack.translations, true, true);
        direction = pack.meta.direction;
      }
      await i18n.changeLanguage(code); setDocumentLocale({ code, direction }); await languages.refetch();
    });
  }
  async function installLanguage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (file.size > 512 * 1024) { setNotice(t("settings.language.invalidSize")); return; }
    await notify.run(async () => { await requestJson("/api/i18n/languages", { method: "POST", body: JSON.stringify({ action: "install", content: await file.text() }) }); await languages.refetch(); setNotice(t("settings.language.installedNotice")); });
  }
  async function removeLanguage(code: string) {
    await notify.run(async () => { await responseJson(`/api/i18n/languages?code=${encodeURIComponent(code)}`, { method: "DELETE" }); if (i18n.language === code) await chooseLanguage("en"); else await languages.refetch(); setNotice(t("settings.language.removedNotice")); });
  }

  const setLaunchOption = <Key extends keyof LaunchAtLoginOptions>(key: Key, value: LaunchAtLoginOptions[Key]) => setLaunchOptions((current) => ({ ...current, [key]: value }));
  const setRetentionOption = (key: keyof RetentionSettings, value: string) => setRetentionDraft((current) => ({ ...(current ?? query.data?.retention ?? defaultRetentionSettings), [key]: Number(value) }));
  const help = (labelKey: string, guidanceKey: string, extraGuidanceKey?: string) => { const heading = t(labelKey); const guidance = `${t(guidanceKey)}${extraGuidanceKey ? ` ${t(extraGuidanceKey)}` : ""}`; return <SettingHelp label={t("structured.helpFor", { setting: heading })} heading={heading} guidance={guidance} />; };

  return <Tooltip.Provider delayDuration={250}><AppShell active="settings">
    <header className="topbar"><div><p className="eyebrow">{t("settings.eyebrow")}</p><h1>{t("settings.title")}</h1><p className="page-subtitle">{t("settings.subtitle")}</p></div></header>
    <Toast message={notice} onDismiss={() => setNotice(null)} />
    <div className="settings-sections">
      <section className="settings-appearance">
        <div><h2>{t("settings.appearance.title")}{help("settings.appearance.title", "settings.appearance.description")}</h2></div>
        <div className="theme-picker" role="radiogroup" aria-label={t("settings.appearance.label")}>{themes.map((theme) => <button key={theme.id} type="button" role="radio" aria-checked={activeTheme === theme.id} className={activeTheme === theme.id ? "active" : ""} disabled={savingTheme} onClick={() => void chooseTheme(theme.id)} style={{ "--swatch": theme.palette.accent } as CSSProperties}><Image src={theme.image} alt="" width={512} height={512} sizes="72px" priority={theme.id === "pal"} /><span><strong>{theme.name}</strong><small>{t(activeTheme === theme.id ? "settings.appearance.selected" : "settings.appearance.select")}</small></span></button>)}</div>
      </section>
      <section><div><h2>{t("settings.tray.title")}{help("settings.tray.title", "settings.tray.description")}</h2></div><button className={`toggle ${closeToTray ? "on" : ""}`} disabled={!desktopReady} onClick={() => void toggleClose()}><i />{t(closeToTray ? "common.on" : "common.off")}</button></section>
      <section><div><h2>{t("settings.startMinimized.title")}{help("settings.startMinimized.title", "settings.startMinimized.description")}</h2></div><button className={`toggle ${startMinimized ? "on" : ""}`} disabled={!desktopReady} onClick={() => void toggleStartMinimized()}><i />{t(startMinimized ? "common.on" : "common.off")}</button></section>
      <section className="settings-launch">
        {loginDisabledByOS && <p role="status">{t("settings.launch.disabledByOS")}</p>}
        {loginUnavailable && <p role="status">{t("settings.launch.development")}</p>}
        <div className="settings-section-heading"><div><h2>{t("settings.launch.title")}{help("settings.launch.title", "settings.launch.description", "settings.launch.compatibilityHelp")}</h2></div><button className={`toggle ${launchAtLogin ? "on" : ""}`} disabled={!desktopReady || loginUnavailable} onClick={() => void toggleLaunch()}><i />{t(launchAtLogin ? "common.on" : "common.off")}</button></div>
        <div className="launch-option-grid">
          <label><input type="checkbox" checked={launchOptions.disableGpu} onChange={(event) => setLaunchOption("disableGpu", event.target.checked)} /><span><strong>{t("settings.launch.gpu")}{help("settings.launch.gpu", "settings.launch.gpuHelp")}</strong></span></label>
          {host === "linux" && <label><input type="checkbox" checked={launchOptions.forceX11} onChange={(event) => setLaunchOption("forceX11", event.target.checked)} /><span><strong>{t("settings.launch.x11")}{help("settings.launch.x11", "settings.launch.x11Help")}</strong></span></label>}
        </div>
        <label className="custom-launch-flags"><span><strong>{t("settings.launch.flags")}{help("settings.launch.flags", "settings.launch.flagsHelp")}</strong></span><input value={launchOptions.customFlags} onChange={(event) => setLaunchOption("customFlags", event.target.value)} placeholder={t("settings.launch.flagsPlaceholder")} spellCheck={false} /></label>
        <div className="launch-options-footer"><button className="button primary" disabled={!desktopReady || loginUnavailable || savingLaunchOptions} onClick={() => void saveLaunchOptions()}>{t(savingLaunchOptions ? "common.saving" : "settings.launch.save")}</button></div>
      </section>
      <section className="settings-retention"><div><h2>{t("settings.retention.title")}{help("settings.retention.title", "settings.retention.description", "settings.retention.help")}</h2></div><div className="retention-grid">
        {retentionSettingKeys.map((key) => { const name = retentionLabels[key]; const [min, max] = retentionLimits[key]; return <label key={key}><span>{t(`settings.retention.${name}`)}{help(`settings.retention.${name}`, `settings.retention.${name}Help`)}</span><input type="number" min={min} max={max} value={retention[key]} onChange={(event) => setRetentionOption(key, event.target.value)} /></label>; })}
      </div><div className="retention-footer"><button className="button primary" disabled={savingRetention || query.isLoading} onClick={() => void saveRetention()}>{t(savingRetention ? "settings.retention.cleaning" : "settings.retention.save")}</button></div></section>
      <section className="settings-language"><div><h2>{t("settings.language.title")}{help("settings.language.title", "settings.language.description", "settings.language.fileHelp")}</h2></div><div className="language-control">
        {languages.data ? <><label><span>{t("settings.language.label")}{help("settings.language.label", "settings.language.labelHelp")}</span><select value={languages.data.active} disabled={changingLanguage} onChange={(event) => void chooseLanguage(event.target.value)}>{languages.data.languages.map((language) => <option key={language.code} value={language.code}>{language.nativeName} ({language.code})</option>)}</select></label><div className="language-list">{languages.data.languages.map((language) => <div key={language.code}><span><strong>{language.nativeName}</strong><small>{language.name} · {t("settings.language.coverage", language)}</small></span>{language.builtIn ? <small>{t("settings.language.builtIn")}</small> : <button className="button danger" onClick={() => void removeLanguage(language.code)}>{t("common.remove")}</button>}</div>)}</div></> : <p>{t("settings.language.loading")}</p>}
        <input ref={languageFile} type="file" accept="application/json,.json" hidden onChange={(event) => void installLanguage(event)} /><div className="language-actions"><button className="button ghost" onClick={() => languageFile.current?.click()}>{t("settings.language.install")}</button><a className="button ghost" href="/api/i18n/template">{t("settings.language.downloadTemplate")}</a><button className="button ghost" disabled={!desktopReady || !languages.data} onClick={() => void window.psmDesktop?.openPath(languages.data!.directory)}>{t("settings.language.openFolder")}</button></div>
      </div></section>
      <section className="settings-updates"><div><h2>{t("settings.updates.title")}{help("settings.updates.title", "settings.updates.description")}</h2></div><div className="language-control">
        {query.data ? <><label><span>{t("settings.updates.channel")}{help("settings.updates.channel", "settings.updates.channelHelp")}</span><select value={query.data.updateChannel} disabled={savingChannel} onChange={(event) => void chooseUpdateChannel(event.target.value as UpdateChannel)}>{updateChannels.map((channel) => <option key={channel} value={channel}>{t(`settings.updates.option.${channel}`)}</option>)}</select></label>{query.data.updateChecksDisabled && <p className="muted">{t("settings.updates.development")}</p>}</> : <p>{t("settings.updates.loading")}</p>}
        <p className="muted">{t(host === "win32" ? "settings.updates.manualWindows" : "settings.updates.manualLinux")}</p>
      </div></section>
      <ServerBuildsSettings onNotice={setNotice} />
      <section className="settings-paths"><div><h2>{t("settings.data.title")}{help("settings.data.title", "settings.data.description")}</h2></div>{query.data && <dl><div><dt>{t("settings.data.directory")}</dt><dd>{query.data.dataDirectory}</dd></div><div><dt>{t("settings.data.database")}</dt><dd>{query.data.database}</dd></div><div><dt>{t("settings.data.steamcmd")}</dt><dd>{query.data.steamCmd}</dd></div><div><dt>{t("settings.data.logs")}</dt><dd>{query.data.logs}</dd></div></dl>}<button className="button ghost" disabled={!desktopReady || !query.data} onClick={() => void window.psmDesktop?.openPath(query.data!.dataDirectory)}>{t("settings.data.open")}</button></section>
    </div>
  </AppShell></Tooltip.Provider>;
}
