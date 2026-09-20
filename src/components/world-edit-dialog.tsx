"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import type { WorldView } from "@/contracts/world";

type SafeWorld = Omit<WorldView, "adminPassword" | "serverPassword" | "env">;
async function request(input: RequestInfo, init: RequestInit) {
  const response = await fetch(input, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body;
}

export function WorldEditDialog({ world, onClose, onSaved, onNotice }: { world: SafeWorld; onClose(): void; onSaved(): void; onNotice(message: string): void }) {
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      await request(`/api/worlds/${world.id}`, { method: "PATCH", body: JSON.stringify({
        displayName: data.get("displayName"), installDir: data.get("installDir"), platform: data.get("platform"),
        gamePort: Number(data.get("gamePort")), queryPort: Number(data.get("queryPort")), restApiPort: Number(data.get("restApiPort")), rconPort: Number(data.get("rconPort")),
        restApiEnabled: data.get("restApiEnabled") === "on", rconEnabled: data.get("rconEnabled") === "on", communityServer: data.get("communityServer") === "on",
        autostart: data.get("autostart") === "on", crashGuard: data.get("crashGuard") === "on", legacyPerfFlags: data.get("legacyPerfFlags") === "on",
        extraArgs: data.get("extraArgs"), wineBinary: data.get("wineBinary"), winePrefix: String(data.get("winePrefix") || "") || null, wineLaunchFlags: data.get("wineLaunchFlags"),
      }) });
      onNotice("World settings saved"); onSaved(); onClose();
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }
  async function unregister() {
    if (!window.confirm(`Unregister ${world.displayName}? Server files will not be deleted.`)) return;
    setPending(true);
    try { await request(`/api/worlds/${world.id}`, { method: "DELETE" }); onNotice("World unregistered; server files were retained"); onSaved(); onClose(); }
    catch (error) { onNotice(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog edit-dialog"><Dialog.Title>Edit {world.displayName}</Dialog.Title><Dialog.Description>Lifecycle, network, and launch settings. Credentials remain unchanged.</Dialog.Description><form className="form-grid" onSubmit={submit}>
    <label>Name<input name="displayName" required defaultValue={world.displayName} /></label><label>Platform<select name="platform" defaultValue={world.platform}><option value="linux">Linux</option><option value="windows">Windows / Wine</option></select></label>
    <label className="wide">Install directory<input name="installDir" required defaultValue={world.installDir} /></label>
    <label>Game port<input name="gamePort" type="number" defaultValue={world.gamePort} /></label><label>Query port<input name="queryPort" type="number" defaultValue={world.queryPort} /></label><label>REST API port<input name="restApiPort" type="number" defaultValue={world.restApiPort} /></label><label>RCON port<input name="rconPort" type="number" defaultValue={world.rconPort} /></label>
    <fieldset className="wide checkbox-grid"><label><input name="restApiEnabled" type="checkbox" defaultChecked={world.restApiEnabled} /> REST API</label><label><input name="rconEnabled" type="checkbox" defaultChecked={world.rconEnabled} /> Legacy RCON</label><label><input name="communityServer" type="checkbox" defaultChecked={world.communityServer} /> Community server</label><label><input name="autostart" type="checkbox" defaultChecked={world.autostart} /> Autostart</label><label><input name="crashGuard" type="checkbox" defaultChecked={world.crashGuard} /> Crash recovery</label><label><input name="legacyPerfFlags" type="checkbox" defaultChecked={world.legacyPerfFlags} /> Performance flags</label></fieldset>
    <label className="wide">Extra launch arguments<input name="extraArgs" defaultValue={world.extraArgs} /></label><label>Wine binary<input name="wineBinary" defaultValue={world.wineBinary} /></label><label>Wine prefix<input name="winePrefix" defaultValue={world.winePrefix ?? ""} /></label><label className="wide">Wine launch flags<input name="wineLaunchFlags" defaultValue={world.wineLaunchFlags} /></label>
    <div className="dialog-actions spread"><button type="button" className="button danger" disabled={pending || world.status !== "stopped"} onClick={() => void unregister()}>Unregister</button><span /><button type="button" className="button ghost" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>Save world</button></div>
  </form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
