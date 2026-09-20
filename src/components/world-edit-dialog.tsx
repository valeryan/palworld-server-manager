"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { WorldView } from "@/contracts/world";

type SafeWorld = Omit<WorldView, "adminPassword" | "serverPassword" | "env">;
async function request(input: RequestInfo, init: RequestInit) {
  const response = await fetch(input, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body;
}

export function WorldAdminPanel({ world, onSaved, onNotice }: { world: SafeWorld; onSaved(): void; onNotice(message: string): void }) {
  const [pending, setPending] = useState(false); const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      const adminPassword = String(data.get("adminPassword") || ""); const serverPassword = String(data.get("serverPassword") || "");
      const credentials = { ...(adminPassword ? { adminPassword } : {}), ...(serverPassword ? { serverPassword } : {}) };
      const result = await request(`/api/worlds/${world.id}`, { method: "PATCH", body: JSON.stringify({
        displayName: data.get("displayName"), installDir: data.get("installDir"), platform: data.get("platform"),
        gamePort: Number(data.get("gamePort")), queryPort: Number(data.get("queryPort")), restApiPort: Number(data.get("restApiPort")), rconPort: Number(data.get("rconPort")),
        restApiEnabled: data.get("restApiEnabled") === "on", rconEnabled: data.get("rconEnabled") === "on", communityServer: data.get("communityServer") === "on",
        autostart: data.get("autostart") === "on", crashGuard: data.get("crashGuard") === "on", legacyPerfFlags: data.get("legacyPerfFlags") === "on",
        extraArgs: data.get("extraArgs"), wineBinary: data.get("wineBinary"), winePrefix: String(data.get("winePrefix") || "") || null, wineLaunchFlags: data.get("wineLaunchFlags"), ...credentials,
      }) });
      onNotice(result.configuration?.synchronized ? "World settings saved and synchronized to PalWorldSettings.ini" : `World settings saved; ${result.configuration?.reason ?? "configuration was not synchronized"}`); onSaved();
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }
  async function unregister() {
    if (!window.confirm(`Unregister ${world.displayName}? Server files will not be deleted.`)) return;
    setPending(true);
    try { await request(`/api/worlds/${world.id}`, { method: "DELETE" }); router.push("/"); }
    catch (error) { onNotice(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }
  return <div className="admin-panel"><div className="panel-heading"><div><h2>World administration</h2><p>Managed ports and credentials are synchronized to PalWorldSettings.ini when saved.</p></div></div><form className="form-grid" onSubmit={submit}>
    <label>Name<input name="displayName" required defaultValue={world.displayName} /></label><label>Platform<select name="platform" defaultValue={world.platform}><option value="linux">Linux</option><option value="windows">Windows / Wine</option></select></label>
    <label className="wide">Install directory<input name="installDir" required defaultValue={world.installDir} /></label>
    <label>Game port<input name="gamePort" type="number" defaultValue={world.gamePort} /></label><label>Query port<input name="queryPort" type="number" defaultValue={world.queryPort} /></label><label>REST API port<input name="restApiPort" type="number" defaultValue={world.restApiPort} /></label><label>RCON port<input name="rconPort" type="number" defaultValue={world.rconPort} /></label>
    <label>New admin password<input name="adminPassword" type="password" autoComplete="new-password" placeholder="Leave blank to keep current" /></label><label>New server password<input name="serverPassword" type="password" autoComplete="new-password" placeholder="Leave blank to keep current" /></label>
    <fieldset className="wide checkbox-grid"><label><input name="restApiEnabled" type="checkbox" defaultChecked={world.restApiEnabled} /> REST API</label><label><input name="rconEnabled" type="checkbox" defaultChecked={world.rconEnabled} /> Legacy RCON</label><label><input name="communityServer" type="checkbox" defaultChecked={world.communityServer} /> Community server</label><label><input name="autostart" type="checkbox" defaultChecked={world.autostart} /> Autostart</label><label><input name="crashGuard" type="checkbox" defaultChecked={world.crashGuard} /> Crash recovery</label><label><input name="legacyPerfFlags" type="checkbox" defaultChecked={world.legacyPerfFlags} /> Performance flags</label></fieldset>
    <label className="wide">Extra launch arguments<input name="extraArgs" defaultValue={world.extraArgs} /></label><label>Wine binary<input name="wineBinary" defaultValue={world.wineBinary} /></label><label>Wine prefix<input name="winePrefix" defaultValue={world.winePrefix ?? ""} /></label><label className="wide">Wine launch flags<input name="wineLaunchFlags" defaultValue={world.wineLaunchFlags} /></label>
    <div className="dialog-actions spread"><button type="button" className="button danger" disabled={pending || world.status !== "stopped"} onClick={() => void unregister()}>Unregister</button><span /><button className="button primary" disabled={pending}>Save world</button></div>
  </form></div>;
}
