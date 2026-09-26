import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { database } from "@/server/db";
import { configVersions, events } from "@/server/db/schema";
import type { UpdateWorldInput, WorldView } from "@/contracts/world";
import { decodeDefaultSettingValue, PALWORLD_MANAGER_SETTING_KEYS, PALWORLD_SETTING_FIELD_MAP } from "@/contracts/palworld-settings";
import { getWorld, updateWorld } from "./worlds";
import { pruneConfigurationVersions } from "./retention";

export type AdvertisedPortState =
  | { mode: "inherit"; effectivePort: number }
  | { mode: "override"; effectivePort: number }
  | { mode: "invalid"; raw: string; effectivePort: number };

export function advertisedPortState(raw: string | undefined, gamePort: number): AdvertisedPortState {
  if (raw == null) return { mode: "inherit", effectivePort: gamePort };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return { mode: "invalid", raw, effectivePort: gamePort };
  return value === gamePort ? { mode: "inherit", effectivePort: gamePort } : { mode: "override", effectivePort: value };
}

export function managedPublicPortChange(previous: AdvertisedPortState, previousGamePort: number, nextGamePort: number, override: number | null | undefined, overrideProvided: boolean): string | undefined {
  if (overrideProvided) return String(override ?? nextGamePort);
  if (previous.mode === "inherit" && previousGamePort !== nextGamePort) return String(nextGamePort);
  return undefined;
}

function optionalConfigurationString(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  try { const value: unknown = JSON.parse(raw); return typeof value === "string" && value.trim() ? value.trim() : undefined; }
  catch { return undefined; }
}

export function managedDisplayNameChange(previousDisplayName: string, previousRawServerName: string | undefined, nextRawServerName: string | undefined, override: string | null | undefined, overrideProvided: boolean): string | undefined {
  const previousServerName = optionalConfigurationString(previousRawServerName);
  const nextServerName = optionalConfigurationString(nextRawServerName);
  if (overrideProvided) {
    const value = override?.trim() || nextServerName;
    if (!value) throw new Error("Display Name cannot inherit until Server Name has a valid value.");
    if (value.length > 80) throw new Error("Display Name cannot exceed 80 characters; set a shorter Display Name override.");
    return value;
  }
  if (previousServerName && nextServerName && previousDisplayName === previousServerName && previousServerName !== nextServerName) {
    if (nextServerName.length > 80) throw new Error("Display Name cannot exceed 80 characters; set a shorter Display Name override.");
    return nextServerName;
  }
  return undefined;
}

function configPath(installDir: string, platform: "linux" | "windows") {
  return path.join(installDir, "Pal", "Saved", "Config", platform === "windows" ? "WindowsServer" : "LinuxServer", "PalWorldSettings.ini");
}
export function defaultConfigurationPath(installDir: string) { return path.join(installDir, "DefaultPalWorldSettings.ini"); }
function validate(content: string) {
  if (Buffer.byteLength(content) > 2_000_000) throw new Error("Configuration exceeds the 2 MB safety limit.");
  if (content.includes("\0")) throw new Error("Configuration contains a NUL byte.");
  const match = content.match(/OptionSettings=\((.*)\)/s);
  if (!match) throw new Error("Configuration must contain OptionSettings=(...).");
  let quoted = false; let escaped = false; let depth = 0;
  for (const character of match[1] ?? "") {
    if (escaped) { escaped = false; continue; }
    if (character === "\\" && quoted) { escaped = true; continue; }
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "(") depth += 1;
    else if (!quoted && character === ")") depth -= 1;
    if (depth < 0) throw new Error("OptionSettings contains unbalanced parentheses.");
  }
  if (quoted || depth !== 0) throw new Error("OptionSettings contains unbalanced quotes or parentheses.");
}

function splitOptions(body: string): string[] {
  const parts: string[] = []; let start = 0; let quoted = false; let escaped = false; let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (escaped) { escaped = false; continue; }
    if (character === "\\" && quoted) { escaped = true; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === "(") depth += 1;
    else if (!quoted && character === ")") depth -= 1;
    else if (!quoted && depth === 0 && character === ",") { parts.push(body.slice(start, index)); start = index + 1; }
  }
  parts.push(body.slice(start)); return parts.filter((part) => part.trim());
}

export function parseConfigurationOptions(content: string): Record<string, string> {
  const body = content.match(/OptionSettings=\((.*)\)/s)?.[1]; if (body == null) return {};
  return Object.fromEntries(splitOptions(body).flatMap((part) => { const separator = part.indexOf("="); return separator > 0 ? [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]] : []; }));
}

export function serializeConfigurationOptions(options: Record<string, string>): string {
  return `[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(${Object.entries(options).map(([key, value]) => `${key}=${value}`).join(",")})\n`;
}

export function applyConfigurationOptions(content: string, changes: Record<string, string>): string {
  const match = content.match(/OptionSettings=\((.*)\)/s); if (!match || match.index == null) throw new Error("Configuration must contain OptionSettings=(...).");
  const tokens = splitOptions(match[1] ?? ""); const positions = new Map(tokens.map((part, index) => [part.slice(0, part.indexOf("=")).trim(), index]));
  for (const [key, value] of Object.entries(changes)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid configuration key: ${key}`);
    if (/[\r\n\0]/.test(value) || value.length > 8_192) throw new Error(`Invalid configuration value for ${key}.`);
    const token = `${key}=${value}`; const index = positions.get(key);
    if (index == null) { positions.set(key, tokens.length); tokens.push(token); } else tokens[index] = token;
  }
  const start = match.index + "OptionSettings=(".length; const end = start + (match[1]?.length ?? 0);
  const result = `${content.slice(0, start)}${tokens.join(",")}${content.slice(end)}`; validate(result); return result;
}

function decodeConfigurationString(value: string, key: string): string {
  try {
    const decoded: unknown = JSON.parse(value);
    if (typeof decoded === "string") return decoded;
  } catch { /* handled below */ }
  throw new Error(`${key} must be a quoted string.`);
}

export function managedWorldChangesFromConfiguration(content: string, world: WorldView): UpdateWorldInput {
  const options = parseConfigurationOptions(content);
  const patch: UpdateWorldInput = {};
  const assign = <K extends keyof UpdateWorldInput>(key: K, value: UpdateWorldInput[K]) => {
    if (JSON.stringify(world[key as keyof WorldView]) !== JSON.stringify(value)) patch[key] = value;
  };
  for (const [optionKey, worldKey] of [["RESTAPIEnabled", "restApiEnabled"], ["RCONEnabled", "rconEnabled"]] as const) {
    if (!Object.hasOwn(options, optionKey)) continue;
    const value = options[optionKey]!.toLowerCase();
    if (value !== "true" && value !== "false") throw new Error(`${optionKey} must be True or False.`);
    assign(worldKey, value === "true");
  }
  for (const [optionKey, worldKey] of [["RESTAPIPort", "restApiPort"], ["RCONPort", "rconPort"]] as const) {
    if (!Object.hasOwn(options, optionKey)) continue;
    const value = Number(options[optionKey]);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${optionKey} must be a port from 1 to 65535.`);
    assign(worldKey, value);
  }
  return patch;
}

export function configurationCredentials(content: string) {
  const options = parseConfigurationOptions(content);
  return {
    adminPassword: Object.hasOwn(options, "AdminPassword") ? decodeConfigurationString(options.AdminPassword!, "AdminPassword") : "",
    serverPassword: Object.hasOwn(options, "ServerPassword") ? decodeConfigurationString(options.ServerPassword!, "ServerPassword") : "",
  };
}

export async function readConfigurationCredentials(worldId: string) {
  return configurationCredentials((await readConfiguration(worldId)).content);
}

async function reconcileManagedWorldConfiguration(worldId: string, content: string) {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  const patch = managedWorldChangesFromConfiguration(content, world);
  if (Object.keys(patch).length) await updateWorld(worldId, patch);
}
async function snapshot(worldId: string, content: string, note: string) {
  await database().insert(configVersions).values({ id: randomUUID(), worldId, fileName: "PalWorldSettings.ini", content, note, createdAt: Date.now() });
  await pruneConfigurationVersions(worldId);
}
async function writeAtomic(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

export async function readConfiguration(worldId: string) {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  const filePath = configPath(world.installDir, world.platform);
  try { const content = await readFile(filePath, "utf8"); return { path: filePath, exists: true, content, running: world.status === "running", advertisedPort: advertisedPortState(parseConfigurationOptions(content).PublicPort, world.gamePort) }; }
  catch {
    try { return { path: filePath, exists: false, content: await readFile(defaultConfigurationPath(world.installDir), "utf8"), running: world.status === "running", advertisedPort: advertisedPortState(undefined, world.gamePort) }; }
    catch { return { path: filePath, exists: false, content: "", running: world.status === "running", advertisedPort: advertisedPortState(undefined, world.gamePort) }; }
  }
}

export async function saveConfiguration(worldId: string, content: string) {
  validate(content);
  await reconcileManagedWorldConfiguration(worldId, content);
  const current = await readConfiguration(worldId);
  if (current.exists && current.content) await snapshot(worldId, current.content, "before edit");
  await writeAtomic(current.path, content);
  await snapshot(worldId, content, "saved");
  await database().insert(events).values({ worldId, kind: "settings", message: "Edited PalWorldSettings.ini (restart to apply)", createdAt: Date.now() });
  return { path: current.path, running: current.running };
}

export async function readConfigurationOptions(worldId: string) {
  const configuration = await readConfiguration(worldId);
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  let shippedDefaults: { available: boolean; options: Record<string, string> } = { available: false, options: {} };
  let templateOptions: Record<string, string> = {};
  try {
    const content = await readFile(defaultConfigurationPath(world.installDir), "utf8");
    validate(content);
    templateOptions = parseConfigurationOptions(content);
    shippedDefaults = { available: true, options: Object.fromEntries(Object.entries(templateOptions).filter(([key]) => PALWORLD_SETTING_FIELD_MAP.has(key))) };
  } catch { /* A missing or malformed template is reported without inventing defaults. */ }
  const allActiveOptions = configuration.exists ? parseConfigurationOptions(configuration.content) : {};
  const activeOptions = Object.fromEntries(Object.entries(allActiveOptions).filter(([key]) => PALWORLD_SETTING_FIELD_MAP.has(key)));
  const knownKeys = new Set([...PALWORLD_SETTING_FIELD_MAP.keys(), ...PALWORLD_MANAGER_SETTING_KEYS]);
  const unknownActiveKeys = Object.keys(allActiveOptions).filter((key) => !knownKeys.has(key)).sort();
  const unknownDefaultKeys = Object.keys(templateOptions).filter((key) => !knownKeys.has(key)).sort();
  const missingDefaultKeys = shippedDefaults.available
    ? [...PALWORLD_SETTING_FIELD_MAP.keys()].filter((key) => !Object.hasOwn(shippedDefaults.options, key)).sort()
    : [];
  const [latest] = await database().select({ createdAt: configVersions.createdAt }).from(configVersions).where(eq(configVersions.worldId, worldId)).orderBy(desc(configVersions.createdAt)).limit(1);
  const restartRequired = world.status === "running" && Boolean(latest && latest.createdAt > (world.lastStartedAt ?? 0));
  return {
    path: configuration.path,
    exists: configuration.exists,
    running: configuration.running,
    options: activeOptions,
    shippedDefaults,
    schemaWarnings: { unknownActiveKeys, unknownDefaultKeys, missingDefaultKeys },
    restartRequired,
    advertisedPort: configuration.advertisedPort,
  };
}

export async function resolveShippedDefaultChanges(worldId: string, keys: readonly string[]): Promise<Record<string, string>> {
  if (!keys.length) return {};
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  let defaults: Record<string, string>;
  try {
    const content = await readFile(defaultConfigurationPath(world.installDir), "utf8");
    validate(content);
    defaults = parseConfigurationOptions(content);
  } catch { throw new Error("The shipped default configuration is unavailable or malformed."); }
  const managerKeys = new Set<string>(PALWORLD_MANAGER_SETTING_KEYS);
  return Object.fromEntries(keys.map((key) => {
    const field = PALWORLD_SETTING_FIELD_MAP.get(key);
    if (!field || managerKeys.has(key)) throw new Error(`Setting cannot be reset from the shipped template: ${key}`);
    if (!Object.hasOwn(defaults, key)) throw new Error(`The shipped template has no default for ${key}.`);
    if (decodeDefaultSettingValue(field, defaults[key]).status !== "valid") throw new Error(`The shipped template contains an unsupported default for ${key}.`);
    return [key, defaults[key]!];
  }));
}

export async function saveConfigurationOptions(worldId: string, changes: Record<string, string>, resetToDefaults: readonly string[] = []) {
  const configuration = await readConfiguration(worldId);
  const defaults = await resolveShippedDefaultChanges(worldId, resetToDefaults);
  return saveConfiguration(worldId, applyConfigurationOptions(configuration.content, { ...changes, ...defaults }));
}

type ManagedConfigurationOptions = { syncPublicPort?: boolean };
const managedConfigurationWorldFields = new Set(["restApiEnabled", "restApiPort", "rconEnabled", "rconPort"]);

export function needsManagedConfigurationSync(input: unknown): boolean {
  return Boolean(input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).some((key) => managedConfigurationWorldFields.has(key)));
}

export function managedConfigurationChanges(world: WorldView, options: ManagedConfigurationOptions = {}): Record<string, string> {
  const changes: Record<string, string> = {
    RESTAPIEnabled: world.restApiEnabled ? "True" : "False",
    RESTAPIPort: String(world.restApiPort),
    RCONEnabled: world.rconEnabled ? "True" : "False",
    RCONPort: String(world.rconPort),
  };
  // PublicPort advertises an external/community-server port; it does not set
  // the local game listener. Seed it for new installs and update it only when
  // the manager-owned game port itself changes, preserving tunnel/NAT values.
  if (options.syncPublicPort) changes.PublicPort = String(world.gamePort);
  return changes;
}

export async function syncManagedConfiguration(worldId: string, options: ManagedConfigurationOptions = {}) {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  const configuration = await readConfiguration(worldId);
  let source = configuration.content;
  let initialized = !configuration.exists;
  // Palworld creates an empty active file on first boot. Seed that file from
  // the shipped template so a fresh world has a complete, editable baseline.
  if (configuration.exists && !source.trim()) {
    try { source = await readFile(defaultConfigurationPath(world.installDir), "utf8"); initialized = true; }
    catch { return { synchronized: false, initialized: false, reason: "The shipped default configuration is not available yet." }; }
  }
  if (!source) return { synchronized: false, initialized: false, reason: "PalWorldSettings.ini is not available yet." };
  const changes = managedConfigurationChanges(world, { syncPublicPort: initialized || options.syncPublicPort });
  if (initialized && world.restApiEnabled) {
    const current = configurationCredentials(source).adminPassword;
    if (!current) changes.AdminPassword = JSON.stringify(randomBytes(18).toString("base64url"));
  }
  let content = applyConfigurationOptions(source, changes);
  if (initialized) {
    // Match the established PSM behavior: use the shipped template as data, not
    // as the active file verbatim. This drops its instructional comments and
    // writes the canonical two-line Palworld configuration.
    content = serializeConfigurationOptions(parseConfigurationOptions(content));
    validate(content);
    await writeAtomic(configuration.path, content);
    await snapshot(worldId, content, "initialized from shipped defaults");
    await database().insert(events).values({ worldId, kind: "settings", message: "Initialized PalWorldSettings.ini from the shipped defaults", createdAt: Date.now() });
    return { synchronized: true, initialized: true, path: configuration.path, running: configuration.running };
  }
  const result = await saveConfiguration(worldId, content);
  return { synchronized: true, initialized: false, ...result };
}

export async function listConfigurationVersions(worldId: string) {
  const records = await database().select().from(configVersions).where(eq(configVersions.worldId, worldId)).orderBy(desc(configVersions.createdAt)).limit(50);
  return records.map(({ content, ...record }) => ({ ...record, sizeBytes: Buffer.byteLength(content) }));
}

export async function restoreConfiguration(worldId: string, versionId: string) {
  const [version] = await database().select().from(configVersions).where(and(eq(configVersions.id, versionId), eq(configVersions.worldId, worldId))).limit(1);
  if (!version) throw new Error("Configuration version not found.");
  const current = await readConfiguration(worldId);
  if (current.exists && current.content) await snapshot(worldId, current.content, "before restore");
  validate(version.content); await reconcileManagedWorldConfiguration(worldId, version.content); await writeAtomic(current.path, version.content); await snapshot(worldId, version.content, `restored from ${versionId}`);
  await database().insert(events).values({ worldId, kind: "settings", message: `Restored PalWorldSettings.ini from ${versionId}`, createdAt: Date.now() });
  return { content: version.content, path: current.path, running: current.running };
}
