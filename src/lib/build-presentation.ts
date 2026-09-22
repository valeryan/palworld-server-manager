export type BuildState = "current" | "update-available" | "unknown";

export function buildState(installedBuildId: string | null, latestBuildId: string | null): BuildState {
  if (!installedBuildId || !latestBuildId) return "unknown";
  return installedBuildId === latestBuildId ? "current" : "update-available";
}

export function buildStatusText(installedBuildId: string | null, latestBuildId: string | null): string {
  const state = buildState(installedBuildId, latestBuildId);
  if (state === "current") return `Installed build ${installedBuildId} matches the latest public build.`;
  if (state === "update-available") return `Update required: installed build ${installedBuildId}; latest public build ${latestBuildId}.`;
  if (!installedBuildId) return "The installed build could not be detected.";
  return `Installed build ${installedBuildId}; the latest public build has not been checked.`;
}
