"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { LaunchAtLoginOptions } from "../../electron/launch-options";
import { AppShell } from "./app-shell";
import { Toast } from "./toast";
import { defaultRetentionSettings, type RetentionSettings } from "@/contracts/retention";
import { RemoteAccessSettings } from "./remote-access-settings";

type Paths = { dataDirectory: string; database: string; steamCmd: string; logs: string; retention: RetentionSettings };
const initialLaunchOptions: LaunchAtLoginOptions = { startHidden: true, disableGpu: false, forceX11: false, customFlags: "" };

export function SettingsPage() {
  const query = useQuery({ queryKey: ["app-settings"], queryFn: async () => { const response = await fetch("/api/settings"); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.settings as Paths; } });
  const [closeToTray, setCloseToTray] = useState(true); const [launchAtLogin, setLaunchAtLogin] = useState(false); const [launchOptions, setLaunchOptions] = useState(initialLaunchOptions); const [managerPort, setManagerPort] = useState("4318"); const [activeManagerPort, setActiveManagerPort] = useState(4318); const [desktopReady, setDesktopReady] = useState(false); const [savingLaunchOptions, setSavingLaunchOptions] = useState(false); const [savingPort, setSavingPort] = useState(false); const [retentionDraft, setRetentionDraft] = useState<RetentionSettings | null>(null); const [savingRetention, setSavingRetention] = useState(false); const [notice, setNotice] = useState<string | null>(null);
  const retention = retentionDraft ?? query.data?.retention ?? defaultRetentionSettings;
  useEffect(() => {
    const desktop = window.psmDesktop; if (!desktop) return;
    void Promise.all([desktop.getCloseToTray(), desktop.getLaunchAtLogin(), desktop.getLaunchAtLoginOptions(), desktop.getManagerPort()]).then(([close, launch, options, manager]) => { setCloseToTray(close); setLaunchAtLogin(launch); setLaunchOptions(options); setManagerPort(String(manager.configured)); setActiveManagerPort(manager.active); setDesktopReady(true); });
  }, []);
  async function toggleClose() { const desktop = window.psmDesktop; if (!desktop) return; const value = await desktop.setCloseToTray(!closeToTray); setCloseToTray(value); setNotice(value ? "Closing the window will keep the manager in the tray." : "Closing the window will exit the manager."); }
  async function toggleLaunch() {
    const desktop = window.psmDesktop; if (!desktop) return;
    try {
      let effectiveOptions = launchOptions;
      if (!launchAtLogin) { effectiveOptions = await desktop.setLaunchAtLoginOptions(launchOptions); setLaunchOptions(effectiveOptions); }
      const value = await desktop.setLaunchAtLogin(!launchAtLogin); setLaunchAtLogin(value); setNotice(value ? `The manager will start ${effectiveOptions.startHidden ? "hidden in the tray" : "with its window open"} at login.` : "Launch at login disabled.");
    }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }
  async function saveLaunchOptions() {
    const desktop = window.psmDesktop; if (!desktop) return; setSavingLaunchOptions(true);
    try { const saved = await desktop.setLaunchAtLoginOptions(launchOptions); setLaunchOptions(saved); setNotice(launchAtLogin ? "Login launch options saved and the autostart entry was updated." : "Login launch options saved. They will be used if launch at login is enabled."); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSavingLaunchOptions(false); }
  }
  async function saveManagerPort() {
    const desktop = window.psmDesktop; if (!desktop) return; setSavingPort(true);
    try { const result = await desktop.setManagerPort(Number(managerPort)); setManagerPort(String(result.configured)); setActiveManagerPort(result.active); setNotice(result.restartRequired ? `Manager port ${result.configured} saved. Restart the manager to apply it.` : `Manager port ${result.configured} is active.`); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSavingPort(false); }
  }
  async function saveRetention() {
    setSavingRetention(true);
    try {
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ retention }) }); const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
      setRetentionDraft(body.settings); const removed = Object.values(body.report as Record<string, number>).reduce((total, value) => total + value, 0);
      setNotice(removed ? `Retention policy saved. Cleanup removed ${removed} expired record${removed === 1 ? "" : "s"} or log files.` : "Retention policy saved. Nothing currently needs cleanup.");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSavingRetention(false); }
  }
  const setLaunchOption = <Key extends keyof LaunchAtLoginOptions>(key: Key, value: LaunchAtLoginOptions[Key]) => setLaunchOptions((current) => ({ ...current, [key]: value }));
  const setRetentionOption = (key: keyof RetentionSettings, value: string) => setRetentionDraft((current) => ({ ...(current ?? query.data?.retention ?? defaultRetentionSettings), [key]: Number(value) }));
  return <AppShell active="settings">
    <header className="topbar"><div><p className="eyebrow">APPLICATION</p><h1>Settings</h1><p className="page-subtitle">Desktop behavior and manager-owned storage.</p></div></header>
    <Toast message={notice} onDismiss={() => setNotice(null)} />
    <div className="settings-sections">
      <section><div><h2>Close to system tray</h2><p>Keep the manager and supervised servers operating when the window is closed. Quit fully from the tray menu.</p></div><button className={`toggle ${closeToTray ? "on" : ""}`} disabled={!desktopReady} onClick={() => void toggleClose()}><i />{closeToTray ? "On" : "Off"}</button></section>
      <section className="settings-launch">
        <div className="settings-section-heading"><div><h2>Launch at login</h2><p>Start the manager after signing in so worlds with autostart enabled can recover without manually opening the application.</p></div><button className={`toggle ${launchAtLogin ? "on" : ""}`} disabled={!desktopReady} onClick={() => void toggleLaunch()}><i />{launchAtLogin ? "On" : "Off"}</button></div>
        <div className="launch-option-grid">
          <label><input type="checkbox" checked={launchOptions.startHidden} onChange={(event) => setLaunchOption("startHidden", event.target.checked)} /><span><strong>Start hidden in the tray</strong><small>Adds <code>--hidden</code> only to the login launch.</small></span></label>
          <label><input type="checkbox" checked={launchOptions.disableGpu} onChange={(event) => setLaunchOption("disableGpu", event.target.checked)} /><span><strong>Disable GPU acceleration</strong><small>Adds <code>--disable-gpu</code> as a renderer compatibility fallback.</small></span></label>
          <label><input type="checkbox" checked={launchOptions.forceX11} onChange={(event) => setLaunchOption("forceX11", event.target.checked)} /><span><strong>Force the X11 display backend</strong><small>Adds <code>--ozone-platform=x11</code> for remote-desktop or Wayland issues.</small></span></label>
        </div>
        <label className="custom-launch-flags"><span><strong>Additional login launch flags</strong><small>Advanced Electron/Chromium flags, separated by spaces. Quotes are supported. Manager-controlled and remote-debugging flags are rejected.</small></span><input value={launchOptions.customFlags} onChange={(event) => setLaunchOption("customFlags", event.target.value)} placeholder="e.g. --enable-logging=stderr --v=1" spellCheck={false} /></label>
        <div className="launch-options-footer"><p>Linux AppImage shared-memory and sandbox compatibility flags remain automatic. These options affect login launches only; manual launches are unchanged.</p><button className="button primary" disabled={!desktopReady || savingLaunchOptions} onClick={() => void saveLaunchOptions()}>{savingLaunchOptions ? "Saving…" : "Save launch options"}</button></div>
      </section>
      <section className="settings-network"><div><h2>Manager web port</h2><p>The desktop interface and authenticated remote screen share this port. Changing it requires a manager restart.</p></div><div className="manager-port-control"><label>Port<input type="number" min={1024} max={65535} step={1} value={managerPort} onChange={(event) => setManagerPort(event.target.value)} /></label><button className="button primary" disabled={!desktopReady || savingPort} onClick={() => void saveManagerPort()}>{savingPort ? "Saving…" : "Save port"}</button><small>Active port: {activeManagerPort}{Number(managerPort) !== activeManagerPort ? " · restart required" : ""}</small></div></section>
      <RemoteAccessSettings onNotice={setNotice} />
      <section className="settings-retention"><div><h2>History and log retention</h2><p>Keep useful operational records without allowing the manager database and per-launch server logs to grow forever. The age and count limits are both enforced; whichever is reached first applies. Running operations are never removed.</p></div><div className="retention-grid">
        <label>Operation history (days)<input type="number" min={7} max={3650} value={retention.operationDays} onChange={(event) => setRetentionOption("operationDays", event.target.value)} /></label>
        <label>Completed operations<input type="number" min={50} max={10000} value={retention.operationCount} onChange={(event) => setRetentionOption("operationCount", event.target.value)} /></label>
        <label>Output lines per operation<input type="number" min={100} max={20000} value={retention.operationLogLines} onChange={(event) => setRetentionOption("operationLogLines", event.target.value)} /></label>
        <label>World activity (days)<input type="number" min={30} max={3650} value={retention.activityDays} onChange={(event) => setRetentionOption("activityDays", event.target.value)} /></label>
        <label>Records per world/category<input type="number" min={100} max={50000} value={retention.activityCountPerWorld} onChange={(event) => setRetentionOption("activityCountPerWorld", event.target.value)} /></label>
        <label>Server log files per world<input type="number" min={5} max={500} value={retention.serverLogFilesPerWorld} onChange={(event) => setRetentionOption("serverLogFilesPerWorld", event.target.value)} /></label>
        <label>Configuration snapshots per world<input type="number" min={10} max={1000} value={retention.configurationVersionsPerWorld} onChange={(event) => setRetentionOption("configurationVersionsPerWorld", event.target.value)} /></label>
      </div><div className="retention-footer"><small>Saving applies cleanup immediately. Future cleanup runs automatically every six hours.</small><button className="button primary" disabled={savingRetention || query.isLoading} onClick={() => void saveRetention()}>{savingRetention ? "Cleaning up…" : "Save and clean up"}</button></div></section>
      <section className="settings-paths"><div><h2>Manager data</h2><p>The rewrite keeps its database, SteamCMD, logs, and backups separate from the legacy manager.</p></div>{query.data && <dl><div><dt>Data directory</dt><dd>{query.data.dataDirectory}</dd></div><div><dt>Database</dt><dd>{query.data.database}</dd></div><div><dt>SteamCMD</dt><dd>{query.data.steamCmd}</dd></div><div><dt>Logs</dt><dd>{query.data.logs}</dd></div></dl>}<button className="button ghost" disabled={!desktopReady || !query.data} onClick={() => void window.psmDesktop?.openPath(query.data!.dataDirectory)}>Open data folder</button></section>
    </div>
  </AppShell>;
}
