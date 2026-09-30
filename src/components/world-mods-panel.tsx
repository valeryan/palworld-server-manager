"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LuaModView, WorldModsView } from "@/contracts/mod";
import { JobProgress } from "./job-progress";

type Ue4ssAction = "install" | "replace" | "enable" | "disable" | "remove";
async function request<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } }); const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body; }

export function WorldModsPanel({ worldId, running, onNotice }: { worldId: string; running: boolean; onNotice(message: string): void }) {
  const { t } = useTranslation(); const client = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["world-mods", worldId], queryFn: async () => (await request<{ mods: WorldModsView }>(`/api/worlds/${worldId}/mods`)).mods });
  const act = useMutation({
    mutationFn: (action: Ue4ssAction) => request<{ jobId?: string }>(`/api/worlds/${worldId}/mods/ue4ss`, { method: "POST", body: JSON.stringify({ action }) }),
    onSuccess: ({ jobId: started }, action) => { if (started) setJobId(started); else onNotice(t(action === "enable" ? "mods.ue4ss.enabledNotice" : "mods.ue4ss.disabledNotice")); void client.invalidateQueries({ queryKey: ["world-mods", worldId] }); void client.invalidateQueries({ queryKey: ["jobs"] }); },
    onError: (error) => onNotice(error.message),
  });
  const change = useMutation({
    mutationFn: ({ area, body }: { area: "lua" | "workshop" | "relays"; body: Record<string, string> }) => request(`/api/worlds/${worldId}/mods/${area}`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { onNotice(t("mods.changedNotice")); void client.invalidateQueries({ queryKey: ["world-mods", worldId] }); },
    onError: (error) => onNotice(error.message),
  });
  const lua = (body: Record<string, string>) => {
    if (body.action === "remove" && !window.confirm(t("mods.lua.removeConfirm", { name: body.name }))) return;
    if (body.action === "replace" && !window.confirm(t("mods.lua.replaceConfirm"))) return;
    change.mutate({ area: "lua", body });
  };
  const workshop = (body: Record<string, string>) => change.mutate({ area: "workshop", body });
  const relay = (body: Record<string, string>) => {
    if (body.action === "remove" && !window.confirm(t("mods.relays.removeConfirm"))) return;
    if (body.action === "replace" && !window.confirm(t("mods.relays.replaceConfirm"))) return;
    change.mutate({ area: "relays", body });
  };
  const locked = running || act.isPending || change.isPending || jobId !== null;
  const run = (action: Ue4ssAction) => {
    if (action === "remove" && !window.confirm(t("mods.ue4ss.removeConfirm"))) return;
    if (action === "replace" && !window.confirm(t("mods.ue4ss.replaceConfirm"))) return;
    act.mutate(action);
  };
  const mods = query.data;
  return <div>
    <div className="panel-heading"><div><h2>{t("mods.title")}</h2><p>{t("mods.description")}</p></div><button className="button ghost" onClick={() => void query.refetch()}>{t("common.refresh")}</button></div>
    {query.isLoading ? <p className="muted">{t("mods.loading")}</p> : query.error ? <div className="settings-compatibility-warning">{query.error.message}</div> : mods && <>
      <Ue4ssSection status={mods.ue4ss} library={mods.library} locked={running || act.isPending || jobId !== null} running={running} onAction={run}>
        {jobId && <JobProgress jobId={jobId} onFinished={(job) => { setJobId(null); onNotice(job.state === "succeeded" ? job.message : job.error ?? job.message); void client.invalidateQueries({ queryKey: ["world-mods", worldId] }); }} />}
      </Ue4ssSection>
      <RelaySection relays={mods.relays} ue4ss={mods.ue4ss} locked={locked} onAction={relay} />
      <LuaSection mods={mods.luaMods} available={mods.availableLuaMods} ue4ss={mods.ue4ss} locked={locked} onAction={lua} />
      <WorkshopSection workshop={mods.workshop} locked={locked} onAction={workshop} />
      {running && <p className="muted">{t("mods.stopToChange")}</p>}
    </>}
  </div>;
}

function Ue4ssSection({ status, library, locked, running, onAction, children }: { status: WorldModsView["ue4ss"]; library: WorldModsView["library"]; locked: boolean; running: boolean; onAction(action: Ue4ssAction): void; children?: ReactNode }) {
  const { t } = useTranslation();
  const managed = status.managed; const ready = Boolean(library?.downloaded);
  const state = managed ? t(managed.enabled ? "mods.ue4ss.managedEnabled" : "mods.ue4ss.managedDisabled", { version: managed.version }) : t(status.installed ? "mods.ue4ss.unmanaged" : "mods.ue4ss.notInstalled");
  const actions = managed
    ? <>{managed.updateAvailable && ready && <button disabled={locked} onClick={() => onAction("install")}>{t("mods.ue4ss.update", { version: library?.version })}</button>}<button disabled={locked} onClick={() => onAction(managed.enabled ? "disable" : "enable")}>{t(managed.enabled ? "mods.ue4ss.disable" : "mods.ue4ss.enable")}</button><button className="danger" disabled={locked} onClick={() => onAction("remove")}>{t("mods.ue4ss.remove")}</button></>
    : status.installed
      ? ready ? <button disabled={locked} onClick={() => onAction("replace")}>{t("mods.ue4ss.replace")}</button> : <Link className="button ghost" href="/mods">{t("mods.openLibrary")}</Link>
      : ready ? <button disabled={locked || !status.binariesPresent} onClick={() => onAction("install")}>{t("mods.ue4ss.install")}</button> : <Link className="button ghost" href="/mods">{t("mods.openLibrary")}</Link>;
  return <section className="mod-section"><h3>{t("mods.ue4ss.title")}</h3>
    {!status.layoutVerified && <div className="settings-compatibility-warning">{t("mods.ue4ss.linuxExperimental")}</div>}
    {managed?.recoveryPaused && <div className="settings-compatibility-warning">{t("mods.ue4ss.recoveryPaused")}</div>}
    {status.warnings.map((warning) => <div key={warning} className="settings-compatibility-warning">{t(`mods.ue4ss.warning.${warning}`)}</div>)}
    <div className="record-list"><div><span><strong>{state}</strong><small>{t(`mods.variant.${status.variant}`)}</small>
      {status.installed && <small title={status.modsDirectory}>{t("mods.ue4ss.modsDirectory", { path: status.modsDirectory })}</small>}
      {!status.installed && !status.binariesPresent && <small>{t("mods.ue4ss.binariesMissing")}</small>}
      {!managed && library && <small>{t(library.downloaded ? "mods.ue4ss.libraryReady" : "mods.ue4ss.libraryMissing", { name: library.name, version: library.version })}</small>}
      {!managed && status.installed && <small>{t("mods.ue4ss.unmanagedHelp")}</small>}
      {running && <small>{t("mods.ue4ss.stopToChange")}</small>}
      {children}
    </span><span className="backup-actions">{actions}</span></div></div>
  </section>;
}

function RelaySection({ relays, ue4ss, locked, onAction }: { relays: WorldModsView["relays"]; ue4ss: WorldModsView["ue4ss"]; locked: boolean; onAction(body: Record<string, string>): void }) {
  const { t } = useTranslation();
  return <section className="mod-section"><h3>{t("mods.relays.title")}</h3><p className="muted">{t("mods.relays.help")}</p>
    {!ue4ss.managed && <div className="settings-compatibility-warning">{t("mods.relays.needsUe4ss")}</div>}
    <div className="record-list">{relays.map((relay) => {
      const state = !relay.installed ? t("mods.relays.notInstalled") : !relay.managed ? t("mods.relays.unmanaged") : relay.active ? t("mods.relays.active") : relay.enabled ? t("mods.relays.inactive") : t("mods.state.disabled");
      return <div key={relay.id}><span><strong>{t(`mods.relays.name.${relay.id}`)}</strong><small>{t(`mods.relays.purpose.${relay.id}`)}</small><small>{state}{relay.managed && relay.version !== null ? ` · ${t("mods.relays.version", { version: relay.version })}` : ""}{relay.updateAvailable ? ` · ${t("mods.relays.updateAvailable", { version: relay.bundledVersion })}` : ""}</small></span>
        <span className="backup-actions">{!relay.installed ? <button disabled={locked} onClick={() => onAction({ action: "install", relay: relay.id })}>{t("mods.relays.install")}</button>
          : !relay.managed ? <><button disabled={locked} onClick={() => onAction({ action: "replace", relay: relay.id })}>{t("mods.lua.replace")}</button><button className="danger" disabled={locked} onClick={() => onAction({ action: "remove", relay: relay.id })}>{t("mods.lua.remove")}</button></>
          : <>{relay.updateAvailable && <button disabled={locked} onClick={() => onAction({ action: "install", relay: relay.id })}>{t("mods.relays.update")}</button>}<button disabled={locked} onClick={() => onAction({ action: relay.enabled ? "disable" : "enable", relay: relay.id })}>{t(relay.enabled ? "mods.lua.disable" : "mods.lua.enable")}</button><button className="danger" disabled={locked} onClick={() => onAction({ action: "remove", relay: relay.id })}>{t("mods.lua.remove")}</button></>}</span></div>;
    })}</div>
  </section>;
}

function LuaSection({ mods, available, ue4ss, locked, onAction }: { mods: LuaModView[]; available: WorldModsView["availableLuaMods"]; ue4ss: WorldModsView["ue4ss"]; locked: boolean; onAction(body: Record<string, string>): void }) {
  const { t } = useTranslation();
  const managed = mods.filter((mod) => mod.managed); const unmanaged = mods.filter((mod) => !mod.managed);
  const libraryByName = new Map(available.map((entry) => [entry.name, entry]));
  return <section className="mod-section"><h3>{t("mods.lua.title")}</h3>
    {mods.length > 0 && ue4ss.active === false && <div className="settings-compatibility-warning">{t(ue4ss.installed ? "mods.lua.inactiveDisabled" : "mods.lua.inactiveMissing")}</div>}
    {!mods.length && !available.length && <p className="muted">{t(ue4ss.installed ? "mods.lua.empty" : "mods.lua.needsUe4ss")}</p>}
    {managed.length > 0 && <div className="record-list">{managed.map((mod) => <LuaRow key={mod.name} mod={mod}>
      {mod.updateAvailable && mod.artifactId && <button disabled={locked} onClick={() => onAction({ action: "install", artifactId: mod.artifactId! })}>{t("mods.lua.update")}</button>}
      <button disabled={locked} onClick={() => onAction({ action: mod.enabled ? "disable" : "enable", name: mod.name })}>{t(mod.enabled ? "mods.lua.disable" : "mods.lua.enable")}</button>
      <button className="danger" disabled={locked} onClick={() => onAction({ action: "remove", name: mod.name })}>{t("mods.lua.remove")}</button>
    </LuaRow>)}</div>}
    {unmanaged.length > 0 && <><h4>{t("mods.lua.unmanaged")}</h4><p className="muted">{t("mods.lua.unmanagedHelp")}</p><div className="record-list">{unmanaged.map((mod) => <LuaRow key={mod.name} mod={mod}>
      {libraryByName.get(mod.name) && <button disabled={locked} onClick={() => onAction({ action: "replace", artifactId: libraryByName.get(mod.name)!.id })}>{t("mods.lua.replace")}</button>}
      <button className="danger" disabled={locked} onClick={() => onAction({ action: "remove", name: mod.name })}>{t("mods.lua.remove")}</button>
    </LuaRow>)}</div></>}
    {available.filter((entry) => !mods.some((mod) => mod.name === entry.name)).length > 0 && <><h4>{t("mods.lua.available")}</h4><div className="record-list">{available.filter((entry) => !mods.some((mod) => mod.name === entry.name)).map((entry) => <div key={entry.id}><span><strong>{entry.name}</strong><small>{t("mods.lua.availableHelp")}</small></span><span className="backup-actions"><button disabled={locked} onClick={() => onAction({ action: "install", artifactId: entry.id })}>{t("mods.lua.install")}</button></span></div>)}</div></>}
  </section>;
}

function LuaRow({ mod, children }: { mod: LuaModView; children?: ReactNode }) {
  const { t } = useTranslation();
  return <div><span><strong>{mod.name}</strong><small>{t(mod.enabled ? "mods.state.enabled" : "mods.state.disabled")}{mod.enabled && mod.active === false ? ` · ${t("mods.lua.inactive")}` : ""}{mod.updateAvailable ? ` · ${t("mods.lua.updateAvailable")}` : ""}{mod.enabledBy === "enabled-txt" ? ` · ${t("mods.lua.forced")}` : ""}{mod.hasScript ? "" : ` · ${t("mods.lua.noScript")}`}</small></span><span className="backup-actions">{children}</span></div>;
}

function WorkshopSection({ workshop, locked, onAction }: { workshop: WorldModsView["workshop"]; locked: boolean; onAction(body: Record<string, string>): void }) {
  const { t } = useTranslation();
  const editable = workshop.platformSupported;
  return <section className="mod-section"><h3>{t("mods.workshop.title")}</h3>
    {!workshop.platformSupported && <div className="settings-compatibility-warning">{t("mods.workshop.windowsOnly")}</div>}
    {editable ? <div className="record-list"><div><span><strong>{t(workshop.globalEnable ? "mods.workshop.globalOn" : "mods.workshop.globalOff")}</strong><small>{t("mods.workshop.globalHelp")}</small></span><span className="backup-actions"><button disabled={locked} onClick={() => onAction({ action: workshop.globalEnable ? "disable-all" : "enable-all" })}>{t(workshop.globalEnable ? "mods.workshop.turnOff" : "mods.workshop.turnOn")}</button></span></div></div>
      : workshop.settingsExists && <p className="muted">{t(workshop.globalEnable ? "mods.workshop.globalOn" : "mods.workshop.globalOff")}</p>}
    {!workshop.mods.length ? <p className="muted">{t("mods.workshop.empty")}</p> : <div className="record-list">{workshop.mods.map((mod) => <div key={mod.folder}><span><strong>{mod.displayName ?? mod.folder}</strong><small>{mod.error ? t("mods.workshop.invalid", { error: mod.error }) : [mod.version && t("mods.workshop.version", { version: mod.version }), t(mod.active ? "mods.state.enabled" : "mods.state.disabled"), mod.active && !workshop.globalEnable && t("mods.workshop.inactiveGlobal"), !mod.serverCapable && t("mods.workshop.clientOnly")].filter(Boolean).join(" · ")}</small><small>{mod.packageName ?? mod.folder}</small></span>
      {editable && mod.packageName && <span className="backup-actions"><button disabled={locked} onClick={() => onAction({ action: mod.active ? "deactivate" : "activate", packageName: mod.packageName! })}>{t(mod.active ? "mods.lua.disable" : "mods.lua.enable")}</button></span>}</div>)}</div>}
  </section>;
}
