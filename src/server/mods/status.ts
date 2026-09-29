import "server-only";
import path from "node:path";
import { stat } from "node:fs/promises";
import type { ModLibraryEntry, WorldModsView } from "@/contracts/mod";
import { paths } from "@/server/paths";
import { getWorld, listWorlds } from "@/server/services/worlds";
import { MOD_CATALOG, type CatalogArtifact } from "./catalog";
import { listLuaMods } from "./lua-mods";
import { detectUe4ss } from "./ue4ss";
import { workshopStatus } from "./workshop-mods";

// Read-only health views. Nothing here downloads or changes server files.
export async function worldModStatus(worldId: string): Promise<WorldModsView> {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  const [ue4ss, luaMods, workshop] = await Promise.all([detectUe4ss(world), listLuaMods(world), workshopStatus(world)]);
  return { ue4ss, luaMods, workshop };
}

export function artifactPath(artifact: CatalogArtifact): string { return path.join(paths.modCache(), artifact.id, artifact.version, artifact.fileName); }

export async function modLibrary(): Promise<ModLibraryEntry[]> {
  const worlds = await listWorlds();
  const detections = await Promise.all(worlds.map(async (world) => ({ world, ue4ss: await detectUe4ss(world) })));
  return Promise.all(MOD_CATALOG.map(async (artifact) => {
    const { id, kind, name, variant, version, project, projectUrl, license, sizeBytes, sha256 } = artifact;
    const downloaded = await stat(artifactPath(artifact)).then((info) => info.isFile(), () => false);
    const detectedIn = detections.filter(({ ue4ss }) => ue4ss.installed && ue4ss.variant === artifact.variant).map(({ world }) => ({ worldId: world.id, displayName: world.displayName }));
    return { id, kind, name, variant, version, project, projectUrl, license, sizeBytes, sha256, downloaded, detectedIn };
  }));
}
