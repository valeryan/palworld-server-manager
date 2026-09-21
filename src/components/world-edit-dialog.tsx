"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
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

export function WorldAdminPanel({ world, onSaved, onNotice }: { world: SafeWorld; onSaved(): void; onNotice(message: string): void }) {
  const [pending, setPending] = useState(false);
  const [detailsReady, setDetailsReady] = useState(false);
  const [installDir, setInstallDir] = useState(world.installDir);
  const [environment, setEnvironment] = useState("{}");
  const [credentials, setCredentials] = useState({ adminPasswordSet: false, serverPasswordSet: false });
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void request<RegistrationResponse>(`/api/worlds/${world.id}/registration`).then((result) => {
      if (!active) return;
      setEnvironment(JSON.stringify(result.registration.world.env, null, 2));
      setCredentials(result.credentials);
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
      if (!parsedEnvironment || Array.isArray(parsedEnvironment) || typeof parsedEnvironment !== "object" || Object.values(parsedEnvironment).some((value) => typeof value !== "string")) throw new Error("Environment must be a JSON object whose values are strings.");
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
      setCredentials({ adminPasswordSet: adminPassword ? true : data.get("clearAdminPassword") === "on" ? false : credentials.adminPasswordSet, serverPasswordSet: serverPassword ? true : data.get("clearServerPassword") === "on" ? false : credentials.serverPasswordSet });
      onNotice(result.configuration?.synchronized ? "World settings saved and synchronized to PalWorldSettings.ini" : `World settings saved; ${result.configuration?.reason ?? "configuration was not synchronized"}`);
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
      onNotice(saved ? `Registration exported to ${saved}` : "Registration export cancelled");
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }

  async function unregister() {
    if (!window.confirm(`Unregister ${world.displayName}? Server files will not be deleted.`)) return;
    setPending(true);
    try { await request(`/api/worlds/${world.id}`, { method: "DELETE" }); router.push("/"); }
    catch (error) { onNotice(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }

  return <div className="admin-panel"><div className="panel-heading"><div><h2>World properties</h2><p>Registration, connection, credentials, startup, and process-launch settings for this world.</p></div><button type="button" className="button ghost" disabled={pending || !detailsReady} onClick={() => void exportRegistration()}>Export registration</button></div><p className="property-security-note">Portable exports exclude passwords. Environment variables are included and may contain sensitive values.</p><form className="form-grid" onSubmit={submit}>
    <label>Name<input name="displayName" required defaultValue={world.displayName} /></label><label>Platform<select name="platform" defaultValue={world.platform}><option value="linux">Linux</option><option value="windows">Windows / Wine</option></select></label>
    <label className="wide">Install directory<span className="path-picker"><input required value={installDir} onChange={(event) => setInstallDir(event.target.value)} /><button type="button" onClick={() => void chooseDirectory()}>Browse…</button></span></label>
    <label>Game port<input name="gamePort" type="number" defaultValue={world.gamePort} /></label><label>Query port<input name="queryPort" type="number" defaultValue={world.queryPort} /></label><label>REST API port<input name="restApiPort" type="number" defaultValue={world.restApiPort} /></label><label>RCON port<input name="rconPort" type="number" defaultValue={world.rconPort} /></label>
    <label>New admin password <small>{credentials.adminPasswordSet ? "A password is stored" : "No password is stored"}</small><input name="adminPassword" type="password" autoComplete="new-password" placeholder="Leave blank to keep current" /></label><label>New server password <small>{credentials.serverPasswordSet ? "A password is stored" : "No password is stored"}</small><input name="serverPassword" type="password" autoComplete="new-password" placeholder="Leave blank to keep current" /></label>
    <fieldset className="wide checkbox-grid credential-actions"><label><input name="clearAdminPassword" type="checkbox" /> Clear stored admin password</label><label><input name="clearServerPassword" type="checkbox" /> Clear stored server password</label></fieldset>
    <fieldset className="wide checkbox-grid"><label><input name="restApiEnabled" type="checkbox" defaultChecked={world.restApiEnabled} /> REST API</label><label><input name="rconEnabled" type="checkbox" defaultChecked={world.rconEnabled} /> Legacy RCON</label><label><input name="communityServer" type="checkbox" defaultChecked={world.communityServer} /> Community server</label><label><input name="autostart" type="checkbox" defaultChecked={world.autostart} /> Autostart</label><label><input name="crashGuard" type="checkbox" defaultChecked={world.crashGuard} /> Crash recovery</label><label><input name="legacyPerfFlags" type="checkbox" defaultChecked={world.legacyPerfFlags} /> Performance flags</label></fieldset>
    <label className="wide">Extra launch arguments<input name="extraArgs" defaultValue={world.extraArgs} /></label><label>Wine binary<input name="wineBinary" defaultValue={world.wineBinary} /></label><label>Wine prefix<input name="winePrefix" defaultValue={world.winePrefix ?? ""} /></label><label className="wide">Wine launch flags<input name="wineLaunchFlags" defaultValue={world.wineLaunchFlags} /></label>
    <label className="wide">Environment variables (JSON)<textarea className="environment-editor" value={environment} onChange={(event) => setEnvironment(event.target.value)} spellCheck={false} /></label>
    {world.status !== "stopped" && <p className="wide form-warning">Stop this world before changing its path, platform, ports, environment, or launch settings.</p>}
    <div className="dialog-actions spread"><button type="button" className="button danger" disabled={pending || world.status !== "stopped"} onClick={() => void unregister()}>Unregister</button><span /><button className="button primary" disabled={pending || !detailsReady}>{pending ? "Saving…" : "Save world"}</button></div>
  </form></div>;
}
