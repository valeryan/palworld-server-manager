import "server-only";
import { rm } from "node:fs/promises";
import { NotFoundError } from "@/server/errors";
import { isFile } from "@/server/fs";
import { paths } from "@/server/paths";
import { downloadVerified } from "@/server/services/archive";
import { startJob } from "@/server/services/jobs";
import { MOD_CATALOG, artifactPath, type CatalogArtifact } from "./catalog";

declare global { var __psmModDownloads: Set<string> | undefined }
const active = () => (globalThis.__psmModDownloads ??= new Set<string>());

function artifact(id: string): CatalogArtifact {
  const found = MOD_CATALOG.find((entry) => entry.id === id);
  if (!found) throw new NotFoundError("Mod library entry not found.");
  return found;
}

// Started only from the consent dialog; the caller has shown the source, license, size, and digest.
export async function downloadArtifact(id: string): Promise<string> {
  const entry = artifact(id);
  if (active().has(entry.id)) throw new Error(`${entry.name} ${entry.version} is already downloading.`);
  if (await isFile(artifactPath(entry))) throw new Error(`${entry.name} ${entry.version} is already in the library.`);
  active().add(entry.id);
  try {
    return await startJob(null, "mod-download", async (context) => {
      try {
        context.log(`${entry.name} ${entry.version} from ${entry.project} (${entry.license}), ${entry.sizeBytes} bytes, SHA-256 ${entry.sha256}`);
        await downloadVerified({ url: entry.url, sha256: entry.sha256, sizeBytes: entry.sizeBytes, destination: artifactPath(entry), staging: paths.modStaging() }, context);
        await context.update(100, `${entry.name} ${entry.version} added to the library`);
      } finally { active().delete(entry.id); }
    });
  } catch (error) { active().delete(entry.id); throw error; }
}

// Removes only the library copy; worlds keep whatever was installed into them.
export async function removeArtifact(id: string): Promise<void> {
  const entry = artifact(id);
  if (active().has(entry.id)) throw new Error(`${entry.name} ${entry.version} is downloading; wait for it to finish.`);
  await rm(artifactPath(entry), { force: true });
}

export function artifactDownloading(id: string): boolean { return active().has(id); }
