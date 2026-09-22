"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { WorldRegistration, WorldView } from "@/contracts/world";
import { PALWORLD_ADMIN_SETTING_FIELDS } from "@/contracts/palworld-settings";
import { settingFieldKey } from "@/lib/localization-resources";

type SafeWorld = Omit<WorldView, "adminPassword" | "serverPassword" | "env">;
type RegistrationResponse = {
  registration: WorldRegistration;
  credentials: { adminPasswordSet: boolean; serverPasswordSet: boolean };
};
type ConfigurationResponse = { configuration: { content: string; options: Record<string, string> } };
type AdminSettingValue = string | number;

const defaultAdminSettings = Object.fromEntries(PALWORLD_ADMIN_SETTING_FIELDS.map((field) => [field.key, field.default])) as Record<string, AdminSettingValue>;
function decodeAdminSettings(options: Record<string, string>): Record<string, AdminSettingValue> {
  return Object.fromEntries(PALWORLD_ADMIN_SETTING_FIELDS.map((field) => {
    const raw = options[field.key];
    if (raw == null || raw === "") return [field.key, field.default];
    if (field.type === "int" || field.type === "float") return [field.key, Number(raw)];
    if (raw.startsWith('"') && raw.endsWith('"')) { try { return [field.key, JSON.parse(raw)]; } catch { return [field.key, raw.slice(1, -1)]; } }
    return [field.key, raw];
  }));
}

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function registrationFileName(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "world";
  return `${slug}.psm-next.json`;
}

function downloadInBrowser(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}

export function WorldAdminPanel({ world, onSaved, onNotice }: { world: SafeWorld; onSaved(): void; onNotice(message: string): void }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [detailsReady, setDetailsReady] = useState(false);
  const [installDir, setInstallDir] = useState(world.installDir);
  const [environment, setEnvironment] = useState("{}");
  const [credentials, setCredentials] = useState({ adminPasswordSet: false, serverPasswordSet: false });
  const [adminSettings, setAdminSettings] = useState<Record<string, AdminSettingValue>>(defaultAdminSettings);
  const [configurationReady, setConfigurationReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void Promise.all([
      request<RegistrationResponse>(`/api/worlds/${world.id}/registration`),
      request<ConfigurationResponse>(`/api/worlds/${world.id}/configuration/options`),
    ]).then(([result, configuration]) => {
      if (!active) return;
      setEnvironment(JSON.stringify(result.registration.world.env, null, 2));
      setCredentials(result.credentials);
      setAdminSettings(decodeAdminSettings(configuration.configuration.options));
      setConfigurationReady(Boolean(configuration.configuration.content));
      setDetailsReady(true);
    }).catch((error) => onNotice(error instanceof Error ? error.message : String(error)));
    return () => { active = false; };
  }, [world.id, onNotice]);

  async function chooseDirectory() {
    const selected = await window.psmDesktop?.pickDirectory();
    if (selected) setInstallDir(selected);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      const parsedEnvironment: unknown = JSON.parse(environment);
      if (!parsedEnvironment || Array.isArray(parsedEnvironment) || typeof parsedEnvironment !== "object" || Object.values(parsedEnvironment).some((value) => typeof value !== "string")) throw new Error(t("properties.environmentInvalid"));
      const adminPassword = String(data.get("adminPassword") || "");
      const serverPassword = String(data.get("serverPassword") || "");
      const credentialChanges = {
        ...(adminPassword ? { adminPassword } : data.get("clearAdminPassword") === "on" ? { adminPassword: "" } : {}),
        ...(serverPassword ? { serverPassword } : data.get("clearServerPassword") === "on" ? { serverPassword: "" } : {}),
      };
      const result = await request<{ configuration?: { synchronized?: boolean; reason?: string } }>(`/api/worlds/${world.id}`, { method: "PATCH", body: JSON.stringify({
        displayName: data.get("displayName"), installDir, platform: data.get("platform"),
        gamePort: Number(data.get("gamePort")), queryPort: Number(data.get("queryPort")), restApiPort: Number(data.get("restApiPort")), rconPort: Number(data.get("rconPort")),
        restApiEnabled: data.get("restApiEnabled") === "on", rconEnabled: data.get("rconEnabled") === "on", communityServer: data.get("communityServer") === "on",
        autostart: data.get("autostart") === "on", crashGuard: data.get("crashGuard") === "on", legacyPerfFlags: data.get("legacyPerfFlags") === "on",
        extraArgs: data.get("extraArgs"), env: parsedEnvironment, wineBinary: data.get("wineBinary"), winePrefix: String(data.get("winePrefix") || "") || null, wineLaunchFlags: data.get("wineLaunchFlags"), ...credentialChanges,
      }) });
      if (configurationReady) await request(`/api/worlds/${world.id}/configuration/options`, { method: "PUT", body: JSON.stringify({ changes: adminSettings }) });
      setCredentials({ adminPasswordSet: adminPassword ? true : data.get("clearAdminPassword") === "on" ? false : credentials.adminPasswordSet, serverPasswordSet: serverPassword ? true : data.get("clearServerPassword") === "on" ? false : credentials.serverPasswordSet });
      onNotice(result.configuration?.synchronized ? t("properties.savedSynchronized") : t("properties.savedUnsynchronized", { reason: result.configuration?.reason ?? t("properties.notSynchronized") }));
      event.currentTarget.reset(); onSaved();
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }

  async function exportRegistration() {
    setPending(true);
    try {
      const result = await request<RegistrationResponse>(`/api/worlds/${world.id}/registration`);
      const fileName = registrationFileName(world.displayName);
      const content = `${JSON.stringify(result.registration, null, 2)}\n`;
      const saved = window.psmDesktop ? await window.psmDesktop.saveRegistration(fileName, content) : (downloadInBrowser(fileName, content), fileName);
      onNotice(saved ? t("properties.exported", { path: saved }) : t("properties.exportCancelled"));
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }

  async function unregister() {
    if (!window.confirm(t("properties.unregisterConfirm", { world: world.displayName }))) return;
    setPending(true);
    try { await request(`/api/worlds/${world.id}`, { method: "DELETE" }); router.push("/"); }
    catch (error) { onNotice(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }

  return <div className="admin-panel"><div className="panel-heading"><div><h2>{t("properties.title")}</h2><p>{t("properties.description")}</p></div><button type="button" className="button ghost" disabled={pending || !detailsReady} onClick={() => void exportRegistration()}>{t("properties.export")}</button></div><p className="property-security-note">{t("properties.security")}</p><form className="form-grid" onSubmit={submit}>
    <label>{t("properties.name")}<input name="displayName" required defaultValue={world.displayName} /></label><label>{t("properties.platform")}<select name="platform" defaultValue={world.platform}><option value="linux">{t("properties.linux")}</option><option value="windows">{t("properties.windows")}</option></select></label>
    <label className="wide">{t("properties.installDirectory")}<span className="path-picker"><input required value={installDir} onChange={(event) => setInstallDir(event.target.value)} /><button type="button" onClick={() => void chooseDirectory()}>{t("properties.browse")}</button></span></label>
    <label>{t("properties.gamePort")}<input name="gamePort" type="number" defaultValue={world.gamePort} /></label><label>{t("properties.queryPort")}<input name="queryPort" type="number" defaultValue={world.queryPort} /></label><label>{t("properties.restPort")}<input name="restApiPort" type="number" defaultValue={world.restApiPort} /></label><label>{t("properties.rconPort")}<input name="rconPort" type="number" defaultValue={world.rconPort} /></label>
    <label>{t("properties.adminPassword")} <small>{t(credentials.adminPasswordSet ? "properties.passwordStored" : "properties.passwordMissing")}</small><input name="adminPassword" type="password" autoComplete="new-password" placeholder={t("properties.keepPassword")} /></label><label>{t("properties.serverPassword")} <small>{t(credentials.serverPasswordSet ? "properties.passwordStored" : "properties.passwordMissing")}</small><input name="serverPassword" type="password" autoComplete="new-password" placeholder={t("properties.keepPassword")} /></label>
    <fieldset className="wide checkbox-grid credential-actions"><label><input name="clearAdminPassword" type="checkbox" /> {t("properties.clearAdmin")}</label><label><input name="clearServerPassword" type="checkbox" /> {t("properties.clearServer")}</label></fieldset>
    <fieldset className="wide checkbox-grid"><label><input name="restApiEnabled" type="checkbox" defaultChecked={world.restApiEnabled} /> {t("properties.restApi")}</label><label><input name="rconEnabled" type="checkbox" defaultChecked={world.rconEnabled} /> {t("properties.rcon")}</label><label><input name="communityServer" type="checkbox" defaultChecked={world.communityServer} /> {t("properties.community")}</label><label><input name="autostart" type="checkbox" defaultChecked={world.autostart} /> {t("properties.autostart")}</label><label><input name="crashGuard" type="checkbox" defaultChecked={world.crashGuard} /> {t("properties.crashRecovery")}</label><label><input name="legacyPerfFlags" type="checkbox" defaultChecked={world.legacyPerfFlags} /> {t("properties.performance")}</label></fieldset>
    <fieldset className="wide server-listing" disabled={!configurationReady}><legend>{t("properties.listingTitle")}</legend><p>{t(configurationReady ? "properties.listingDescription" : "properties.listingUnavailable")}</p><div className="server-listing-grid">
      {PALWORLD_ADMIN_SETTING_FIELDS.map((field) => <label key={field.key}>{t(settingFieldKey(field.key, "label"))}<input type={field.type === "int" ? "number" : "text"} value={String(adminSettings[field.key] ?? field.default)} min={field.min} max={field.max} onChange={(event) => setAdminSettings((current) => ({ ...current, [field.key]: field.type === "int" ? Number(event.target.value) : event.target.value }))} /></label>)}
    </div></fieldset>
    <label className="wide">{t("properties.extraArgs")}<input name="extraArgs" defaultValue={world.extraArgs} /></label><label>{t("properties.wineBinary")}<input name="wineBinary" defaultValue={world.wineBinary} /></label><label>{t("properties.winePrefix")}<input name="winePrefix" defaultValue={world.winePrefix ?? ""} /></label><label className="wide">{t("properties.wineFlags")}<input name="wineLaunchFlags" defaultValue={world.wineLaunchFlags} /></label>
    <label className="wide">{t("properties.environment")}<textarea className="environment-editor" value={environment} onChange={(event) => setEnvironment(event.target.value)} spellCheck={false} /></label>
    {world.status !== "stopped" && <p className="wide form-warning">{t("properties.stopToEdit")}</p>}
    <div className="dialog-actions spread"><button type="button" className="button danger" disabled={pending || world.status !== "stopped"} onClick={() => void unregister()}>{t("properties.unregister")}</button><span /><button className="button primary" disabled={pending || !detailsReady}>{t(pending ? "common.saving" : "properties.save")}</button></div>
  </form></div>;
}
