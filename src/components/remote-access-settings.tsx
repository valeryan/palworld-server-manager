"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { remotePermissions } from "@/contracts/remote-access";
import { fetchJson, requestJson } from "@/lib/http-client";
import { useLocaleDateTime } from "@/lib/use-locale-format";
import { useNoticeAction } from "@/lib/use-notice-action";
import { SettingHelp } from "./setting-help";

type Code = { id: string; codeHint: string; label: string; scope: "all" | "world"; worldId: string | null; permissions: string[]; enabled: boolean; createdAt: number; lastUsedAt: number | null };
type Session = { id: string; codeId: string; lastSeenAt: number; expiresAt: number; revokedAt: number | null; ipAddress: string | null; userAgent: string | null };
type Audit = { id: number; principalLabel: string; action: string; worldId: string | null; detail: string | null; ipAddress: string | null; createdAt: number };
type Access = { settings: { enabled: boolean }; codes: Code[]; sessions: Session[]; audit: Audit[] };
type World = { id: string; displayName: string };
type Network = { configuredHost: "127.0.0.1" | "0.0.0.0"; activeHost: "127.0.0.1" | "0.0.0.0"; port: number; addresses: string[] };
const permissionOptions: readonly string[] = remotePermissions;
function request<T>(body?: unknown): Promise<T> { return body === undefined ? fetchJson<T>("/api/remote/access") : requestJson<T>("/api/remote/access", { method: "POST", body: JSON.stringify(body) }); }

export function RemoteAccessSettings({ onNotice }: { onNotice(message: string): void }) {
  const { t } = useTranslation();
  const dateTime = useLocaleDateTime();
  const client = useQueryClient(); const access = useQuery({ queryKey: ["remote-access"], queryFn: () => request<Access>() });
  const worlds = useQuery({ queryKey: ["worlds", "remote-settings"], queryFn: async () => (await fetchJson<{ worlds: World[] }>("/api/worlds")).worlds });
  const [network, setNetwork] = useState<Network | null>(null); const [host, setHost] = useState<"127.0.0.1" | "0.0.0.0">("127.0.0.1"); const [label, setLabel] = useState(""); const [scope, setScope] = useState<"all" | "world">("all"); const [worldId, setWorldId] = useState(""); const [permissions, setPermissions] = useState(["world.view", "world.lifecycle"]); const [revealedCode, setRevealedCode] = useState<string | null>(null);
  // Saving the binding and creating a code share the disabled state; code row actions never disabled anything.
  const { pending: saving, run: runSaving } = useNoticeAction(onNotice); const { run: runCodeAction } = useNoticeAction(onNotice);
  useEffect(() => { const desktop = window.psmDesktop; if (!desktop) return; void desktop.getManagerNetwork().then((value) => { setNetwork(value); setHost(value.configuredHost); }); }, []);
  const enabled = access.data?.settings.enabled ?? false;
  async function saveAccess(nextEnabled = enabled) {
    const desktop = window.psmDesktop; if (!desktop) return onNotice(t("remoteSettings.desktopOnly"));
    await runSaving(async () => {
      if (!nextEnabled) await desktop.setManagerHost("127.0.0.1");
      await request({ action: "set-enabled", enabled: nextEnabled });
      const result = await desktop.setManagerHost(nextEnabled ? host : "127.0.0.1");
      await client.invalidateQueries({ queryKey: ["remote-access"] }); setNetwork((current) => current ? { ...current, configuredHost: result.configuredHost } : current);
      onNotice(result.restartRequired ? t("remoteSettings.savedRestart", { state: t(nextEnabled ? "remoteSettings.saved" : "remoteSettings.disabled") }) : t(nextEnabled ? "remoteSettings.enabledNotice" : "remoteSettings.disabledNotice"));
    });
  }
  async function createCode(event: FormEvent) { event.preventDefault(); await runSaving(async () => { const result = await request<{ code: Code & { code: string } }>({ action: "create-code", value: { label, scope, worldId: scope === "world" ? worldId : null, permissions } }); setRevealedCode(result.code.code); setLabel(""); await client.invalidateQueries({ queryKey: ["remote-access"] }); onNotice(t("remoteSettings.created")); }); }
  async function codeAction(body: unknown, message: string) { await runCodeAction(async () => { await request(body); await client.invalidateQueries({ queryKey: ["remote-access"] }); onNotice(message); }); }
  const restartRequired = network && network.configuredHost !== network.activeHost;
  const help = (labelKey: string, guidanceKey: string) => { const heading = t(labelKey); return <SettingHelp label={t("structured.helpFor", { setting: heading })} heading={heading} guidance={t(guidanceKey)} />; };
  return <section className="settings-remote"><div className="settings-section-heading"><div><h2>{t("remoteSettings.title")}{help("remoteSettings.title", "remoteSettings.description")}</h2></div><button className={`toggle ${enabled ? "on" : ""}`} disabled={saving || access.isLoading} onClick={() => void saveAccess(!enabled)}><i />{t(enabled ? "common.on" : "common.off")}</button></div>
    <div className="remote-network-grid"><label><span>{t("remoteSettings.binding")}{help("remoteSettings.binding", "remoteSettings.bindingHelp")}</span><select disabled={!network} value={host} onChange={(event) => setHost(event.target.value as typeof host)}><option value="127.0.0.1">{t("remoteSettings.localOnly")}</option><option value="0.0.0.0">{t("remoteSettings.lan")}</option></select></label><div><strong>{t("remoteSettings.address")}{help("remoteSettings.address", "remoteSettings.addressHelp")}</strong><small>{host === "0.0.0.0" && network?.addresses.length ? network.addresses.map((address) => `http://${address}:${network.port}/remote`).join(" · ") : `http://127.0.0.1:${network?.port ?? 4318}/remote`}</small></div><button className="button" disabled={!enabled || saving || !network} onClick={() => void saveAccess(true)}>{t("remoteSettings.saveBinding")}</button></div>
    {restartRequired && <p className="remote-warning">{t("remoteSettings.restartRequired", { target: t(network.activeHost === "0.0.0.0" ? "remoteSettings.targetLan" : "remoteSettings.targetLocal") })}</p>}
    <div className="remote-management-grid"><form className="remote-code-form" onSubmit={createCode}><h3>{t("remoteSettings.create")}{help("remoteSettings.create", "remoteSettings.createHelp")}</h3><label><span>{t("remoteSettings.person")}{help("remoteSettings.person", "remoteSettings.personHelp")}</span><input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder={t("remoteSettings.personPlaceholder")} /></label><label><span>{t("remoteSettings.worldAccess")}{help("remoteSettings.worldAccess", "remoteSettings.worldAccessHelp")}</span><select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="all">{t("remoteSettings.allWorlds")}</option><option value="world">{t("remoteSettings.oneWorld")}</option></select></label>{scope === "world" && <label>{t("remoteSettings.world")}<select required value={worldId} onChange={(event) => setWorldId(event.target.value)}><option value="">{t("remoteSettings.selectWorld")}</option>{worlds.data?.map((world) => <option value={world.id} key={world.id}>{world.displayName}</option>)}</select></label>}<fieldset><legend>{t("remoteSettings.permissions")}{help("remoteSettings.permissions", "remoteSettings.permissionsHelp")}</legend>{permissionOptions.map((permission) => <label key={permission}><input type="checkbox" checked={permissions.includes(permission)} onChange={(event) => setPermissions((current) => event.target.checked ? [...current, permission] : current.filter((id) => id !== permission))} />{t(`remoteSettings.permission.${permission.split(".")[1]}`)}</label>)}</fieldset><button className="button primary" disabled={!enabled || saving || !label.trim() || !permissions.length}>{t("remoteSettings.createButton")}</button>{revealedCode && <div className="revealed-code"><small>{t("remoteSettings.copyNow")}</small><strong>{revealedCode}</strong><button type="button" onClick={() => void navigator.clipboard.writeText(revealedCode)}>{t("common.copy")}</button></div>}</form>
      <div className="remote-code-list"><h3>{t("remoteSettings.codes")}{help("remoteSettings.codes", "remoteSettings.codesHelp")}</h3>{access.data?.codes.map((code) => { const active = access.data.sessions.filter((session) => session.codeId === code.id && !session.revokedAt && session.expiresAt > Date.now()).length; const scopeLabel = code.scope === "all" ? t("remoteSettings.allWorlds").toLocaleLowerCase() : worlds.data?.find((world) => world.id === code.worldId)?.displayName ?? t("remoteSettings.oneWorld").toLocaleLowerCase(); return <article key={code.id}><div><strong>{code.label}</strong><small>{t("remoteSettings.codeSummary", { hint: code.codeHint, scope: scopeLabel, count: active })}</small></div><div><button onClick={() => void codeAction({ action: "update-code", id: code.id, value: { enabled: !code.enabled } }, t(code.enabled ? "remoteSettings.codeDisabled" : "remoteSettings.codeEnabled"))}>{t(code.enabled ? "common.disable" : "common.enable")}</button><button onClick={() => void codeAction({ action: "revoke-sessions", codeId: code.id }, t("remoteSettings.sessionsRevoked"))}>{t("remoteSettings.signOut")}</button><button className="danger" onClick={() => window.confirm(t("remoteSettings.deleteConfirm", { name: code.label })) && void codeAction({ action: "delete-code", id: code.id }, t("remoteSettings.codeDeleted"))}>{t("common.delete")}</button></div></article>; })}{!access.data?.codes.length && <p className="muted">{t("remoteSettings.noCodes")}</p>}</div></div>
    <details className="remote-audit"><summary>{t("remoteSettings.activity", { count: access.data?.audit.length ?? 0 })}</summary><div className="record-list">{access.data?.audit.map((entry) => <div key={entry.id}><span><strong>{entry.principalLabel} · {entry.action}</strong><small>{entry.detail ?? entry.worldId ?? t("remoteSettings.event")} · {dateTime(entry.createdAt)} · {entry.ipAddress ?? t("remoteSettings.unknownAddress")}</small></span></div>)}</div></details>
  </section>;
}
