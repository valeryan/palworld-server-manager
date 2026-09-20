"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "./app-shell";

type Paths = { dataDirectory: string; database: string; steamCmd: string; logs: string };
export function SettingsPage() {
  const query = useQuery({ queryKey: ["app-settings"], queryFn: async () => { const response = await fetch("/api/settings"); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.settings as Paths; } });
  const [closeToTray, setCloseToTray] = useState(true); const [desktopReady, setDesktopReady] = useState(false); const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { const desktop = window.psmDesktop; void desktop?.getCloseToTray().then((value) => { setDesktopReady(true); setCloseToTray(value); }); }, []);
  async function toggleClose() { const desktop = window.psmDesktop; if (!desktop) return; const value = await desktop.setCloseToTray(!closeToTray); setCloseToTray(value); setNotice(value ? "Closing the window will keep the manager in the tray." : "Closing the window will exit the manager."); }
  return <AppShell active="settings"><header className="topbar"><div><p className="eyebrow">APPLICATION</p><h1>Settings</h1><p className="page-subtitle">Desktop behavior and manager-owned storage.</p></div></header>{notice && <button className="notice" onClick={() => setNotice(null)}>{notice}<span>×</span></button>}<div className="settings-sections"><section><div><h2>Close to system tray</h2><p>Keep the manager and supervised servers operating when the window is closed. Quit fully from the tray menu.</p></div><button className={`toggle ${closeToTray ? "on" : ""}`} disabled={!desktopReady} onClick={() => void toggleClose()}><i />{closeToTray ? "On" : "Off"}</button></section><section className="settings-paths"><div><h2>Manager data</h2><p>The rewrite keeps its database, SteamCMD, logs, and backups separate from the legacy manager.</p></div>{query.data && <dl><div><dt>Data directory</dt><dd>{query.data.dataDirectory}</dd></div><div><dt>Database</dt><dd>{query.data.database}</dd></div><div><dt>SteamCMD</dt><dd>{query.data.steamCmd}</dd></div><div><dt>Logs</dt><dd>{query.data.logs}</dd></div></dl>}<button className="button ghost" disabled={!desktopReady || !query.data} onClick={() => void window.psmDesktop?.openPath(query.data!.dataDirectory)}>Open data folder</button></section></div></AppShell>;
}
