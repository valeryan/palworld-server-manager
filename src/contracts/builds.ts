import { z } from "zod";
import type { Platform, WorldStatus } from "./world";

// Application-level server build management: the shared SteamCMD client and the Palworld build
// installed in every world, as shown in Settings → Server builds.

export const buildActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check") }),
  z.object({ action: z.literal("update-all") }),
  z.object({ action: z.literal("reinstall-steamcmd") }),
]);
export type BuildAction = z.infer<typeof buildActionSchema>;

export type BuildState = "current" | "update-available" | "unknown";
export function buildState(installedBuildId: string | null, latestBuildId: string | null): BuildState {
  if (!installedBuildId || !latestBuildId) return "unknown";
  return installedBuildId === latestBuildId ? "current" : "update-available";
}

export interface SteamCmdStatus { path: string; installed: boolean; preparedAt: number | null; inUse: boolean }
export interface WorldBuildRow { id: string; displayName: string; platform: Platform; status: WorldStatus; buildId: string | null; latestBuildId: string | null; state: BuildState; busy: boolean }
export interface BuildSummary { steamCmd: SteamCmdStatus; latest: { buildId: string; checkedAt: number } | null; worlds: WorldBuildRow[]; activeJob: { id: string; kind: string } | null }
