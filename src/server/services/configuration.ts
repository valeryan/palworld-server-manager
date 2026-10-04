import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { managedWorldSettingsSchema, type ManagedWorldSettings, type WorldView } from "@/contracts/world";
import { decodeDefaultSettingValue, PALWORLD_MANAGER_SETTING_KEYS, PALWORLD_SETTING_FIELD_MAP } from "@/contracts/palworld-settings";
import { database } from "@/server/db";
import { configVersions, events, worlds, worldSettings } from "@/server/db/schema";
import { canonicalInstallDir, getWorld, listWorlds, pathsOverlap } from "./worlds";
import { pruneConfigurationVersions } from "./retention";
import { withReservationLock } from "./reservations";

export type AdvertisedPortState = { mode: "inherit"; effectivePort: number } | { mode: "override"; effectivePort: number } | { mode: "invalid"; raw: string; effectivePort: number };
export class StaleSettingsRevisionError extends Error { constructor() { super("Settings changed since this page was loaded. Refresh and try again."); } }
const PORT_FIELDS = ["gamePort", "queryPort", "restApiPort", "rconPort"] as const;
const queues = new Map<string, Promise<unknown>>();

async function locked<T>(worldId: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(worldId) ?? Promise.resolve(); let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const marker = previous.catch(() => undefined).then(() => current); queues.set(worldId, marker);
  await previous.catch(() => undefined);
  try { return await work(); } finally { release(); if (queues.get(worldId) === marker) queues.delete(worldId); }
}

export function advertisedPortState(raw: string | undefined, gamePort: number): AdvertisedPortState {
  if (raw == null) return { mode: "inherit", effectivePort: gamePort }; const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return { mode: "invalid", raw, effectivePort: gamePort };
  return value === gamePort ? { mode: "inherit", effectivePort: gamePort } : { mode: "override", effectivePort: value };
}
export function managedPublicPortChange(previous: AdvertisedPortState, previousGamePort: number, nextGamePort: number, override: number | null | undefined, provided: boolean) {
  if (provided) return String(override ?? nextGamePort); if (previous.mode === "inherit" && previousGamePort !== nextGamePort) return String(nextGamePort); return undefined;
}
function optionalString(raw: string | undefined) { try { const value: unknown = raw == null ? undefined : JSON.parse(raw); return typeof value === "string" && value.trim() ? value.trim() : undefined; } catch { return undefined; } }
export function managedDisplayNameChange(previousName: string, previousRaw: string | undefined, nextRaw: string | undefined, override: string | null | undefined, provided: boolean) {
  const previous = optionalString(previousRaw); const next = optionalString(nextRaw);
  if (provided) { const value = override?.trim() || next; if (!value) throw new Error("Display Name cannot inherit until Server Name has a valid value."); if (value.length > 80) throw new Error("Display Name cannot exceed 80 characters; set a shorter Display Name override."); return value; }
  if (previous && next && previousName === previous && previous !== next) { if (next.length > 80) throw new Error("Display Name cannot exceed 80 characters; set a shorter Display Name override."); return next; }
  return undefined;
}
function configPath(installDir: string, platform: "linux" | "windows") { return path.join(/* turbopackIgnore: true */ installDir, "Pal", "Saved", "Config", platform === "windows" ? "WindowsServer" : "LinuxServer", "PalWorldSettings.ini"); }
export function defaultConfigurationPath(installDir: string) { return path.join(/* turbopackIgnore: true */ installDir, "DefaultPalWorldSettings.ini"); }

export function validateConfiguration(content: string) {
  if (Buffer.byteLength(content) > 2_000_000) throw new Error("Configuration exceeds the 2 MB safety limit.");
  if (content.includes("\0")) throw new Error("Configuration contains a NUL byte.");
  const match = content.match(/OptionSettings=\((.*)\)/s); if (!match) throw new Error("Configuration must contain OptionSettings=(...).");
  let quoted = false; let escaped = false; let depth = 0;
  for (const character of match[1] ?? "") { if (escaped) { escaped = false; continue; } if (character === "\\" && quoted) { escaped = true; continue; } if (character === '"') quoted = !quoted; else if (!quoted && character === "(") depth++; else if (!quoted && character === ")") depth--; if (depth < 0) throw new Error("OptionSettings contains unbalanced parentheses."); }
  if (quoted || depth !== 0) throw new Error("OptionSettings contains unbalanced quotes or parentheses.");
}
function splitOptions(body: string) {
  const parts: string[] = []; let start = 0; let quoted = false; let escaped = false; let depth = 0;
  for (let index = 0; index < body.length; index++) { const character = body[index]; if (escaped) { escaped = false; continue; } if (character === "\\" && quoted) { escaped = true; continue; } if (character === '"') { quoted = !quoted; continue; } if (!quoted && character === "(") depth++; else if (!quoted && character === ")") depth--; else if (!quoted && depth === 0 && character === ",") { parts.push(body.slice(start, index)); start = index + 1; } }
  parts.push(body.slice(start)); return parts.filter((part) => part.trim());
}
export function parseConfigurationOptions(content: string): Record<string, string> { const body = content.match(/OptionSettings=\((.*)\)/s)?.[1]; if (body == null) return {}; return Object.fromEntries(splitOptions(body).flatMap((part) => { const separator = part.indexOf("="); return separator > 0 ? [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]] : []; })); }
export function serializeConfigurationOptions(options: Record<string, string>) { return `[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(${Object.entries(options).map(([key, value]) => `${key}=${value}`).join(",")})\n`; }
export function applyConfigurationOptions(content: string, changes: Record<string, string>) {
  const match = content.match(/OptionSettings=\((.*)\)/s); if (!match || match.index == null) throw new Error("Configuration must contain OptionSettings=(...).");
  const tokens = splitOptions(match[1] ?? ""); const positions = new Map(tokens.map((part, index) => [part.slice(0, part.indexOf("=")).trim(), index]));
  for (const [key, value] of Object.entries(changes)) { if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid configuration key: ${key}`); if (/[\r\n\0]/.test(value) || value.length > 8_192) throw new Error(`Invalid configuration value for ${key}.`); const token = `${key}=${value}`; const index = positions.get(key); if (index == null) { positions.set(key, tokens.length); tokens.push(token); } else tokens[index] = token; }
  const start = match.index + "OptionSettings=(".length; const result = `${content.slice(0, start)}${tokens.join(",")}${content.slice(start + (match[1]?.length ?? 0))}`; validateConfiguration(result); return result;
}
function semanticHash(content: string) { validateConfiguration(content); return createHash("sha256").update(JSON.stringify(Object.entries(parseConfigurationOptions(content)).sort(([a], [b]) => a.localeCompare(b)))).digest("hex"); }
function decodeString(value: string, key: string) { try { const decoded: unknown = JSON.parse(value); if (typeof decoded === "string") return decoded; } catch { /* below */ } throw new Error(`${key} must be a quoted string.`); }
export function configurationCredentials(content: string) { const options = parseConfigurationOptions(content); return { adminPassword: Object.hasOwn(options, "AdminPassword") ? decodeString(options.AdminPassword!, "AdminPassword") : "", serverPassword: Object.hasOwn(options, "ServerPassword") ? decodeString(options.ServerPassword!, "ServerPassword") : "" }; }
export function managedWorldChangesFromConfiguration(content: string) {
  const options = parseConfigurationOptions(content); const patch: Record<string, boolean | number> = {};
  for (const [option, field] of [["RESTAPIEnabled", "restApiEnabled"], ["RCONEnabled", "rconEnabled"]] as const) { if (!Object.hasOwn(options, option)) continue; const raw = options[option]!.toLowerCase(); if (raw !== "true" && raw !== "false") throw new Error(`${option} must be True or False.`); patch[field] = raw === "true"; }
  for (const [option, field] of [["RESTAPIPort", "restApiPort"], ["RCONPort", "rconPort"]] as const) { if (!Object.hasOwn(options, option)) continue; const value = Number(options[option]); if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${option} must be a port from 1 to 65535.`); patch[field] = value; }
  return patch;
}

function managerFromWorld(world: WorldView): ManagedWorldSettings { return managedWorldSettingsSchema.parse({ displayName: world.displayName, installDir: world.installDir, platform: world.platform, gamePort: world.gamePort, queryPort: world.queryPort, restApiPort: world.restApiPort, rconPort: world.rconPort, restApiEnabled: world.restApiEnabled, rconEnabled: world.rconEnabled, communityServer: world.communityServer, autostart: world.autostart, crashGuard: world.crashGuard, legacyPerfFlags: world.legacyPerfFlags, extraArgs: world.extraArgs, env: world.env, wineBinary: world.wineBinary, winePrefix: world.winePrefix, wineLaunchFlags: world.wineLaunchFlags }); }
async function readOptional(filePath: string) { try { return await readFile(filePath, "utf8"); } catch { return null; } }
type SettingsRow = typeof worldSettings.$inferSelect;
function managerFromRow(row: SettingsRow) { return managedWorldSettingsSchema.parse(row.desiredManager); }

async function bootstrapUnlocked(worldId: string): Promise<SettingsRow> {
  const [existing] = await database().select().from(worldSettings).where(eq(worldSettings.worldId, worldId)).limit(1); if (existing) return existing;
  const world = await getWorld(worldId); if (!world) throw new Error("World not found."); const manager = managerFromWorld(world);
  const active = await readOptional(configPath(world.installDir, world.platform)); const activeHasContent = Boolean(active?.trim()); const template = !activeHasContent ? await readOptional(defaultConfigurationPath(world.installDir)) : null; const now = Date.now();
  let desired = activeHasContent ? active! : template ?? ""; const applied = activeHasContent ? active! : ""; let hash: string | null = null; let pending = !activeHasContent; let drift = false; let error: string | null = null;
  try { if (activeHasContent) hash = semanticHash(active!); if (desired) { validateConfiguration(desired); const credentials = configurationCredentials(desired); const changes: Record<string, string> = {}; if (!credentials.adminPassword && world.adminPassword) changes.AdminPassword = JSON.stringify(world.adminPassword); if (!credentials.serverPassword && world.serverPassword) changes.ServerPassword = JSON.stringify(world.serverPassword); if (Object.keys(changes).length) { desired = applyConfigurationOptions(desired, changes); pending = true; } } }
  catch (cause) { drift = true; pending = true; error = `Existing PalWorldSettings.ini is malformed: ${cause instanceof Error ? cause.message : String(cause)}`; desired = activeHasContent ? active! : template ?? ""; }
  if (!desired) { drift = true; pending = true; error = "PalWorldSettings.ini and its shipped template are unavailable."; }
  database().transaction((tx) => { tx.insert(worldSettings).values({ worldId, desiredManager: manager, desiredContent: desired, appliedContent: applied, desiredRevision: 1, appliedRevision: pending ? 0 : 1, appliedSemanticHash: hash, pendingSince: pending ? now : null, lastApplyError: error, drift, driftReason: drift ? error : null, updatedAt: now, appliedAt: pending ? null : now }).onConflictDoNothing().run(); if (!drift) tx.update(worlds).set({ adminPassword: "", serverPassword: "" }).where(eq(worlds.id, worldId)).run(); });
  const [created] = await database().select().from(worldSettings).where(eq(worldSettings.worldId, worldId)).limit(1); if (!created) throw new Error("Failed to initialize world settings."); return created;
}
export async function bootstrapWorldSettings(worldId?: string) { if (worldId) { await locked(worldId, () => bootstrapUnlocked(worldId)); return; } for (const world of await listWorlds()) await locked(world.id, () => bootstrapUnlocked(world.id)); }
async function rowFor(worldId: string) { return locked(worldId, () => bootstrapUnlocked(worldId)); }
async function rowUnlocked(worldId: string) { const [row] = await database().select().from(worldSettings).where(eq(worldSettings.worldId, worldId)).limit(1); return row; }
async function writeAtomic(filePath: string, content: string) { await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 }); const temporary = `${filePath}.tmp-${randomUUID()}`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, filePath); await chmod(filePath, 0o600); }
function state(row: SettingsRow, world: WorldView) { const pendingApply = row.desiredRevision !== row.appliedRevision || row.drift; return { desiredRevision: row.desiredRevision, appliedRevision: row.appliedRevision, pendingApply, requiresRestart: pendingApply && ["running", "starting", "stopping"].includes(world.status), drift: row.drift, driftReason: row.driftReason, applyError: row.lastApplyError }; }
function projection(manager: ManagedWorldSettings) { return { displayName: manager.displayName, installDir: manager.installDir, platform: manager.platform, gamePort: manager.gamePort, queryPort: manager.queryPort, restApiPort: manager.restApiPort, rconPort: manager.rconPort, restApiEnabled: manager.restApiEnabled, rconEnabled: manager.rconEnabled, communityServer: manager.communityServer, autostart: manager.autostart, crashGuard: manager.crashGuard, legacyPerfFlags: manager.legacyPerfFlags, extraArgs: manager.extraArgs, environment: manager.env, wineBinary: manager.wineBinary, winePrefix: manager.winePrefix, wineLaunchFlags: manager.wineLaunchFlags }; }

async function validateReservations(worldId: string, candidate: ManagedWorldSettings) {
  const desiredRows = await database().select().from(worldSettings); const desired = new Map(desiredRows.map((row) => [row.worldId, managerFromRow(row)]));
  const candidatePath = await canonicalInstallDir(candidate.installDir);
  for (const other of await listWorlds()) { if (other.id === worldId) continue; for (const settings of [managerFromWorld(other), desired.get(other.id)].filter(Boolean) as ManagedWorldSettings[]) { if (pathsOverlap(candidatePath, await canonicalInstallDir(settings.installDir))) throw new Error(`Install directory overlaps with ${other.displayName}: ${settings.installDir}`); for (const field of PORT_FIELDS) for (const otherField of PORT_FIELDS) if (candidate[field] === settings[otherField]) throw new Error(`Port ${candidate[field]} is reserved by ${other.displayName} (${otherField}).`); } }
  if (new Set(PORT_FIELDS.map((field) => candidate[field])).size !== PORT_FIELDS.length) throw new Error("A world cannot reuse the same port for multiple services.");
}
async function markFailure(worldId: string, message: string, drift = false) { await database().update(worldSettings).set({ lastApplyError: message, drift, driftReason: drift ? message : null, pendingSince: Date.now(), updatedAt: Date.now() }).where(eq(worldSettings.worldId, worldId)); }
async function applyUnlocked(worldId: string, force = false) {
  const row = await bootstrapUnlocked(worldId); const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  if (["running", "starting", "stopping"].includes(world.status) || world.processId) return state(row, world);
  const manager = managerFromRow(row);
  try {
    validateConfiguration(row.desiredContent); const currentPath = configPath(world.installDir, world.platform); const targetPath = configPath(manager.installDir, manager.platform); const disk = await readOptional(currentPath);
    let diskHash: string | null = null;
    if (disk?.trim() && !force) {
      try { diskHash = semanticHash(disk); }
      catch { const message = "PalWorldSettings.ini is malformed. Import a valid file or reapply desired settings before starting."; await markFailure(worldId, message, true); return state((await rowUnlocked(worldId))!, world); }
    }
    const desiredHash = semanticHash(row.desiredContent);
    if (!force && row.drift) return state(row, world);
    if (!force && row.appliedSemanticHash && diskHash !== row.appliedSemanticHash && diskHash !== desiredHash) { const message = "PalWorldSettings.ini was changed outside the manager or removed. Import it or reapply desired settings before starting."; await markFailure(worldId, message, true); return state((await rowUnlocked(worldId))!, world); }
    if (!force && path.resolve(/* turbopackIgnore: true */ targetPath) !== path.resolve(/* turbopackIgnore: true */ currentPath)) {
      const targetDisk = await readOptional(targetPath);
      if (targetDisk?.trim()) {
        let targetHash: string;
        try { targetHash = semanticHash(targetDisk); }
        catch { const message = "The destination PalWorldSettings.ini is malformed. Remove it or explicitly reapply desired settings before moving this world."; await markFailure(worldId, message, true); return state((await rowUnlocked(worldId))!, world); }
        if (targetHash !== desiredHash) { const message = "The destination already contains a different PalWorldSettings.ini. Import it or explicitly reapply desired settings before moving this world."; await markFailure(worldId, message, true); return state((await rowUnlocked(worldId))!, world); }
      }
    }
    if (row.desiredRevision === row.appliedRevision && !row.drift) return state(row, world);
    await writeAtomic(targetPath, row.desiredContent); const verified = await readFile(targetPath, "utf8"); if (semanticHash(verified) !== semanticHash(row.desiredContent)) throw new Error("Configuration readback did not match the desired option values.");
    const now = Date.now(); const hash = semanticHash(verified);
    database().transaction((tx) => { tx.update(worlds).set({ ...projection(manager), adminPassword: "", serverPassword: "", updatedAt: now }).where(eq(worlds.id, worldId)).run(); tx.update(worldSettings).set({ appliedContent: verified, appliedRevision: row.desiredRevision, appliedSemanticHash: hash, pendingSince: null, lastApplyError: null, drift: false, driftReason: null, appliedAt: now, updatedAt: now }).where(eq(worldSettings.worldId, worldId)).run(); tx.insert(events).values({ worldId, kind: "settings", message: `Applied settings revision ${row.desiredRevision}`, createdAt: now }).run(); });
    return state((await rowUnlocked(worldId))!, (await getWorld(worldId))!);
  } catch (cause) { await markFailure(worldId, cause instanceof Error ? cause.message : String(cause), row.drift || force); return state((await rowUnlocked(worldId))!, world); }
}
export async function applyDesiredSettings(worldId: string, options: { force?: boolean } = {}) { return locked(worldId, () => applyUnlocked(worldId, options.force)); }
export async function prepareWorldStart<T>(worldId: string, claim: (world: WorldView) => Promise<T>) {
  return locked(worldId, async () => {
    const application = await applyUnlocked(worldId);
    if (application.pendingApply) throw new Error(`Server start blocked because settings could not be applied${application.applyError ? `: ${application.applyError}` : "."}`);
    const world = await getWorld(worldId);
    if (!world) throw new Error("World not found.");
    if (["running", "starting", "stopping"].includes(world.status) || world.processId) throw new Error("World is already running or changing state.");
    return claim(world);
  });
}
export async function readSettingsState(worldId: string) { const row = await rowFor(worldId); const world = await getWorld(worldId); if (!world) throw new Error("World not found."); return { ...state(row, world), desiredManager: managerFromRow(row), appliedManager: managerFromWorld(world), desiredContent: row.desiredContent, appliedContent: row.appliedContent }; }

export async function saveDesiredSettings(worldId: string, input: { baseRevision: number; manager: ManagedWorldSettings; content: string; note?: string }) {
  return locked(worldId, async () => { const row = await bootstrapUnlocked(worldId); if (row.desiredRevision !== input.baseRevision) throw new StaleSettingsRevisionError(); const parsedManager = managedWorldSettingsSchema.parse(input.manager); validateConfiguration(input.content); const now = Date.now(); const revision = row.desiredRevision + 1; let manager!: ManagedWorldSettings;
    await withReservationLock(async () => { manager = managedWorldSettingsSchema.parse({ ...parsedManager, installDir: await canonicalInstallDir(parsedManager.installDir) }); await validateReservations(worldId, manager); database().transaction((tx) => { tx.update(worldSettings).set({ desiredManager: manager, desiredContent: input.content, desiredRevision: revision, pendingSince: row.pendingSince ?? now, lastApplyError: null, updatedAt: now }).where(eq(worldSettings.worldId, worldId)).run(); tx.insert(configVersions).values({ id: randomUUID(), worldId, fileName: "PalWorldSettings.ini", content: input.content, note: input.note ?? `desired revision ${revision}`, createdAt: now }).run(); tx.insert(events).values({ worldId, kind: "settings", message: `Saved desired settings revision ${revision}`, createdAt: now }).run(); }); }); await pruneConfigurationVersions(worldId).catch(() => undefined);
    const world = await getWorld(worldId); if (!world) throw new Error("World not found."); return ["running", "starting", "stopping"].includes(world.status) || world.processId ? state((await rowUnlocked(worldId))!, world) : applyUnlocked(worldId);
  });
}
export async function readConfigurationCredentials(worldId: string) { return configurationCredentials((await rowFor(worldId)).appliedContent); }
export async function readConfiguration(worldId: string) { const row = await rowFor(worldId); const world = await getWorld(worldId); if (!world) throw new Error("World not found."); const manager = managerFromRow(row); return { path: configPath(manager.installDir, manager.platform), exists: Boolean(row.desiredContent), content: row.desiredContent, running: world.status === "running", advertisedPort: advertisedPortState(parseConfigurationOptions(row.appliedContent).PublicPort, world.gamePort), ...state(row, world) }; }
export async function saveConfiguration(worldId: string, content: string, baseRevision?: number) { const current = await readSettingsState(worldId); const manager = managedWorldSettingsSchema.parse({ ...current.desiredManager, ...managedWorldChangesFromConfiguration(content) }); return saveDesiredSettings(worldId, { baseRevision: baseRevision ?? current.desiredRevision, manager, content, note: "saved" }); }

export async function readConfigurationOptions(worldId: string) {
  const row = await rowFor(worldId); const world = await getWorld(worldId); if (!world) throw new Error("World not found."); const desiredManager = managerFromRow(row); let templateOptions: Record<string, string> = {}; let available = false;
  try { const content = await readFile(defaultConfigurationPath(desiredManager.installDir), "utf8"); validateConfiguration(content); templateOptions = parseConfigurationOptions(content); available = true; } catch { /* reported */ }
  const desiredAll = parseConfigurationOptions(row.desiredContent); const appliedAll = parseConfigurationOptions(row.appliedContent); const known = new Set([...PALWORLD_SETTING_FIELD_MAP.keys(), ...PALWORLD_MANAGER_SETTING_KEYS]);
  return { path: configPath(desiredManager.installDir, desiredManager.platform), exists: Boolean(row.desiredContent), running: world.status === "running", options: Object.fromEntries(Object.entries(desiredAll).filter(([key]) => PALWORLD_SETTING_FIELD_MAP.has(key))), appliedOptions: Object.fromEntries(Object.entries(appliedAll).filter(([key]) => PALWORLD_SETTING_FIELD_MAP.has(key))), desiredManager, appliedManager: managerFromWorld(world), shippedDefaults: { available, options: Object.fromEntries(Object.entries(templateOptions).filter(([key]) => PALWORLD_SETTING_FIELD_MAP.has(key))) }, schemaWarnings: { unknownActiveKeys: Object.keys(desiredAll).filter((key) => !known.has(key)).sort(), unknownDefaultKeys: Object.keys(templateOptions).filter((key) => !known.has(key)).sort(), missingDefaultKeys: available ? [...PALWORLD_SETTING_FIELD_MAP.keys()].filter((key) => !Object.hasOwn(templateOptions, key)).sort() : [] }, restartRequired: state(row, world).requiresRestart, advertisedPort: advertisedPortState(desiredAll.PublicPort, desiredManager.gamePort), appliedAdvertisedPort: advertisedPortState(appliedAll.PublicPort, world.gamePort), ...state(row, world) };
}
export async function resolveShippedDefaultChanges(worldId: string, keys: readonly string[]) { if (!keys.length) return {}; const current = await readSettingsState(worldId); let defaults: Record<string, string>; try { const content = await readFile(defaultConfigurationPath(current.desiredManager.installDir), "utf8"); validateConfiguration(content); defaults = parseConfigurationOptions(content); } catch { throw new Error("The shipped default configuration is unavailable or malformed."); } const managers = new Set<string>(PALWORLD_MANAGER_SETTING_KEYS); return Object.fromEntries(keys.map((key) => { const field = PALWORLD_SETTING_FIELD_MAP.get(key); if (!field || managers.has(key)) throw new Error(`Setting cannot be reset from the shipped template: ${key}`); if (!Object.hasOwn(defaults, key)) throw new Error(`The shipped template has no default for ${key}.`); if (decodeDefaultSettingValue(field, defaults[key]).status !== "valid") throw new Error(`The shipped template contains an unsupported default for ${key}.`); return [key, defaults[key]!]; })); }
export async function saveConfigurationOptions(worldId: string, changes: Record<string, string>, reset: readonly string[] = [], baseRevision?: number) { const current = await readConfiguration(worldId); return saveConfiguration(worldId, applyConfigurationOptions(current.content, { ...changes, ...await resolveShippedDefaultChanges(worldId, reset) }), baseRevision); }
type ManagedConfigurationOptions = { syncPublicPort?: boolean };
const managedFields = new Set(["restApiEnabled", "restApiPort", "rconEnabled", "rconPort"]);
export function needsManagedConfigurationSync(input: unknown) { return Boolean(input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).some((key) => managedFields.has(key))); }
export function managedConfigurationChanges(world: Pick<ManagedWorldSettings, "restApiEnabled" | "restApiPort" | "rconEnabled" | "rconPort" | "gamePort">, options: ManagedConfigurationOptions = {}) { const changes: Record<string, string> = { RESTAPIEnabled: world.restApiEnabled ? "True" : "False", RESTAPIPort: String(world.restApiPort), RCONEnabled: world.rconEnabled ? "True" : "False", RCONPort: String(world.rconPort) }; if (options.syncPublicPort) changes.PublicPort = String(world.gamePort); return changes; }
export async function syncManagedConfiguration(worldId: string, options: ManagedConfigurationOptions = {}) { const current = await readSettingsState(worldId); let source = current.desiredContent; const initialized = !current.appliedContent.trim(); if (!source.trim()) source = await readOptional(defaultConfigurationPath(current.desiredManager.installDir)) ?? ""; if (!source) return { synchronized: false, initialized: false, reason: "The shipped default configuration is not available yet." }; const changes = managedConfigurationChanges(current.desiredManager, { syncPublicPort: initialized || options.syncPublicPort }); if (initialized) { const world = await getWorld(worldId); if (!world) throw new Error("World not found."); const credentials = configurationCredentials(source); if (!credentials.adminPassword && world.adminPassword) changes.AdminPassword = JSON.stringify(world.adminPassword); if (!credentials.serverPassword && world.serverPassword) changes.ServerPassword = JSON.stringify(world.serverPassword); if (current.desiredManager.restApiEnabled && !credentials.adminPassword && !world.adminPassword) changes.AdminPassword = JSON.stringify(randomBytes(18).toString("base64url")); } let content = applyConfigurationOptions(source, changes); if (initialized) content = serializeConfigurationOptions(parseConfigurationOptions(content)); const saved = await saveDesiredSettings(worldId, { baseRevision: current.desiredRevision, manager: current.desiredManager, content, note: initialized ? "initialized from shipped defaults" : "synchronized manager settings" }); const application = initialized && current.drift ? await applyDesiredSettings(worldId, { force: true }) : saved; return { synchronized: true, initialized, ...application }; }
export async function listConfigurationVersions(worldId: string) { const records = await database().select().from(configVersions).where(eq(configVersions.worldId, worldId)).orderBy(desc(configVersions.createdAt)).limit(50); return records.map(({ content, ...record }) => ({ ...record, sizeBytes: Buffer.byteLength(content) })); }
export async function restoreConfiguration(worldId: string, versionId: string, baseRevision?: number) { const [version] = await database().select().from(configVersions).where(and(eq(configVersions.id, versionId), eq(configVersions.worldId, worldId))).limit(1); if (!version) throw new Error("Configuration version not found."); const current = await readSettingsState(worldId); validateConfiguration(version.content); const manager = managedWorldSettingsSchema.parse({ ...current.desiredManager, ...managedWorldChangesFromConfiguration(version.content) }); return { ...await saveDesiredSettings(worldId, { baseRevision: baseRevision ?? current.desiredRevision, manager, content: version.content, note: `restored from ${versionId}` }), content: version.content }; }
export async function reconcileConfiguration(worldId: string, action: "import-file" | "reapply-desired") { return locked(worldId, async () => { const row = await bootstrapUnlocked(worldId); const world = await getWorld(worldId); if (!world) throw new Error("World not found."); if (["running", "starting", "stopping"].includes(world.status) || world.processId) throw new Error("Stop the world before reconciling its configuration file."); if (action === "reapply-desired") return applyUnlocked(worldId, true); const previousManager = managerFromRow(row); const content = await readFile(configPath(previousManager.installDir, previousManager.platform), "utf8"); validateConfiguration(content); const manager = managedWorldSettingsSchema.parse({ ...previousManager, ...managedWorldChangesFromConfiguration(content) }); const now = Date.now(); const revision = row.desiredRevision + 1; await withReservationLock(async () => { await validateReservations(worldId, manager); database().transaction((tx) => { tx.update(worlds).set({ ...projection(manager), adminPassword: "", serverPassword: "", updatedAt: now }).where(eq(worlds.id, worldId)).run(); tx.update(worldSettings).set({ desiredManager: manager, desiredContent: content, appliedContent: content, desiredRevision: revision, appliedRevision: revision, appliedSemanticHash: semanticHash(content), pendingSince: null, lastApplyError: null, drift: false, driftReason: null, updatedAt: now, appliedAt: now }).where(eq(worldSettings.worldId, worldId)).run(); tx.insert(configVersions).values({ id: randomUUID(), worldId, fileName: "PalWorldSettings.ini", content, note: "imported external file", createdAt: now }).run(); }); }); return state((await rowUnlocked(worldId))!, (await getWorld(worldId))!); }); }

export async function adoptRestoredConfiguration(worldId: string, content: string, replaceFilesystem?: () => Promise<() => Promise<void>>) {
  validateConfiguration(content);
  return locked(worldId, async () => {
    const row = await bootstrapUnlocked(worldId); const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
    if (["running", "starting", "stopping"].includes(world.status) || world.processId) throw new Error("Stop the server before restoring a backup.");
    // The backup was restored into the applied world's save tree. Discard any
    // unrelated staged manager projection so the adopted database state points
    // at the filesystem that was actually replaced.
    const manager = managedWorldSettingsSchema.parse({ ...managerFromWorld(world), ...managedWorldChangesFromConfiguration(content) }); const now = Date.now(); const revision = row.desiredRevision + 1;
    await withReservationLock(async () => {
      await validateReservations(worldId, manager);
      const rollback = await replaceFilesystem?.();
      try { database().transaction((tx) => {
        tx.update(worlds).set({ ...projection(manager), adminPassword: "", serverPassword: "", updatedAt: now }).where(eq(worlds.id, worldId)).run();
        tx.update(worldSettings).set({ desiredManager: manager, desiredContent: content, appliedContent: content, desiredRevision: revision, appliedRevision: revision, appliedSemanticHash: semanticHash(content), pendingSince: null, lastApplyError: null, drift: false, driftReason: null, updatedAt: now, appliedAt: now }).where(eq(worldSettings.worldId, worldId)).run();
        tx.insert(configVersions).values({ id: randomUUID(), worldId, fileName: "PalWorldSettings.ini", content, note: "adopted from backup restore", createdAt: now }).run();
      }); } catch (cause) {
        if (rollback) {
          try { await rollback(); }
          catch (rollbackCause) { throw new AggregateError([cause, rollbackCause], "Configuration adoption failed and the previous save tree could not be restored."); }
        }
        throw cause;
      }
    });
    return state((await rowUnlocked(worldId))!, (await getWorld(worldId))!);
  });
}
