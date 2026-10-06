import "server-only";
import { createHash } from "node:crypto";
import path from "node:path";
import type { AdvertisedPortState, ManagedWorldSettings, Platform, WorldView } from "@/contracts/world";
import { configurationCredentials, parseConfigurationOptions, validateConfiguration } from "@/lib/palworld-ini";
import { readOptional } from "@/server/fs";

// Pure rules about PSM-owned settings and their projection into PalWorldSettings.ini.
// No database or lock; the only I/O is reading the shipped template.

export function configPath(installDir: string, platform: Platform) {
  return path.join(/* turbopackIgnore: true */ installDir, "Pal", "Saved", "Config", platform === "windows" ? "WindowsServer" : "LinuxServer", "PalWorldSettings.ini");
}
export function defaultConfigurationPath(installDir: string) {
  return path.join(/* turbopackIgnore: true */ installDir, "DefaultPalWorldSettings.ini");
}

/** A hash of the option values only, so formatting changes do not count as drift. */
export function semanticHash(content: string) {
  validateConfiguration(content);
  return createHash("sha256").update(JSON.stringify(Object.entries(parseConfigurationOptions(content)).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}

export function advertisedPortState(raw: string | undefined, gamePort: number): AdvertisedPortState {
  if (raw == null) return { mode: "inherit", effectivePort: gamePort };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return { mode: "invalid", raw, effectivePort: gamePort };
  return value === gamePort ? { mode: "inherit", effectivePort: gamePort } : { mode: "override", effectivePort: value };
}

export function managedPublicPortChange(previous: AdvertisedPortState, previousGamePort: number, nextGamePort: number, override: number | null | undefined, provided: boolean) {
  if (provided) return String(override ?? nextGamePort);
  if (previous.mode === "inherit" && previousGamePort !== nextGamePort) return String(nextGamePort);
  return undefined;
}

function optionalString(raw: string | undefined) {
  try {
    const value: unknown = raw == null ? undefined : JSON.parse(raw);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch { return undefined; }
}

export function managedDisplayNameChange(previousName: string, previousRaw: string | undefined, nextRaw: string | undefined, override: string | null | undefined, provided: boolean) {
  const previous = optionalString(previousRaw);
  const next = optionalString(nextRaw);
  if (provided) {
    const value = override?.trim() || next;
    if (!value) throw new Error("Display Name cannot inherit until Server Name has a valid value.");
    if (value.length > 80) throw new Error("Display Name cannot exceed 80 characters; set a shorter Display Name override.");
    return value;
  }
  if (previous && next && previousName === previous && previous !== next) {
    if (next.length > 80) throw new Error("Display Name cannot exceed 80 characters; set a shorter Display Name override.");
    return next;
  }
  return undefined;
}

/** The PSM-owned fields an INI file implies (REST and RCON switches and ports). */
export function managedWorldChangesFromConfiguration(content: string) {
  const options = parseConfigurationOptions(content);
  const patch: Record<string, boolean | number> = {};
  for (const [option, field] of [["RESTAPIEnabled", "restApiEnabled"], ["RCONEnabled", "rconEnabled"]] as const) {
    if (!Object.hasOwn(options, option)) continue;
    const raw = options[option]!.toLowerCase();
    if (raw !== "true" && raw !== "false") throw new Error(`${option} must be True or False.`);
    patch[field] = raw === "true";
  }
  for (const [option, field] of [["RESTAPIPort", "restApiPort"], ["RCONPort", "rconPort"]] as const) {
    if (!Object.hasOwn(options, option)) continue;
    const value = Number(options[option]);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${option} must be a port from 1 to 65535.`);
    patch[field] = value;
  }
  return patch;
}

export type ManagedConfigurationOptions = { syncPublicPort?: boolean };
/** The INI options that mirror PSM-owned settings. */
export function managedConfigurationChanges(world: Pick<ManagedWorldSettings, "restApiEnabled" | "restApiPort" | "rconEnabled" | "rconPort" | "gamePort">, options: ManagedConfigurationOptions = {}) {
  const changes: Record<string, string> = {
    RESTAPIEnabled: world.restApiEnabled ? "True" : "False",
    RESTAPIPort: String(world.restApiPort),
    RCONEnabled: world.rconEnabled ? "True" : "False",
    RCONPort: String(world.rconPort),
  };
  if (options.syncPublicPort) changes.PublicPort = String(world.gamePort);
  return changes;
}

/** The shipped DefaultPalWorldSettings.ini as parsed options, or null when it is absent or malformed. */
export async function readShippedDefaults(installDir: string): Promise<Record<string, string> | null> {
  const content = await readOptional(defaultConfigurationPath(installDir));
  if (content === null) return null;
  try { validateConfiguration(content); return parseConfigurationOptions(content); }
  catch { return null; }
}

/** Game credentials live only in the INI. Copies left in the registry by older builds are carried over once, when the INI has none of its own. */
export function legacyCredentialChanges(content: string, world: Pick<WorldView, "adminPassword" | "serverPassword">): Record<string, string> {
  const credentials = configurationCredentials(content);
  const changes: Record<string, string> = {};
  if (!credentials.adminPassword && world.adminPassword) changes.AdminPassword = JSON.stringify(world.adminPassword);
  if (!credentials.serverPassword && world.serverPassword) changes.ServerPassword = JSON.stringify(world.serverPassword);
  return changes;
}
