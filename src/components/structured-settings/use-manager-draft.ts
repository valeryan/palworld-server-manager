import { useState } from "react";
import type { TFunction } from "i18next";
import type { useHostPlatform } from "@/lib/use-platform-label";
import type { AdminConfiguration, ManagerDraft, ManagerKey } from "./types";

/** The PSM-owned settings draft, compared field by field against what the server reported. */
export function useManagerDraft(admin: AdminConfiguration, activeServerName: string | undefined) {
  const initialManager: ManagerDraft = {
    displayName: admin.displayName === activeServerName ? "" : admin.displayName, installDir: admin.installDir, platform: admin.platform,
    gamePort: String(admin.gamePort), queryPort: String(admin.queryPort), publicPort: admin.advertisedPort.mode === "inherit" ? "" : admin.advertisedPort.mode === "override" ? String(admin.advertisedPort.effectivePort) : admin.advertisedPort.raw,
    communityServer: admin.communityServer, autostart: admin.autostart, crashGuard: admin.crashGuard,
    legacyPerfFlags: admin.legacyPerfFlags, extraArgs: admin.extraArgs, environment: JSON.stringify(admin.environment, null, 2),
    wineBinary: admin.wineBinary, winePrefix: admin.winePrefix ?? "", wineLaunchFlags: admin.wineLaunchFlags,
    restApiEnabled: admin.restApiEnabled, restApiPort: String(admin.restApiPort), rconEnabled: admin.rconEnabled, rconPort: String(admin.rconPort),
  };
  const [manager, setManager] = useState<ManagerDraft>(initialManager);
  const setManagerValue = <K extends ManagerKey>(key: K, value: ManagerDraft[K]) => setManager((current) => ({ ...current, [key]: value }));
  const changedKeys = new Set((Object.keys(initialManager) as ManagerKey[]).filter((key) => manager[key] !== initialManager[key]));
  const discard = () => setManager(initialManager);
  return { manager, setManagerValue, changedKeys, discard };
}

/** The `managed` request body: only changed fields, with ports and the environment parsed and validated. */
export function managedChanges(manager: ManagerDraft, changedKeys: Set<ManagerKey>, t: TFunction, host: ReturnType<typeof useHostPlatform>): Record<string, unknown> {
  const parsePort = (value: string, label: string) => { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(t("properties.portInvalid", { label })); return parsed; };
  let parsedEnvironment: Record<string, string> | undefined;
  if (changedKeys.has("environment")) {
    const parsed: unknown = JSON.parse(manager.environment);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || Object.values(parsed).some((value) => typeof value !== "string")) throw new Error(t("properties.environmentInvalid"));
    parsedEnvironment = parsed as Record<string, string>;
  }
  const when = (key: ManagerKey, value: () => Record<string, unknown>) => (changedKeys.has(key) ? value() : {});
  return {
    ...when("displayName", () => ({ displayNameOverride: manager.displayName.trim() || null })),
    ...when("installDir", () => ({ installDir: manager.installDir })), ...when("platform", () => ({ platform: manager.platform })),
    ...when("gamePort", () => ({ gamePort: parsePort(manager.gamePort, t("properties.gamePort")) })),
    ...when("queryPort", () => ({ queryPort: parsePort(manager.queryPort, t("properties.queryPort")) })),
    ...when("publicPort", () => ({ publicPortOverride: manager.publicPort.trim() ? parsePort(manager.publicPort, t("properties.publicPort")) : null })),
    ...when("communityServer", () => ({ communityServer: manager.communityServer })),
    ...when("autostart", () => ({ autostart: manager.autostart })), ...when("crashGuard", () => ({ crashGuard: manager.crashGuard })),
    ...when("legacyPerfFlags", () => ({ legacyPerfFlags: manager.legacyPerfFlags })),
    ...when("extraArgs", () => ({ extraArgs: manager.extraArgs, ...(host === "win32" ? { argumentFormat: "windows" } : {}) })),
    ...(parsedEnvironment ? { env: parsedEnvironment } : {}), ...when("wineBinary", () => ({ wineBinary: manager.wineBinary })),
    ...when("winePrefix", () => ({ winePrefix: manager.winePrefix.trim() || null })), ...when("wineLaunchFlags", () => ({ wineLaunchFlags: manager.wineLaunchFlags })),
    ...when("restApiEnabled", () => ({ restApiEnabled: manager.restApiEnabled })),
    ...when("restApiPort", () => ({ restApiPort: parsePort(manager.restApiPort, t("properties.restPort")) })),
    ...when("rconEnabled", () => ({ rconEnabled: manager.rconEnabled })),
    ...when("rconPort", () => ({ rconPort: parsePort(manager.rconPort, t("properties.rconPort")) })),
  };
}
