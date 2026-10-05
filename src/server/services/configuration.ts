import { validateConfiguration, parseConfigurationOptions, serializeConfigurationOptions, applyConfigurationOptions, configurationCredentials, configurationIsValid } from "@/lib/palworld-ini";
export { validateConfiguration, parseConfigurationOptions, serializeConfigurationOptions, applyConfigurationOptions, configurationCredentials, configurationIsValid } from "@/lib/palworld-ini";
import { privateFile } from "@/server/host";
import "server-only";
import { assertSupportedTarget } from "@/server/host";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readOptional, writeFileAtomic } from "@/server/fs";
import { and, desc, eq } from "drizzle-orm";
import { managedWorldSettingsSchema, pickManaged, worldBusy, type AdvertisedPortState, type ManagedWorldSettings, type WorldView } from "@/contracts/world";
import { ConflictError } from "@/server/errors";
import { serialize } from "@/server/serialize";
import { decodeDefaultSettingValue, PALWORLD_MANAGER_SETTING_KEYS, PALWORLD_SETTING_FIELD_MAP, validateAndEncodeSettingChanges } from "@/contracts/palworld-settings";
import type { AdministrationRequest } from "@/contracts/world-administration";
import { parseWorldUpdate } from "@/contracts/world";
import { database } from "@/server/db";
import { configVersions, events, worlds, worldSettings } from "@/server/db/schema";
import { assertReservationsFree, assertWorldOwnership, canonicalInstallDir, getWorld, listWorlds, requireWorld, toWorldColumns } from "./worlds";
import { pruneConfigurationVersions } from "./retention";
import { withReservationLock } from "./reservations";
import { trackActiveChange } from "./jobs";
export type { AdvertisedPortState };
export class StaleSettingsRevisionError extends ConflictError {
  constructor() {
    super("Settings changed since this page was loaded. Refresh and try again.");
  }
}
type Transaction = Parameters<Parameters<ReturnType<typeof database>["transaction"]>[0]>[0];
// Per-world settings lock. It is not re-entrant: nothing inside `work` may call another locked
// function for the same world (that includes the REST client, which reads credentials under it).
async function locked<T>(worldId: string, work: () => Promise<T>): Promise<T> {
  return trackActiveChange(() => serialize(`settings:${worldId}`, work));
}
export function advertisedPortState(raw: string | undefined, gamePort: number): AdvertisedPortState {
  if (raw == null) return {
    mode: "inherit",
    effectivePort: gamePort
  };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return {
    mode: "invalid",
    raw,
    effectivePort: gamePort
  };
  return value === gamePort ? {
    mode: "inherit",
    effectivePort: gamePort
  } : {
    mode: "override",
    effectivePort: value
  };
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
  } catch {
    return undefined;
  }
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
export function configPath(installDir: string, platform: "linux" | "windows") {
  return path.join(/* turbopackIgnore: true */installDir, "Pal", "Saved", "Config", platform === "windows" ? "WindowsServer" : "LinuxServer", "PalWorldSettings.ini");
}
export function defaultConfigurationPath(installDir: string) {
  return path.join(/* turbopackIgnore: true */installDir, "DefaultPalWorldSettings.ini");
}
function semanticHash(content: string) {
  validateConfiguration(content);
  return createHash("sha256").update(JSON.stringify(Object.entries(parseConfigurationOptions(content)).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}
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
function managerFromWorld(world: WorldView): ManagedWorldSettings {
  return managedWorldSettingsSchema.parse(pickManaged(world));
}
// The shipped DefaultPalWorldSettings.ini as parsed options, or null when it is absent or malformed.
async function readShippedDefaults(installDir: string): Promise<Record<string, string> | null> {
  try {
    const content = await readFile(defaultConfigurationPath(installDir), "utf8");
    validateConfiguration(content);
    return parseConfigurationOptions(content);
  } catch {
    return null;
  }
}
// Game credentials live only in the INI. Copies left in the registry by older builds are carried
// over once, when the INI has none of its own.
function legacyCredentialChanges(content: string, world: Pick<WorldView, "adminPassword" | "serverPassword">): Record<string, string> {
  const credentials = configurationCredentials(content);
  const changes: Record<string, string> = {};
  if (!credentials.adminPassword && world.adminPassword) changes.AdminPassword = JSON.stringify(world.adminPassword);
  if (!credentials.serverPassword && world.serverPassword) changes.ServerPassword = JSON.stringify(world.serverPassword);
  return changes;
}
// Records a configuration that is on disk and in effect: desired and applied both move to `revision`.
function commitApplied(tx: Transaction, worldId: string, manager: ManagedWorldSettings, content: string, revision: number, now: number, note: string) {
  tx.update(worlds).set({
    ...projection(manager),
    adminPassword: "",
    serverPassword: "",
    updatedAt: now
  }).where(eq(worlds.id, worldId)).run();
  tx.update(worldSettings).set({
    desiredManager: manager,
    desiredContent: content,
    appliedContent: content,
    desiredRevision: revision,
    appliedRevision: revision,
    managerAppliedRevision: revision,
    appliedSemanticHash: semanticHash(content),
    pendingSince: null,
    lastApplyError: null,
    drift: false,
    driftReason: null,
    updatedAt: now,
    appliedAt: now
  }).where(eq(worldSettings.worldId, worldId)).run();
  tx.insert(configVersions).values({
    id: randomUUID(),
    worldId,
    fileName: "PalWorldSettings.ini",
    content,
    note,
    createdAt: now
  }).run();
}
type SettingsRow = typeof worldSettings.$inferSelect;
function managerFromRow(row: SettingsRow) {
  return managedWorldSettingsSchema.parse(row.desiredManager);
}
async function bootstrapUnlocked(worldId: string): Promise<SettingsRow> {
  const [existing] = await database().select().from(worldSettings).where(eq(worldSettings.worldId, worldId)).limit(1);
  if (existing) return existing;
  const world = await requireWorld(worldId);
  const manager = managerFromWorld(world);
  const active = await readOptional(configPath(world.installDir, world.platform));
  const activeHasContent = Boolean(active?.trim());
  const template = !activeHasContent ? await readOptional(defaultConfigurationPath(world.installDir)) : null;
  const now = Date.now();
  let desired = activeHasContent ? active! : template ?? "";
  const applied = activeHasContent ? active! : "";
  let hash: string | null = null;
  let pending = !activeHasContent;
  let drift = false;
  let error: string | null = null;
  try {
    if (activeHasContent) hash = semanticHash(active!);
    if (desired) {
      validateConfiguration(desired);
      const changes = legacyCredentialChanges(desired, world);
      if (Object.keys(changes).length) {
        desired = applyConfigurationOptions(desired, changes);
        pending = true;
      }
    }
  } catch (cause) {
    drift = true;
    pending = true;
    error = `Existing PalWorldSettings.ini is malformed: ${cause instanceof Error ? cause.message : String(cause)}`;
    desired = activeHasContent ? active! : template ?? "";
  }
  if (!desired) {
    drift = true;
    pending = true;
    error = "PalWorldSettings.ini and its shipped template are unavailable.";
  }
  database().transaction(tx => {
    tx.insert(worldSettings).values({
      worldId,
      desiredManager: manager,
      desiredContent: desired,
      appliedContent: applied,
      desiredRevision: 1,
      appliedRevision: pending ? 0 : 1,
      managerAppliedRevision: pending ? 0 : 1,
      appliedSemanticHash: hash,
      pendingSince: pending ? now : null,
      lastApplyError: error,
      drift,
      driftReason: drift ? error : null,
      updatedAt: now,
      appliedAt: pending ? null : now
    }).onConflictDoNothing().run();
    if (!drift) tx.update(worlds).set({
      adminPassword: "",
      serverPassword: ""
    }).where(eq(worlds.id, worldId)).run();
  });
  const [created] = await database().select().from(worldSettings).where(eq(worldSettings.worldId, worldId)).limit(1);
  if (!created) throw new Error("Failed to initialize world settings.");
  return created;
}
export async function bootstrapWorldSettings(worldId?: string) {
  if (worldId) {
    await locked(worldId, () => bootstrapUnlocked(worldId));
    return;
  }
  for (const world of await listWorlds()) await locked(world.id, () => bootstrapUnlocked(world.id));
}
async function rowFor(worldId: string) {
  return locked(worldId, () => bootstrapUnlocked(worldId));
}
async function rowUnlocked(worldId: string) {
  const [row] = await database().select().from(worldSettings).where(eq(worldSettings.worldId, worldId)).limit(1);
  return row;
}
async function writeAtomic(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFileAtomic(filePath, content, { mode: 0o600 });
  await privateFile(filePath);
}
function state(row: SettingsRow, world: WorldView) {
  const pendingApply = row.desiredRevision !== row.appliedRevision || row.drift;
  return {
    desiredRevision: row.desiredRevision,
    appliedRevision: row.appliedRevision,
    managerAppliedRevision: row.managerAppliedRevision,
    configurationAvailable: configurationIsValid(row.desiredContent),
    pendingApply,
    requiresRestart: pendingApply && worldBusy(world),
    drift: row.drift,
    driftReason: row.driftReason,
    applyError: row.lastApplyError
  };
}
// The managed settings as `worlds` columns.
function projection(manager: ManagedWorldSettings) { return toWorldColumns(manager, "legacy"); }
async function validateReservations(worldId: string, candidate: ManagedWorldSettings) {
  assertSupportedTarget(candidate.platform);
  await assertWorldOwnership(candidate);
  await assertReservationsFree(candidate, worldId);
}
async function markFailure(worldId: string, message: string, drift = false) {
  await database().update(worldSettings).set({
    lastApplyError: message,
    drift,
    driftReason: drift ? message : null,
    pendingSince: Date.now(),
    updatedAt: Date.now()
  }).where(eq(worldSettings.worldId, worldId));
}
async function applyUnlocked(worldId: string, force = false) {
  const row = await bootstrapUnlocked(worldId);
  const world = await requireWorld(worldId);
  // Ownership marked unknown is treated as live: the file is never rewritten under a server that may still be running.
  if (worldBusy(world, { includeUnknown: true })) return state(row, world);
  const manager = managerFromRow(row);
  const failApply = async (message: string) => {
    await markFailure(worldId, message, true);
    return state((await rowUnlocked(worldId))!, world);
  };
  try {
    validateConfiguration(row.desiredContent);
    const currentPath = configPath(world.installDir, world.platform);
    const targetPath = configPath(manager.installDir, manager.platform);
    const disk = await readOptional(currentPath);
    let diskHash: string | null = null;
    if (disk?.trim() && !force) {
      try {
        diskHash = semanticHash(disk);
      } catch {
        return failApply("PalWorldSettings.ini is malformed. Import a valid file or reapply desired settings before starting.");
      }
    }
    const desiredHash = semanticHash(row.desiredContent);
    if (!force && row.drift) return state(row, world);
    if (!force && row.appliedSemanticHash && diskHash !== row.appliedSemanticHash && diskHash !== desiredHash) return failApply("PalWorldSettings.ini was changed outside the manager or removed. Import it or reapply desired settings before starting.");
    if (!force && path.resolve(/* turbopackIgnore: true */targetPath) !== path.resolve(/* turbopackIgnore: true */currentPath)) {
      const targetDisk = await readOptional(targetPath);
      if (targetDisk?.trim()) {
        let targetHash: string;
        try {
          targetHash = semanticHash(targetDisk);
        } catch {
          return failApply("The destination PalWorldSettings.ini is malformed. Remove it or explicitly reapply desired settings before moving this world.");
        }
        if (targetHash !== desiredHash) return failApply("The destination already contains a different PalWorldSettings.ini. Import it or explicitly reapply desired settings before moving this world.");
      }
    }
    if (row.desiredRevision === row.appliedRevision && !row.drift) return state(row, world);
    await writeAtomic(targetPath, row.desiredContent);
    const verified = await readFile(targetPath, "utf8");
    if (semanticHash(verified) !== semanticHash(row.desiredContent)) throw new Error("Configuration readback did not match the desired option values.");
    const now = Date.now();
    const hash = semanticHash(verified);
    database().transaction(tx => {
      tx.update(worlds).set({
        ...projection(manager),
        adminPassword: "",
        serverPassword: "",
        updatedAt: now
      }).where(eq(worlds.id, worldId)).run();
      tx.update(worldSettings).set({
        appliedContent: verified,
        appliedRevision: row.desiredRevision,
        managerAppliedRevision: row.desiredRevision,
        appliedSemanticHash: hash,
        pendingSince: null,
        lastApplyError: null,
        drift: false,
        driftReason: null,
        appliedAt: now,
        updatedAt: now
      }).where(eq(worldSettings.worldId, worldId)).run();
      tx.insert(events).values({
        worldId,
        kind: "settings",
        message: `Applied settings revision ${row.desiredRevision}`,
        createdAt: now
      }).run();
    });
    return state((await rowUnlocked(worldId))!, (await getWorld(worldId))!);
  } catch (cause) {
    await markFailure(worldId, cause instanceof Error ? cause.message : String(cause), row.drift || force);
    return state((await rowUnlocked(worldId))!, world);
  }
}
export async function applyDesiredSettings(worldId: string, options: {
  force?: boolean;
} = {}) {
  return locked(worldId, () => applyUnlocked(worldId, options.force));
}
export async function prepareWorldStart<T>(worldId: string, claim: (world: WorldView) => Promise<T>) {
  return locked(worldId, async () => {
    const application = await applyUnlocked(worldId);
    if (application.pendingApply) throw new Error(`Server start blocked because settings could not be applied${application.applyError ? `: ${application.applyError}` : "."}`);
    const world = await requireWorld(worldId);
    if (worldBusy(world)) throw new ConflictError("World is already running or changing state.");
    return claim(world);
  });
}
export async function readSettingsState(worldId: string) {
  const row = await rowFor(worldId);
  const world = await requireWorld(worldId);
  return {
    ...state(row, world),
    desiredManager: managerFromRow(row),
    appliedManager: managerFromWorld(world),
    desiredContent: row.desiredContent,
    appliedContent: row.appliedContent
  };
}
export async function saveDesiredSettings(worldId: string, input: {
  baseRevision: number;
  manager: ManagedWorldSettings;
  content?: string;
  note?: string;
}) {
  return locked(worldId, async () => {
    const row = await bootstrapUnlocked(worldId);
    if (row.desiredRevision !== input.baseRevision) throw new StaleSettingsRevisionError();
    const parsedManager = managedWorldSettingsSchema.parse(input.manager);
    const managerOnly = input.content === undefined;
    if (!managerOnly) validateConfiguration(input.content!);
    const content = input.content ?? row.desiredContent;
    const now = Date.now();
    const revision = row.desiredRevision + 1;
    const before = await requireWorld(worldId);
    const busy = worldBusy(before, { includeUnknown: true });
    const independent = managerOnly && !configurationIsValid(content);
    await withReservationLock(async () => {
      const manager = managedWorldSettingsSchema.parse({
        ...parsedManager,
        installDir: await canonicalInstallDir(parsedManager.installDir)
      });
      await validateReservations(worldId, manager);
      database().transaction(tx => {
        tx.update(worldSettings).set({
          desiredManager: manager,
          desiredContent: content,
          desiredRevision: revision,
          pendingSince: row.pendingSince ?? now,
          ...(independent && !busy ? {
            managerAppliedRevision: revision
          } : {}),
          lastApplyError: independent ? "Registration saved. Game configuration is unavailable; install or repair the server before applying game settings." : null,
          updatedAt: now
        }).where(eq(worldSettings.worldId, worldId)).run();
        if (independent && !busy) tx.update(worlds).set({
          ...projection(manager),
          updatedAt: now
        }).where(eq(worlds.id, worldId)).run();
        if (!managerOnly) tx.insert(configVersions).values({
          id: randomUUID(),
          worldId,
          fileName: "PalWorldSettings.ini",
          content,
          note: input.note ?? `desired revision ${revision}`,
          createdAt: now
        }).run();
        tx.insert(events).values({
          worldId,
          kind: "settings",
          message: `Saved ${managerOnly ? "registration" : "settings"} revision ${revision}`,
          createdAt: now
        }).run();
      });
    });
    await pruneConfigurationVersions(worldId).catch(() => undefined);
    if (busy || independent) return state((await rowUnlocked(worldId))!, (await getWorld(worldId))!);
    return applyUnlocked(worldId);
  });
}
export async function readConfigurationCredentials(worldId: string) {
  return configurationCredentials((await rowFor(worldId)).appliedContent);
}
export async function readConfiguration(worldId: string) {
  const row = await rowFor(worldId);
  const world = await requireWorld(worldId);
  const manager = managerFromRow(row);
  return {
    path: configPath(manager.installDir, manager.platform),
    exists: Boolean(row.desiredContent),
    content: row.desiredContent,
    running: world.status === "running",
    advertisedPort: advertisedPortState(parseConfigurationOptions(row.appliedContent).PublicPort, world.gamePort),
    ...state(row, world)
  };
}
export async function saveConfiguration(worldId: string, content: string, baseRevision?: number) {
  const current = await readSettingsState(worldId);
  const manager = managedWorldSettingsSchema.parse({
    ...current.desiredManager,
    ...managedWorldChangesFromConfiguration(content)
  });
  return saveDesiredSettings(worldId, {
    baseRevision: baseRevision ?? current.desiredRevision,
    manager,
    content,
    note: "saved"
  });
}
export async function readConfigurationOptions(worldId: string) {
  const row = await rowFor(worldId);
  const world = await requireWorld(worldId);
  const desiredManager = managerFromRow(row);
  const shipped = await readShippedDefaults(desiredManager.installDir);
  const templateOptions = shipped ?? {};
  const available = shipped !== null;
  const desiredAll = parseConfigurationOptions(row.desiredContent);
  const appliedAll = parseConfigurationOptions(row.appliedContent);
  const known = new Set([...PALWORLD_SETTING_FIELD_MAP.keys(), ...PALWORLD_MANAGER_SETTING_KEYS]);
  return {
    path: configPath(desiredManager.installDir, desiredManager.platform),
    exists: Boolean(row.desiredContent),
    running: world.status === "running",
    options: Object.fromEntries(Object.entries(desiredAll).filter(([key]) => PALWORLD_SETTING_FIELD_MAP.has(key))),
    appliedOptions: Object.fromEntries(Object.entries(appliedAll).filter(([key]) => PALWORLD_SETTING_FIELD_MAP.has(key))),
    desiredManager,
    appliedManager: managerFromWorld(world),
    shippedDefaults: {
      available,
      options: Object.fromEntries(Object.entries(templateOptions).filter(([key]) => PALWORLD_SETTING_FIELD_MAP.has(key)))
    },
    schemaWarnings: {
      unknownActiveKeys: Object.keys(desiredAll).filter(key => !known.has(key)).sort(),
      unknownDefaultKeys: Object.keys(templateOptions).filter(key => !known.has(key)).sort(),
      missingDefaultKeys: available ? [...PALWORLD_SETTING_FIELD_MAP.keys()].filter(key => !Object.hasOwn(templateOptions, key)).sort() : []
    },
    restartRequired: state(row, world).requiresRestart,
    advertisedPort: advertisedPortState(desiredAll.PublicPort, desiredManager.gamePort),
    appliedAdvertisedPort: advertisedPortState(appliedAll.PublicPort, world.gamePort),
    ...state(row, world)
  };
}
export async function resolveShippedDefaultChanges(worldId: string, keys: readonly string[]) {
  if (!keys.length) return {};
  const current = await readSettingsState(worldId);
  const defaults = await readShippedDefaults(current.desiredManager.installDir);
  if (!defaults) throw new Error("The shipped default configuration is unavailable or malformed.");
  const managers = new Set<string>(PALWORLD_MANAGER_SETTING_KEYS);
  return Object.fromEntries(keys.map(key => {
    const field = PALWORLD_SETTING_FIELD_MAP.get(key);
    if (!field || managers.has(key)) throw new Error(`Setting cannot be reset from the shipped template: ${key}`);
    if (!Object.hasOwn(defaults, key)) throw new Error(`The shipped template has no default for ${key}.`);
    if (decodeDefaultSettingValue(field, defaults[key]).status !== "valid") throw new Error(`The shipped template contains an unsupported default for ${key}.`);
    return [key, defaults[key]!];
  }));
}
export async function saveConfigurationOptions(worldId: string, changes: Record<string, string>, reset: readonly string[] = [], baseRevision?: number) {
  const current = await readConfiguration(worldId);
  return saveConfiguration(worldId, applyConfigurationOptions(current.content, {
    ...changes,
    ...(await resolveShippedDefaultChanges(worldId, reset))
  }), baseRevision);
}
type ManagedConfigurationOptions = {
  syncPublicPort?: boolean;
};
export function managedConfigurationChanges(world: Pick<ManagedWorldSettings, "restApiEnabled" | "restApiPort" | "rconEnabled" | "rconPort" | "gamePort">, options: ManagedConfigurationOptions = {}) {
  const changes: Record<string, string> = {
    RESTAPIEnabled: world.restApiEnabled ? "True" : "False",
    RESTAPIPort: String(world.restApiPort),
    RCONEnabled: world.rconEnabled ? "True" : "False",
    RCONPort: String(world.rconPort)
  };
  if (options.syncPublicPort) changes.PublicPort = String(world.gamePort);
  return changes;
}
export async function syncManagedConfiguration(worldId: string, options: ManagedConfigurationOptions = {}) {
  const current = await readSettingsState(worldId);
  let source = current.desiredContent;
  const initialized = !current.appliedContent.trim();
  if (!source.trim()) source = (await readOptional(defaultConfigurationPath(current.desiredManager.installDir))) ?? "";
  if (!source) return {
    synchronized: false,
    initialized: false,
    reason: "The shipped default configuration is not available yet."
  };
  const changes = managedConfigurationChanges(current.desiredManager, {
    syncPublicPort: initialized || options.syncPublicPort
  });
  if (initialized) {
    const world = await requireWorld(worldId);
    const credentials = configurationCredentials(source);
    Object.assign(changes, legacyCredentialChanges(source, world));
    if (current.desiredManager.restApiEnabled && !credentials.adminPassword && !world.adminPassword) changes.AdminPassword = JSON.stringify(randomBytes(18).toString("base64url"));
  }
  let content = applyConfigurationOptions(source, changes);
  if (initialized) content = serializeConfigurationOptions(parseConfigurationOptions(content));
  const saved = await saveDesiredSettings(worldId, {
    baseRevision: current.desiredRevision,
    manager: current.desiredManager,
    content,
    note: initialized ? "initialized from shipped defaults" : "synchronized manager settings"
  });
  const application = initialized && current.drift ? await applyDesiredSettings(worldId, {
    force: true
  }) : saved;
  return {
    synchronized: true,
    initialized,
    ...application
  };
}
export async function listConfigurationVersions(worldId: string) {
  const records = await database().select().from(configVersions).where(eq(configVersions.worldId, worldId)).orderBy(desc(configVersions.createdAt)).limit(50);
  return records.map(({
    content,
    ...record
  }) => ({
    ...record,
    sizeBytes: Buffer.byteLength(content)
  }));
}
export async function restoreConfiguration(worldId: string, versionId: string, baseRevision?: number) {
  const [version] = await database().select().from(configVersions).where(and(eq(configVersions.id, versionId), eq(configVersions.worldId, worldId))).limit(1);
  if (!version) throw new Error("Configuration version not found.");
  const current = await readSettingsState(worldId);
  validateConfiguration(version.content);
  const manager = managedWorldSettingsSchema.parse({
    ...current.desiredManager,
    ...managedWorldChangesFromConfiguration(version.content)
  });
  return {
    ...(await saveDesiredSettings(worldId, {
      baseRevision: baseRevision ?? current.desiredRevision,
      manager,
      content: version.content,
      note: `restored from ${versionId}`
    })),
    content: version.content
  };
}
export async function reconcileConfiguration(worldId: string, action: "import-file" | "reapply-desired") {
  return locked(worldId, async () => {
    const row = await bootstrapUnlocked(worldId);
    const world = await requireWorld(worldId);
    if (worldBusy(world)) throw new ConflictError("Stop the world before reconciling its configuration file.");
    if (action === "reapply-desired") return applyUnlocked(worldId, true);
    const previousManager = managerFromRow(row);
    const content = await readFile(configPath(previousManager.installDir, previousManager.platform), "utf8");
    validateConfiguration(content);
    const manager = managedWorldSettingsSchema.parse({
      ...previousManager,
      ...managedWorldChangesFromConfiguration(content)
    });
    const now = Date.now();
    const revision = row.desiredRevision + 1;
    await withReservationLock(async () => {
      await validateReservations(worldId, manager);
      database().transaction(tx => commitApplied(tx, worldId, manager, content, revision, now, "imported external file"));
    });
    return state((await rowUnlocked(worldId))!, (await getWorld(worldId))!);
  });
}
export async function adoptRestoredConfiguration(worldId: string, content: string, replaceFilesystem?: () => Promise<() => Promise<void>>) {
  validateConfiguration(content);
  return locked(worldId, async () => {
    const row = await bootstrapUnlocked(worldId);
    const world = await requireWorld(worldId);
    if (worldBusy(world)) throw new ConflictError("Stop the server before restoring a backup.");
    // The backup was restored into the applied world's save tree. Discard any
    // unrelated staged manager projection so the adopted database state points
    // at the filesystem that was actually replaced.
    const manager = managedWorldSettingsSchema.parse({
      ...managerFromWorld(world),
      ...managedWorldChangesFromConfiguration(content)
    });
    const now = Date.now();
    const revision = row.desiredRevision + 1;
    await withReservationLock(async () => {
      await validateReservations(worldId, manager);
      const rollback = await replaceFilesystem?.();
      try {
        database().transaction(tx => commitApplied(tx, worldId, manager, content, revision, now, "adopted from backup restore"));
      } catch (cause) {
        if (rollback) {
          try {
            await rollback();
          } catch (rollbackCause) {
            throw new AggregateError([cause, rollbackCause], "Configuration adoption failed and the previous save tree could not be restored.");
          }
        }
        throw cause;
      }
    });
    return state((await rowUnlocked(worldId))!, (await getWorld(worldId))!);
  });
}

// The guided settings page: PSM-owned settings as the page shows them, next to the game options.
function managerView(manager: ManagedWorldSettings) {
  const { env, ...rest } = manager;
  return { ...rest, environment: env };
}
export async function readAdministration(worldId: string) {
  const actualWorld = await requireWorld(worldId);
  const configuration = await readConfigurationOptions(worldId);
  return {
    configuration,
    admin: { ...managerView(configuration.desiredManager), advertisedPort: configuration.advertisedPort, status: actualWorld.status },
    appliedAdmin: { ...managerView(configuration.appliedManager), advertisedPort: configuration.appliedAdvertisedPort, status: actualWorld.status }
  };
}
// Saves a mixed change from the guided settings page: game options, options reset to the shipped
// defaults, and PSM-owned settings, as one new desired revision.
export async function saveAdministration(worldId: string, input: AdministrationRequest) {
  if (new Set(input.resetToDefaults).size !== input.resetToDefaults.length) throw new ConflictError("A setting can only be reset once.");
  const overlap = input.resetToDefaults.find(key => Object.hasOwn(input.changes, key));
  if (overlap) throw new ConflictError(`A setting cannot be changed and reset in the same request: ${overlap}`);
  const encoded = Object.keys(input.changes).length ? validateAndEncodeSettingChanges(input.changes) : {};
  if (!Object.keys(encoded).length && !input.resetToDefaults.length && !Object.keys(input.managed).length) throw new ConflictError("No configuration changes were provided.");
  const current = await readSettingsState(worldId);
  if (current.desiredRevision !== input.baseRevision) throw new StaleSettingsRevisionError();
  const previous = current.desiredManager;
  const previousConfiguration = await readConfigurationOptions(worldId);
  const resetChanges = await resolveShippedDefaultChanges(worldId, input.resetToDefaults);
  const nextServerName = encoded.ServerName ?? resetChanges.ServerName ?? previousConfiguration.options.ServerName;
  const { publicPortOverride, displayNameOverride, ...worldChanges } = input.managed;
  const displayNameProvided = Object.hasOwn(input.managed, "displayNameOverride");
  const displayNameChange = managedDisplayNameChange(previous.displayName, previousConfiguration.options.ServerName, nextServerName, displayNameOverride, displayNameProvided);
  const world: ManagedWorldSettings = { ...previous, ...worldChanges, ...(displayNameChange === undefined ? {} : { displayName: displayNameChange }) };
  const publicPortProvided = Object.hasOwn(input.managed, "publicPortOverride");
  const publicPortChange = managedPublicPortChange(previousConfiguration.advertisedPort, previous.gamePort, world.gamePort, publicPortOverride, publicPortProvided);
  const gameChanges = Object.keys(encoded).length > 0 || input.resetToDefaults.length > 0 || publicPortProvided;
  if (!configurationIsValid(current.desiredContent)) {
    if (gameChanges) throw new ConflictError("Game configuration is missing or malformed. Save registration changes separately, then install or repair the configuration.");
    return { result: await saveDesiredSettings(worldId, { baseRevision: input.baseRevision, manager: world }), configurationChanged: false };
  }
  const synchronized = managedConfigurationChanges(world);
  if (publicPortChange !== undefined) synchronized.PublicPort = publicPortChange;
  const content = applyConfigurationOptions(current.desiredContent, { ...encoded, ...resetChanges, ...synchronized });
  return { result: await saveDesiredSettings(worldId, { baseRevision: input.baseRevision, manager: world, content }), configurationChanged: true };
}
// A registration patch from the world API: PSM-owned fields plus, optionally, the game credentials,
// which are written into the INI rather than kept in the registry.
export async function patchWorldRegistration(worldId: string, raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConflictError("Invalid request.");
  const input = raw as Record<string, unknown>;
  const baseRevision = Number(input.baseRevision);
  if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new ConflictError("A valid baseRevision is required.");
  const { adminPassword, serverPassword, ...managerPatch } = parseWorldUpdate(input);
  const current = await readSettingsState(worldId);
  const manager = managedWorldSettingsSchema.parse({ ...current.desiredManager, ...managerPatch });
  const inheritedPublicPort = managedPublicPortChange(advertisedPortState(parseConfigurationOptions(current.desiredContent).PublicPort, current.desiredManager.gamePort), current.desiredManager.gamePort, manager.gamePort, undefined, false);
  const optionChanges = {
    ...managedConfigurationChanges(manager),
    ...(inheritedPublicPort === undefined ? {} : { PublicPort: inheritedPublicPort }),
    ...(adminPassword === undefined ? {} : { AdminPassword: JSON.stringify(adminPassword) }),
    ...(serverPassword === undefined ? {} : { ServerPassword: JSON.stringify(serverPassword) })
  };
  const valid = configurationIsValid(current.desiredContent);
  if (!valid && (adminPassword !== undefined || serverPassword !== undefined)) throw new ConflictError("Game configuration is missing or malformed; save registration changes separately.");
  return saveDesiredSettings(worldId, { baseRevision, manager, ...(valid ? { content: applyConfigurationOptions(current.desiredContent, optionChanges) } : {}) });
}
