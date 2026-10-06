export type BuildState = "current" | "update-available" | "unknown";

export function buildState(installedBuildId: string | null, latestBuildId: string | null): BuildState {
  if (!installedBuildId || !latestBuildId) return "unknown";
  return installedBuildId === latestBuildId ? "current" : "update-available";
}
