import "server-only";
import { stat } from "node:fs/promises";
import type { ModLibraryEntry, WorldModsView } from "@/contracts/mod";
import { getWorld, listWorlds } from "@/server/services/worlds";
import { MOD_CATALOG, artifactPath, type CatalogArtifact } from "./catalog";

export { artifactPath };
import { listLuaMods } from "./lua-mods";
import { detectUe4ss } from "./ue4ss";
import { runtimeRow } from "./ue4ss-runtime";
import { workshopStatus } from "./workshop-mods";

// Read-only health views. Nothing here downloads or changes server files.
export async function worldModStatus(worldId: string): Promise<WorldModsView> {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  const [detected, luaMods, workshop, runtime] = await Promise.all([detectUe4ss(world), listLuaMods(world), workshopStatus(world), runtimeRow(world.id)]);
  const artifact = MOD_CATALOG.find((entry) => entry.kind === "ue4ss" && entry.variant === detected.variant);
  const managed = runtime ? { artifactId: runtime.artifactId, version: runtime.version, enabled: runtime.enabled, updateAvailable: Boolean(artifact && artifact.sha256 !== runtime.sha256), recoveryPaused: runtime.recoveryPaused } : null;
  const ue4ss = { ...detected, installed: detected.installed || Boolean(runtime), managed, active: runtime ? runtime.enabled : detected.active };
  // Lua mods only run while UE4SS loads; a mod's own mods.txt choice is kept either way.
  for (const mod of luaMods) mod.active = mod.enabled ? ue4ss.active : false;
  const library = artifact ? { id: artifact.id, name: artifact.name, version: artifact.version, downloaded: await artifactCached(artifact) } : null;
  return { ue4ss, library, luaMods, workshop };
}


async function artifactCached(artifact: CatalogArtifact): Promise<boolean> { return stat(artifactPath(artifact)).then((info) => info.isFile() && info.size === artifact.sizeBytes, () => false); }

export async function modLibrary(): Promise<ModLibraryEntry[]> {
  const worlds = await listWorlds();
  const detections = await Promise.all(worlds.map(async (world) => ({ world, ue4ss: await detectUe4ss(world) })));
  return Promise.all(MOD_CATALOG.map(async (artifact) => {
    const { id, kind, name, variant, version, project, projectUrl, license, sizeBytes, sha256, url } = artifact;
    const downloaded = await artifactCached(artifact);
    const downloading = globalThis.__psmModDownloads?.has(artifact.id) ?? false;
    const detectedIn = detections.filter(({ ue4ss }) => ue4ss.installed && ue4ss.variant === artifact.variant).map(({ world }) => ({ worldId: world.id, displayName: world.displayName }));
    return { id, kind, name, variant, version, project, projectUrl, license, sizeBytes, sha256, url, downloaded, downloading, detectedIn };
  }));
}
