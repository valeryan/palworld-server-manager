"use client";
import { useTranslation } from "react-i18next";
import { buildState } from "@/lib/build-presentation";

export function BuildStatus({ installed, latest }: { installed: string | null; latest: string | null }) {
  const { t } = useTranslation();
  const state = buildState(installed, latest);
  const icon = state === "current" ? "✓" : state === "update-available" ? "↑" : "?";
  const description = state === "current" ? t("build.current", { installed }) : state === "update-available" ? t("build.updateAvailable", { installed, latest }) : !installed ? t("build.installedUnknown") : t("build.latestUnknown", { installed });
  return <span className={`build-status build-status-${state}`} title={description} aria-label={description}>
    <span className="build-number" aria-hidden="true">{installed ?? "—"}</span>
    <span className={`build-state build-state-${state}`} aria-hidden="true">{icon}</span>
  </span>;
}
