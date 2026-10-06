import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { WorldView } from "@/contracts/world";

export const PALWORLD_APP_ID = "2394010";

export function manifestPath(world: Pick<WorldView, "installDir">): string { return path.join(/* turbopackIgnore: true */ world.installDir, "steamapps", `appmanifest_${PALWORLD_APP_ID}.acf`); }

/** The installed build from the Steam app manifest, in the install directory or a shared Steam library two levels up. */
export function readInstalledBuild(world: Pick<WorldView, "installDir">): { buildId: string; manifestPath: string } | null {
  for (const candidate of [manifestPath(world), path.join(/* turbopackIgnore: true */ world.installDir, "..", "..", `appmanifest_${PALWORLD_APP_ID}.acf`)]) {
    try { const content = readFileSync(candidate, "utf8"); if (!new RegExp(`"appid"\\s+"${PALWORLD_APP_ID}"`).test(content)) continue; const id = content.match(/"buildid"\s+"([^"\r\n]+)"/i)?.[1]; if (id) return { buildId: id, manifestPath: candidate }; } catch { /* Manual copies need not have a manifest. */ }
  }
  return null;
}
export function readBuildId(world: Pick<WorldView, "installDir">): string | null { return readInstalledBuild(world)?.buildId ?? null; }
