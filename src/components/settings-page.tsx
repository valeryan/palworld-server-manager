"use client";
import { useHostPlatform } from "@/lib/use-platform-label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { LaunchAtLoginOptions } from "../../electron/launch-options";
import { updateChannels, type UpdateChannel } from "@/contracts/application-update";
import type { LanguageCatalog } from "@/contracts/localization";
import { defaultRetentionSettings, type RetentionSettings } from "@/contracts/retention";
import { AppShell } from "./app-shell";
import { RemoteAccessSettings } from "./remote-access-settings";
import { SettingHelp } from "./setting-help";
import { Toast } from "./toast";
import { useTheme } from "./theme-provider";
import { themes } from "@/lib/themes";

type Paths = { dataDirectory: string; database: string; steamCmd: string; logs: string; retention: RetentionSettings; theme: string; updateChannel: UpdateChannel; updateChecksDisabled: "development" | null };
const initialLaunchOptions: LaunchAtLoginOptions = { startHidden: true, disableGpu: false, forceX11: false, customFlags: "" };

async function responseJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init); const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export function SettingsPage() {
  const host = useHostPlatform();
  const { t, i18n } = useTranslation();
  const { theme: activeTheme, setTheme } = useTheme();
  const languageFile = useRef<HTMLInputElement>(null);
  const query = useQuery({ queryKey: ["app-settings"], queryFn: async () => (await responseJson<{ settings: Paths }>("/api/settings")).settings });
  const languages = useQuery({ queryKey: ["languages"], queryFn: async () => (await responseJson<{ catalog: LanguageCatalog }>("/api/i18n/languages")).catalog });
  const [closeToTray, setCloseToTray] = useState(true);
  const [loginDisabledByOS, setLoginDisabledByOS] = useState(false);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [launchOptions, setLaunchOptions] = useState(initialLaunchOptions);
  const [managerPort, setManagerPort] = useState("4318");
  const [activeManagerPort, setActiveManagerPort] = useState(4318);
  const [desktopReady, setDesktopReady] = useState(false);
  const [savingLaunchOptions, setSavingLaunchOptions] = useState(false);
  const [savingPort, setSavingPort] = useState(false);
  const [retentionDraft, setRetentionDraft] = useState<RetentionSettings | null>(null);
  const [savingRetention, setSavingRetention] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [changingLanguage, setChangingLanguage] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false); const client = useQueryClient();
  async function chooseUpdateChannel(updateChannel: UpdateChannel) {
    setSavingChannel(true);
    try { await responseJson("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ updateChannel }) }); await Promise.all([query.refetch(), client.invalidateQueries({ queryKey: ["application-update"] })]); setNotice(t(`settings.updates.savedNotice.${updateChannel}`)); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSavingChannel(false); }
  }
  const [documentLocale, setDocumentLocale] = useState({ code: "en", direction: "ltr" as "ltr" | "rtl" });
  const [notice, setNotice] = useState<string | null>(null);
  const retention = retentionDraft ?? query.data?.retention ?? defaultRetentionSettings;

  useEffect(() => {
    const desktop = window.psmDesktop; if (!desktop) return;
    void desktop.getLoginStatus().then((state) => setLoginDisabledByOS(state.disabledByOS)).catch(() => undefined);
    void Promise.all([desktop.getCloseToTray(), desktop.getLaunchAtLogin(), desktop.getLaunchAtLoginOptions(), desktop.getManagerPort()]).then(([close, launch, options, manager]) => {
      setCloseToTray(close); setLaunchAtLogin(launch); setLaunchOptions(options); setManagerPort(String(manager.configured)); setActiveManagerPort(manager.active); setDesktopReady(true);
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
  async function toggleLaunch() {
    const desktop = window.psmDesktop; if (!desktop) return;
    try {
      let effectiveOptions = launchOptions;
      if (!launchAtLogin) { effectiveOptions = await desktop.setLaunchAtLoginOptions(launchOptions); setLaunchOptions(effectiveOptions); }
      const value = await desktop.setLaunchAtLogin(!launchAtLogin); setLaunchAtLogin(value);
      setNotice(t(value ? effectiveOptions.startHidden ? "settings.launch.enabledHiddenNotice" : "settings.launch.enabledWindowNotice" : "settings.launch.disabledNotice"));
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }
  async function saveLaunchOptions() {
    const desktop = window.psmDesktop; if (!desktop) return; setSavingLaunchOptions(true);
    try { const saved = await desktop.setLaunchAtLoginOptions(launchOptions); setLaunchOptions(saved); setNotice(t(launchAtLogin ? "settings.launch.savedEnabledNotice" : "settings.launch.savedDisabledNotice")); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSavingLaunchOptions(false); }
  }
  async function saveManagerPort() {
    const desktop = window.psmDesktop; if (!desktop) return; setSavingPort(true);
    try { const result = await desktop.setManagerPort(Number(managerPort)); setManagerPort(String(result.configured)); setActiveManagerPort(result.active); setNotice(t(result.restartRequired ? "settings.port.savedRestart" : "settings.port.savedActive", { port: result.configured })); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSavingPort(false); }
  }
  async function saveRetention() {
    setSavingRetention(true);
    try {
      const body = await responseJson<{ settings: RetentionSettings; report: Record<string, number> }>("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ retention }) });
      setRetentionDraft(body.settings); const removed = Object.values(body.report).reduce((total, value) => total + value, 0);
      setNotice(removed ? t("settings.retention.removedNotice", { count: removed }) : t("settings.retention.emptyNotice"));
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSavingRetention(false); }
  }
  async function chooseTheme(theme: Parameters<typeof setTheme>[0]) {
    if (theme === activeTheme) return;
    setSavingTheme(true);
    try { await setTheme(theme); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSavingTheme(false); }
  }
  async function chooseLanguage(code: string) {
    setChangingLanguage(true);
    try {
      const { catalog } = await responseJson<{ catalog: LanguageCatalog }>("/api/i18n/languages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "select", code }) });
      let direction = catalog.languages.find((item) => item.code === code)?.direction ?? "ltr";
      if (!i18n.hasResourceBundle(code, "translation")) {
        const { pack } = await responseJson<{ pack: { meta: { direction: "ltr" | "rtl" }; translations: Record<string, string> } }>(`/api/i18n/languages/${encodeURIComponent(code)}`);
        i18n.addResourceBundle(code, "translation", pack.translations, true, true);
        direction = pack.meta.direction;
      }
      await i18n.changeLanguage(code); setDocumentLocale({ code, direction }); await languages.refetch();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setChangingLanguage(false); }
  }
  async function installLanguage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (file.size > 512 * 1024) { setNotice(t("settings.language.invalidSize")); return; }
    try { await responseJson("/api/i18n/languages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "install", content: await file.text() }) }); await languages.refetch(); setNotice(t("settings.language.installedNotice")); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }
  async function removeLanguage(code: string) {
    try { await responseJson(`/api/i18n/languages?code=${encodeURIComponent(code)}`, { method: "DELETE" }); if (i18n.language === code) await chooseLanguage("en"); else await languages.refetch(); setNotice(t("settings.language.removedNotice")); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
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
      <section className="settings-launch">
        {loginDisabledByOS && <p role="status">Launch at login is configured but disabled in Windows Startup settings.</p>}
        <div className="settings-section-heading"><div><h2>{t("settings.launch.title")}{help("settings.launch.title", "settings.launch.description", "settings.launch.compatibilityHelp")}</h2></div><button className={`toggle ${launchAtLogin ? "on" : ""}`} disabled={!desktopReady} onClick={() => void toggleLaunch()}><i />{t(launchAtLogin ? "common.on" : "common.off")}</button></div>
        <div className="launch-option-grid">
          <label><input type="checkbox" checked={launchOptions.startHidden} onChange={(event) => setLaunchOption("startHidden", event.target.checked)} /><span><strong>{t("settings.launch.hidden")}{help("settings.launch.hidden", "settings.launch.hiddenHelp")}</strong></span></label>
          <label><input type="checkbox" checked={launchOptions.disableGpu} onChange={(event) => setLaunchOption("disableGpu", event.target.checked)} /><span><strong>{t("settings.launch.gpu")}{help("settings.launch.gpu", "settings.launch.gpuHelp")}</strong></span></label>
          {host === "linux" && <label><input type="checkbox" checked={launchOptions.forceX11} onChange={(event) => setLaunchOption("forceX11", event.target.checked)} /><span><strong>{t("settings.launch.x11")}{help("settings.launch.x11", "settings.launch.x11Help")}</strong></span></label>}
        </div>
        <label className="custom-launch-flags"><span><strong>{t("settings.launch.flags")}{help("settings.launch.flags", "settings.launch.flagsHelp")}</strong></span><input value={launchOptions.customFlags} onChange={(event) => setLaunchOption("customFlags", event.target.value)} placeholder={t("settings.launch.flagsPlaceholder")} spellCheck={false} /></label>
        <div className="launch-options-footer"><button className="button primary" disabled={!desktopReady || savingLaunchOptions} onClick={() => void saveLaunchOptions()}>{t(savingLaunchOptions ? "common.saving" : "settings.launch.save")}</button></div>
      </section>
      <section className="settings-network"><div><h2>{t("settings.port.title")}{help("settings.port.title", "settings.port.description")}</h2></div><div className="manager-port-control"><label><span>{t("settings.port.label")}{help("settings.port.label", "settings.port.labelHelp")}</span><input type="number" min={1024} max={65535} step={1} value={managerPort} onChange={(event) => setManagerPort(event.target.value)} /></label><button className="button primary" disabled={!desktopReady || savingPort} onClick={() => void saveManagerPort()}>{t(savingPort ? "common.saving" : "settings.port.save")}</button><small>{t("settings.port.active", { port: activeManagerPort })}{Number(managerPort) !== activeManagerPort ? ` · ${t("settings.port.restartRequired")}` : ""}</small></div></section>
      <RemoteAccessSettings onNotice={setNotice} />
      <section className="settings-retention"><div><h2>{t("settings.retention.title")}{help("settings.retention.title", "settings.retention.description", "settings.retention.help")}</h2></div><div className="retention-grid">
        {(["operationDays", "operationCount", "operationLogLines", "activityDays", "activityCountPerWorld", "serverLogFilesPerWorld", "configurationVersionsPerWorld"] as const).map((key) => { const labels: Record<typeof key, string> = { operationDays: "operationDays", operationCount: "operationCount", operationLogLines: "operationLines", activityDays: "activityDays", activityCountPerWorld: "activityCount", serverLogFilesPerWorld: "logFiles", configurationVersionsPerWorld: "configVersions" }; const limits: Record<typeof key, [number, number]> = { operationDays: [7, 3650], operationCount: [50, 10000], operationLogLines: [100, 20000], activityDays: [30, 3650], activityCountPerWorld: [100, 50000], serverLogFilesPerWorld: [5, 500], configurationVersionsPerWorld: [10, 1000] }; const name = labels[key]; return <label key={key}><span>{t(`settings.retention.${name}`)}{help(`settings.retention.${name}`, `settings.retention.${name}Help`)}</span><input type="number" min={limits[key][0]} max={limits[key][1]} value={retention[key]} onChange={(event) => setRetentionOption(key, event.target.value)} /></label>; })}
      </div><div className="retention-footer"><button className="button primary" disabled={savingRetention || query.isLoading} onClick={() => void saveRetention()}>{t(savingRetention ? "settings.retention.cleaning" : "settings.retention.save")}</button></div></section>
      <section className="settings-language"><div><h2>{t("settings.language.title")}{help("settings.language.title", "settings.language.description", "settings.language.fileHelp")}</h2></div><div className="language-control">
        {languages.data ? <><label><span>{t("settings.language.label")}{help("settings.language.label", "settings.language.labelHelp")}</span><select value={languages.data.active} disabled={changingLanguage} onChange={(event) => void chooseLanguage(event.target.value)}>{languages.data.languages.map((language) => <option key={language.code} value={language.code}>{language.nativeName} ({language.code})</option>)}</select></label><div className="language-list">{languages.data.languages.map((language) => <div key={language.code}><span><strong>{language.nativeName}</strong><small>{language.name} · {t("settings.language.coverage", language)}</small></span>{language.builtIn ? <small>{t("settings.language.builtIn")}</small> : <button className="button danger" onClick={() => void removeLanguage(language.code)}>{t("common.remove")}</button>}</div>)}</div></> : <p>{t("settings.language.loading")}</p>}
        <input ref={languageFile} type="file" accept="application/json,.json" hidden onChange={(event) => void installLanguage(event)} /><div className="language-actions"><button className="button ghost" onClick={() => languageFile.current?.click()}>{t("settings.language.install")}</button><a className="button ghost" href="/api/i18n/template">{t("settings.language.downloadTemplate")}</a><button className="button ghost" disabled={!desktopReady || !languages.data} onClick={() => void window.psmDesktop?.openPath(languages.data!.directory)}>{t("settings.language.openFolder")}</button></div>
      </div></section>
      <section className="settings-updates"><div><h2>{t("settings.updates.title")}{help("settings.updates.title", "settings.updates.description")}</h2></div><div className="language-control">
        {query.data ? <><label><span>{t("settings.updates.channel")}{help("settings.updates.channel", "settings.updates.channelHelp")}</span><select value={query.data.updateChannel} disabled={savingChannel || Boolean(query.data.updateChecksDisabled)} onChange={(event) => void chooseUpdateChannel(event.target.value as UpdateChannel)}>{updateChannels.map((channel) => <option key={channel} value={channel}>{t(`settings.updates.option.${channel}`)}</option>)}</select></label>{query.data.updateChecksDisabled && <p className="muted">{t("settings.updates.development")}</p>}</> : <p>{t("settings.updates.loading")}</p>}
      </div></section>
      <p>{host === "win32" ? "Application updates are manual: quit after operations finish, run the new Setup installer or replace the Portable EXE while retaining PSM-Data, then reopen." : "Application updates are manual: quit after operations finish, download and launch the new AppImage. Keep the previous version until startup succeeds."}</p>
      <section className="settings-paths"><div><h2>{t("settings.data.title")}{help("settings.data.title", "settings.data.description")}</h2></div>{query.data && <dl><div><dt>{t("settings.data.directory")}</dt><dd>{query.data.dataDirectory}</dd></div><div><dt>{t("settings.data.database")}</dt><dd>{query.data.database}</dd></div><div><dt>{t("settings.data.steamcmd")}</dt><dd>{query.data.steamCmd}</dd></div><div><dt>{t("settings.data.logs")}</dt><dd>{query.data.logs}</dd></div></dl>}<button className="button ghost" disabled={!desktopReady || !query.data} onClick={() => void window.psmDesktop?.openPath(query.data!.dataDirectory)}>{t("settings.data.open")}</button></section>
    </div>
  </AppShell></Tooltip.Provider>;
}
