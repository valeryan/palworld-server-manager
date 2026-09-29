"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { LuaModView, WorldModsView } from "@/contracts/mod";

async function request<T>(url: string): Promise<T> { const response = await fetch(url); const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body; }

export function WorldModsPanel({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["world-mods", worldId], queryFn: async () => (await request<{ mods: WorldModsView }>(`/api/worlds/${worldId}/mods`)).mods });
  const mods = query.data;
  return <div>
    <div className="panel-heading"><div><h2>{t("mods.title")}</h2><p>{t("mods.description")}</p></div><button className="button ghost" onClick={() => void query.refetch()}>{t("common.refresh")}</button></div>
    {query.isLoading ? <p className="muted">{t("mods.loading")}</p> : query.error ? <div className="settings-compatibility-warning">{query.error.message}</div> : mods && <>
      <Ue4ssSection status={mods.ue4ss} library={mods.library} />
      <LuaSection mods={mods.luaMods} ue4ssInstalled={mods.ue4ss.installed} />
      <WorkshopSection workshop={mods.workshop} />
    </>}
  </div>;
}

function Ue4ssSection({ status, library }: { status: WorldModsView["ue4ss"]; library: WorldModsView["library"] }) {
  const { t } = useTranslation();
  return <section className="mod-section"><h3>{t("mods.ue4ss.title")}</h3>
    {!status.layoutVerified && <div className="settings-compatibility-warning">{t("mods.ue4ss.linuxExperimental")}</div>}
    {status.warnings.map((warning) => <div key={warning} className="settings-compatibility-warning">{t(`mods.ue4ss.warning.${warning}`)}</div>)}
    <div className="record-list"><div><span><strong>{t(status.installed ? "mods.ue4ss.installed" : "mods.ue4ss.notInstalled")}</strong><small>{t(`mods.variant.${status.variant}`)}</small>{status.installed && <small title={status.modsDirectory}>{t("mods.ue4ss.modsDirectory", { path: status.modsDirectory })}</small>}{!status.binariesPresent && <small>{t("mods.ue4ss.binariesMissing")}</small>}{!status.installed && library && <small>{t(library.downloaded ? "mods.ue4ss.libraryReady" : "mods.ue4ss.libraryMissing", { name: library.name, version: library.version })}</small>}</span>{!status.installed && <Link className="button ghost" href="/mods">{t("mods.openLibrary")}</Link>}</div></div>
  </section>;
}

function LuaSection({ mods, ue4ssInstalled }: { mods: LuaModView[]; ue4ssInstalled: boolean }) {
  const { t } = useTranslation();
  const managed = mods.filter((mod) => mod.managed); const unmanaged = mods.filter((mod) => !mod.managed);
  return <section className="mod-section"><h3>{t("mods.lua.title")}</h3>
    {!mods.length ? <p className="muted">{t(ue4ssInstalled ? "mods.lua.empty" : "mods.lua.needsUe4ss")}</p> : <>
      {managed.length > 0 && <div className="record-list">{managed.map((mod) => <LuaRow key={mod.name} mod={mod} />)}</div>}
      {unmanaged.length > 0 && <><h4>{t("mods.lua.unmanaged")}</h4><p className="muted">{t("mods.lua.unmanagedHelp")}</p><div className="record-list">{unmanaged.map((mod) => <LuaRow key={mod.name} mod={mod} />)}</div></>}
    </>}
  </section>;
}

function LuaRow({ mod }: { mod: LuaModView }) {
  const { t } = useTranslation();
  return <div><span><strong>{mod.name}</strong><small>{t(mod.enabled ? "mods.state.enabled" : "mods.state.disabled")}{mod.enabledBy === "enabled-txt" ? ` · ${t("mods.lua.forced")}` : ""}{mod.hasScript ? "" : ` · ${t("mods.lua.noScript")}`}</small></span></div>;
}

function WorkshopSection({ workshop }: { workshop: WorldModsView["workshop"] }) {
  const { t } = useTranslation();
  return <section className="mod-section"><h3>{t("mods.workshop.title")}</h3>
    {!workshop.platformSupported && <div className="settings-compatibility-warning">{t("mods.workshop.windowsOnly")}</div>}
    {workshop.settingsExists && <p className="muted">{t(workshop.globalEnable ? "mods.workshop.globalOn" : "mods.workshop.globalOff")}</p>}
    {!workshop.mods.length ? <p className="muted">{t("mods.workshop.empty")}</p> : <div className="record-list">{workshop.mods.map((mod) => <div key={mod.folder}><span><strong>{mod.displayName ?? mod.folder}</strong><small>{mod.error ? t("mods.workshop.invalid", { error: mod.error }) : [mod.version && t("mods.workshop.version", { version: mod.version }), t(mod.active ? "mods.state.enabled" : "mods.state.disabled"), !mod.serverCapable && t("mods.workshop.clientOnly")].filter(Boolean).join(" · ")}</small><small>{mod.packageName ?? mod.folder}</small></span></div>)}</div>}
  </section>;
}
