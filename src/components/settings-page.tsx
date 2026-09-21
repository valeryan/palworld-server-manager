"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { LaunchAtLoginOptions } from "../../electron/launch-options";
import { AppShell } from "./app-shell";
import { Toast } from "./toast";

type Paths = { dataDirectory: string; database: string; steamCmd: string; logs: string };
const initialLaunchOptions: LaunchAtLoginOptions = { startHidden: true, disableGpu: false, forceX11: false, customFlags: "" };

export function SettingsPage() {
  const query = useQuery({ queryKey: ["app-settings"], queryFn: async () => { const response = await fetch("/api/settings"); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.settings as Paths; } });
  const [closeToTray, setCloseToTray] = useState(true); const [launchAtLogin, setLaunchAtLogin] = useState(false); const [launchOptions, setLaunchOptions] = useState(initialLaunchOptions); const [desktopReady, setDesktopReady] = useState(false); const [savingLaunchOptions, setSavingLaunchOptions] = useState(false); const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const desktop = window.psmDesktop; if (!desktop) return;
    void Promise.all([desktop.getCloseToTray(), desktop.getLaunchAtLogin(), desktop.getLaunchAtLoginOptions()]).then(([close, launch, options]) => { setCloseToTray(close); setLaunchAtLogin(launch); setLaunchOptions(options); setDesktopReady(true); });
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
  const setLaunchOption = <Key extends keyof LaunchAtLoginOptions>(key: Key, value: LaunchAtLoginOptions[Key]) => setLaunchOptions((current) => ({ ...current, [key]: value }));
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
      <section className="settings-paths"><div><h2>Manager data</h2><p>The rewrite keeps its database, SteamCMD, logs, and backups separate from the legacy manager.</p></div>{query.data && <dl><div><dt>Data directory</dt><dd>{query.data.dataDirectory}</dd></div><div><dt>Database</dt><dd>{query.data.database}</dd></div><div><dt>SteamCMD</dt><dd>{query.data.steamCmd}</dd></div><div><dt>Logs</dt><dd>{query.data.logs}</dd></div></dl>}<button className="button ghost" disabled={!desktopReady || !query.data} onClick={() => void window.psmDesktop?.openPath(query.data!.dataDirectory)}>Open data folder</button></section>
    </div>
  </AppShell>;
}
