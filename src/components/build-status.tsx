import { buildState, buildStatusText } from "@/lib/build-presentation";

export function BuildStatus({ installed, latest }: { installed: string | null; latest: string | null }) {
  const state = buildState(installed, latest);
  const icon = state === "current" ? "✓" : state === "update-available" ? "↑" : "?";
  const description = buildStatusText(installed, latest);
  return <span className="build-status" title={description} aria-label={description}>
    <span className="build-number" aria-hidden="true">{installed ?? "—"}</span>
    <span className={`build-state build-state-${state}`} aria-hidden="true">{icon}</span>
  </span>;
}
