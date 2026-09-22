"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { WorldRegistration, WorldView } from "@/contracts/world";

type SafeWorld = Omit<WorldView, "adminPassword" | "serverPassword" | "env">;
type RegistrationResponse = {
  registration: WorldRegistration;
  credentials: { adminPasswordSet: boolean; serverPasswordSet: boolean };
};

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

export function WorldPropertiesPanel({ world, onSaved, onNotice }: { world: SafeWorld; onSaved(): void; onNotice(message: string): void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [installDir, setInstallDir] = useState(world.installDir);
  const [detailsReady, setDetailsReady] = useState(false);
  const [environment, setEnvironment] = useState("{}");

  useEffect(() => {
    let active = true;
    void request<RegistrationResponse>(`/api/worlds/${world.id}/registration`).then((result) => {
      if (!active) return;
      setEnvironment(JSON.stringify(result.registration.world.env, null, 2));
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
    try {
      const data = new FormData(event.currentTarget);
      const parsedEnvironment: unknown = JSON.parse(environment);
      if (!parsedEnvironment || Array.isArray(parsedEnvironment) || typeof parsedEnvironment !== "object" || Object.values(parsedEnvironment).some((value) => typeof value !== "string")) throw new Error(t("properties.environmentInvalid"));
      await request(`/api/worlds/${world.id}`, { method: "PATCH", body: JSON.stringify({
        displayName: data.get("displayName"),
        ...(world.status === "stopped" ? {
          installDir, platform: data.get("platform"), gamePort: Number(data.get("gamePort")), queryPort: Number(data.get("queryPort")),
          communityServer: data.get("communityServer") === "on", autostart: data.get("autostart") === "on", crashGuard: data.get("crashGuard") === "on",
          legacyPerfFlags: data.get("legacyPerfFlags") === "on", extraArgs: data.get("extraArgs"), env: parsedEnvironment,
          wineBinary: data.get("wineBinary"), winePrefix: String(data.get("winePrefix") || "") || null, wineLaunchFlags: data.get("wineLaunchFlags"),
        } : {}),
      }) });
      onNotice(t("managerProperties.saved")); onSaved();
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

  return <div className="admin-panel"><div className="panel-heading"><div><h2>{t("managerProperties.title")}</h2><p>{t("managerProperties.description")}</p></div><button type="button" className="button ghost" disabled={pending} onClick={() => void exportRegistration()}>{t("properties.export")}</button></div><p className="property-security-note">{t("properties.security")}</p><form className="form-grid" onSubmit={submit}>
    <label className="wide">{t("managerProperties.displayName")}<input name="displayName" required defaultValue={world.displayName} /></label>
    <label>{t("properties.platform")}<select name="platform" defaultValue={world.platform} disabled={world.status !== "stopped"}><option value="linux">{t("properties.linux")}</option><option value="windows">{t("properties.windows")}</option></select></label>
    <label className="wide">{t("properties.installDirectory")}<span className="path-picker"><input required value={installDir} disabled={world.status !== "stopped"} onChange={(event) => setInstallDir(event.target.value)} /><button type="button" disabled={world.status !== "stopped"} onClick={() => void chooseDirectory()}>{t("properties.browse")}</button></span><small>{t("managerProperties.locationHelp")}</small></label>
    <label>{t("properties.gamePort")}<input name="gamePort" type="number" defaultValue={world.gamePort} disabled={world.status !== "stopped"} /></label><label>{t("properties.queryPort")}<input name="queryPort" type="number" defaultValue={world.queryPort} disabled={world.status !== "stopped"} /></label>
    <fieldset className="wide checkbox-grid"><label><input name="communityServer" type="checkbox" defaultChecked={world.communityServer} disabled={world.status !== "stopped"} /> {t("properties.community")}</label><label><input name="autostart" type="checkbox" defaultChecked={world.autostart} disabled={world.status !== "stopped"} /> {t("properties.autostart")}</label><label><input name="crashGuard" type="checkbox" defaultChecked={world.crashGuard} disabled={world.status !== "stopped"} /> {t("properties.crashRecovery")}</label><label><input name="legacyPerfFlags" type="checkbox" defaultChecked={world.legacyPerfFlags} disabled={world.status !== "stopped"} /> {t("properties.performance")}</label></fieldset>
    <label className="wide">{t("properties.extraArgs")}<input name="extraArgs" defaultValue={world.extraArgs} disabled={world.status !== "stopped"} /></label><label>{t("properties.wineBinary")}<input name="wineBinary" defaultValue={world.wineBinary} disabled={world.status !== "stopped"} /></label><label>{t("properties.winePrefix")}<input name="winePrefix" defaultValue={world.winePrefix ?? ""} disabled={world.status !== "stopped"} /></label><label className="wide">{t("properties.wineFlags")}<input name="wineLaunchFlags" defaultValue={world.wineLaunchFlags} disabled={world.status !== "stopped"} /></label>
    <label className="wide">{t("properties.environment")}<textarea className="environment-editor" value={environment} disabled={world.status !== "stopped"} onChange={(event) => setEnvironment(event.target.value)} spellCheck={false} /></label>
    {world.status !== "stopped" && <p className="wide form-warning">{t("managerProperties.stopToRelocate")}</p>}
    <div className="dialog-actions spread"><button type="button" className="button danger" disabled={pending || world.status !== "stopped"} onClick={() => void unregister()}>{t("properties.unregister")}</button><span /><button className="button primary" disabled={pending || !detailsReady}>{t(pending ? "common.saving" : "managerProperties.save")}</button></div>
  </form></div>;
}
