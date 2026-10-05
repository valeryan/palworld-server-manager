import "server-only";
import { stat } from "node:fs/promises";
import type { LibraryLuaMod, LibraryRelay, ModLibraryEntry, RelayId, WorldModsView } from "@/contracts/mod";
import { getWorld, listWorlds } from "@/server/services/worlds";
import { MOD_CATALOG, artifactPath, type CatalogArtifact } from "./catalog";
import { artifactDownloading } from "./library";
import { listLuaMods } from "./lua-mods";
import { detectUe4ss } from "./ue4ss";
import { runtimeRow } from "./ue4ss-runtime";
import { listLuaArtifacts } from "./lua-library";
import { RELAYS, relayStatus } from "./relays";
import { checkManagedMods } from "./integrity";
import { workshopStatus } from "./workshop-mods";

// Read-only health views. Nothing here downloads or changes server files.
export async function worldModStatus(worldId: string): Promise<WorldModsView> {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  const [detected, luaMods, workshop, runtime] = await Promise.all([detectUe4ss(world), listLuaMods(world), workshopStatus(world), runtimeRow(world.id)]);
  const artifact = MOD_CATALOG.find((entry) => entry.kind === "ue4ss" && entry.variant === detected.variant);
  const managed = runtime ? { artifactId: runtime.artifactId, version: runtime.version, enabled: runtime.enabled, updateAvailable: Boolean(artifact && artifact.sha256 !== runtime.sha256), recoveryPaused: runtime.recoveryPaused } : null;
  const ue4ss = { ...detected, installed: detected.installed || Boolean(runtime), managed, active: runtime ? runtime.enabled : detected.active };
  // Lua mods only run while UE4SS loads; a mod's own mods.txt choice is kept either way.
  const artifacts = await listLuaArtifacts(); const byId = new Map(artifacts.map((entry) => [entry.id, entry]));
  const views = luaMods.map(({ installedSha256, ...mod }) => {
    const source = mod.artifactId ? byId.get(mod.artifactId) : undefined;
    return { ...mod, active: mod.enabled ? ue4ss.active : false, updateAvailable: Boolean(source && installedSha256 && source.sha256 !== installedSha256) };
  });
  const installed = new Set(luaMods.map((mod) => mod.name));
  const availableLuaMods = artifacts.filter((entry) => !installed.has(entry.name)).map((entry) => ({ id: entry.id, name: entry.name }));
  const library = artifact ? { id: artifact.id, name: artifact.name, version: artifact.version, downloaded: await artifactCached(artifact) } : null;
  return { integrity: await checkManagedMods(world), ue4ss, library, relays: await relayStatus(world), luaMods: views, availableLuaMods, workshop };
}


async function artifactCached(artifact: CatalogArtifact): Promise<boolean> { return stat(artifactPath(artifact)).then((info) => info.isFile() && info.size === artifact.sizeBytes, () => false); }

export async function modLibrary(): Promise<ModLibraryEntry[]> {
  const worlds = await listWorlds();
  const detections = await Promise.all(worlds.map(async (world) => ({ world, ue4ss: await detectUe4ss(world) })));
  return Promise.all(MOD_CATALOG.map(async (artifact) => {
    const { id, kind, name, variant, version, project, projectUrl, license, sizeBytes, sha256, url } = artifact;
    const downloaded = await artifactCached(artifact);
    const downloading = artifactDownloading(artifact.id);
    const detectedIn = detections.filter(({ ue4ss }) => ue4ss.installed && ue4ss.variant === artifact.variant).map(({ world }) => ({ worldId: world.id, displayName: world.displayName }));
    return { id, kind, name, variant, version, project, projectUrl, license, sizeBytes, sha256, url, downloaded, downloading, detectedIn };
  }));
}

export async function libraryLuaMods(): Promise<LibraryLuaMod[]> {
  const [artifacts, worlds] = await Promise.all([listLuaArtifacts(), listWorlds()]);
  const installs = await Promise.all(worlds.map(async (world) => ({ world, mods: await listLuaMods(world) })));
  return artifacts.map((entry) => ({ id: entry.id, name: entry.name, fileName: entry.fileName, sizeBytes: entry.sizeBytes, sha256: entry.sha256, addedAt: entry.addedAt,
    usedIn: installs.filter(({ mods }) => mods.some((mod) => mod.artifactId === entry.id)).map(({ world }) => ({ worldId: world.id, displayName: world.displayName })) }));
}

export async function libraryRelays(): Promise<LibraryRelay[]> {
  const worlds = await listWorlds();
  const statuses = await Promise.all(worlds.map(async (world) => ({ world, relays: await relayStatus(world) })));
  return (Object.keys(RELAYS) as RelayId[]).map((id) => ({ id, folder: RELAYS[id].folder,
    bundledVersion: statuses[0]?.relays.find((relay) => relay.id === id)?.bundledVersion ?? null,
    usedIn: statuses.filter(({ relays }) => relays.some((relay) => relay.id === id && relay.managed)).map(({ world }) => ({ worldId: world.id, displayName: world.displayName })) }));
}
