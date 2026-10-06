"use client";
import { useTranslation } from "react-i18next";
import type { Platform } from "@/contracts/world";
import { windowsArguments } from "@/lib/arguments";
import { errorMessage } from "@/lib/errors";
import type { useHostPlatform } from "@/lib/use-platform-label";
import { SettingHelp } from "../setting-help";
import type { AdminConfiguration, ManagerDraft, ManagerKey } from "./types";

// One PSM-owned setting in the guided settings page.

const helpKeys: Record<ManagerKey, string> = {
  displayName: "managerProperties.displayNameHelp", installDir: "managerProperties.locationHelp", platform: "properties.platformHelp",
  gamePort: "properties.gamePortHelp", queryPort: "properties.queryPortHelp", publicPort: "properties.publicPortHelp",
  communityServer: "properties.communityHelp", autostart: "properties.autostartHelp", crashGuard: "properties.crashRecoveryHelp",
  legacyPerfFlags: "properties.performanceHelp", extraArgs: "properties.extraArgsHelp", environment: "properties.environmentHelp",
  wineBinary: "properties.wineBinaryHelp", winePrefix: "properties.winePrefixHelp", wineLaunchFlags: "properties.wineFlagsHelp",
  restApiEnabled: "properties.restApiHelp", restApiPort: "properties.restPortHelp", rconEnabled: "properties.rconHelp", rconPort: "properties.rconPortHelp",
};
const labelKeys: Partial<Record<ManagerKey, string>> = {
  displayName: "managerProperties.displayName", communityServer: "properties.community", publicPort: "properties.publicPort", gamePort: "properties.gamePort", queryPort: "properties.queryPort",
  restApiEnabled: "properties.restApi", rconEnabled: "properties.rcon", restApiPort: "properties.restPort", rconPort: "properties.rconPort",
  autostart: "properties.autostart", crashGuard: "properties.crashRecovery", legacyPerfFlags: "properties.performance", platform: "properties.platform", installDir: "properties.installDirectory",
  environment: "properties.environment", extraArgs: "properties.extraArgs", wineBinary: "properties.wineBinary", winePrefix: "properties.winePrefix", wineLaunchFlags: "properties.wineFlags",
};
const toggleKeys = new Set<ManagerKey>(["communityServer", "restApiEnabled", "rconEnabled", "autostart", "crashGuard", "legacyPerfFlags"]);
const portKeys = new Set<ManagerKey>(["gamePort", "queryPort", "restApiPort", "rconPort"]);

/** Whether a PSM-owned setting's desired value differs from the one in effect on the running server. */
export function managerPendingApply(key: ManagerKey, admin: AdminConfiguration, appliedAdmin: AdminConfiguration, pendingApply: boolean) {
  const value = (source: AdminConfiguration) => key === "environment" ? source.environment : key === "publicPort" ? source.advertisedPort : source[key as keyof AdminConfiguration];
  return pendingApply && JSON.stringify(value(appliedAdmin)) !== JSON.stringify(value(admin));
}

export type ManagerFieldProps = {
  fieldKey: ManagerKey; manager: ManagerDraft; admin: AdminConfiguration; appliedAdmin: AdminConfiguration; pendingApply: boolean;
  changed: boolean; stagedServerName: string | undefined; host: ReturnType<typeof useHostPlatform>; platformLabel: (platform: Platform) => string;
  onChange<K extends ManagerKey>(key: K, value: ManagerDraft[K]): void; onChooseDirectory(): void;
};

export function ManagerField({ fieldKey: key, manager, admin, appliedAdmin, pendingApply, changed, stagedServerName, host, platformLabel, onChange, onChooseDirectory }: ManagerFieldProps) {
  const { t } = useTranslation();
  const changedClass = changed ? "changed" : "";
  const text = t(labelKeys[key] ?? helpKeys[key]);
  const label = <span>{text}<SettingHelp label={t("structured.helpFor", { setting: text })} heading={t("structured.psmSetting")} guidance={t(helpKeys[key], key === "publicPort" ? { port: manager.gamePort || admin.gamePort } : undefined)} />{changed && <em className="change-badge">{t("structured.changedBadge")}</em>}{managerPendingApply(key, admin, appliedAdmin, pendingApply) && <em className="change-badge">{t("structured.appliesAfterRestart")}</em>}</span>;
  if (key === "displayName") return <label className={`manager-field ${changedClass}`}>{label}<input aria-label={text} value={manager.displayName} placeholder={stagedServerName ?? admin.displayName} onChange={(event) => onChange("displayName", event.target.value)} /></label>;
  if (toggleKeys.has(key)) {
    const on = manager[key] as boolean; const serviceClass = key === "restApiEnabled" || key === "rconEnabled" ? "service-toggle" : "";
    return <label className={`manager-field ${serviceClass} ${changedClass}`.replace(/\s+/g, " ").trimEnd()}>{label}<button type="button" className={`toggle ${on ? "on" : ""}`} aria-label={text} aria-pressed={on} onClick={() => onChange(key as "autostart", !on)}><i />{t(on ? "common.on" : "common.off")}</button></label>;
  }
  if (key === "publicPort") {
    const invalid = admin.advertisedPort.mode === "invalid" && !changed;
    return <label className={`manager-field ${changedClass} ${invalid ? "invalid" : ""}`}>{label}<span className="inline-control"><input aria-label={text} inputMode="numeric" value={manager.publicPort} placeholder={manager.gamePort || String(admin.gamePort)} aria-invalid={invalid} onChange={(event) => onChange("publicPort", event.target.value)} />{invalid && <button type="button" className="button ghost" onClick={() => onChange("publicPort", "")}>{t("properties.useGamePort")}</button>}</span></label>;
  }
  if (portKeys.has(key)) { const serviceClass = key === "restApiPort" || key === "rconPort" ? "service-port " : ""; return <label className={`manager-field ${serviceClass}${changedClass}`}>{label}<input aria-label={text} type="number" min={1} max={65535} value={manager[key] as string} onChange={(event) => onChange(key as "gamePort", event.target.value)} /></label>; }
  if (key === "platform") return <label className={`manager-field ${changedClass}`}>{label}<select aria-label={text} value={manager.platform} onChange={(event) => onChange("platform", event.target.value as Platform)}><option value="linux" disabled={host === "win32"}>{platformLabel("linux")}</option><option value="windows">{platformLabel("windows")}</option></select></label>;
  if (key === "installDir") return <label className={`manager-field ${changedClass}`}>{label}<span className="path-picker"><input aria-label={text} required value={manager.installDir} onChange={(event) => onChange("installDir", event.target.value)} /><button type="button" onClick={onChooseDirectory}>{t("properties.browse")}</button></span></label>;
  if (key === "environment") return <label className={`manager-field ${changedClass}`}>{label}<textarea className="environment-editor" aria-label={text} value={manager.environment} onChange={(event) => onChange("environment", event.target.value)} spellCheck={false} /></label>;
  if (key.startsWith("wine") && (host !== "linux" || manager.platform !== "windows")) return null;
  if (key === "extraArgs" && host === "win32") {
    let preview: string; try { preview = JSON.stringify(windowsArguments(manager.extraArgs)); } catch (error) { preview = errorMessage(error); }
    return <label className={`manager-field ${changedClass}`}>{label}<input value={manager.extraArgs} onChange={(event) => onChange("extraArgs", event.target.value)} /><small>{t("structured.windowsArgumentsPreview")} <code>{preview}</code></small></label>;
  }
  const textKey = key as "extraArgs" | "wineBinary" | "winePrefix" | "wineLaunchFlags";
  return <label className={`manager-field ${changedClass}`}>{label}<input aria-label={text} value={manager[textKey]} onChange={(event) => onChange(textKey, event.target.value)} /></label>;
}

/** Export and unregister, shown in the registration section of the settings layout. */
export function RegistrationActions({ pending, worldRunning, onExport, onUnregister }: { pending: boolean; worldRunning: boolean; onExport(): void; onUnregister(): void }) {
  const { t } = useTranslation();
  return <div className="registration-actions"><p>{t("properties.security")}</p><div className="management-actions"><button type="button" className="button ghost" disabled={pending} onClick={onExport}>{t("properties.export")}</button><button type="button" className="button danger" disabled={pending || worldRunning} onClick={onUnregister}>{t("properties.unregister")}</button></div></div>;
}
