import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { decodeDefaultSettingValue, PALWORLD_MANAGER_SETTING_KEYS, PALWORLD_SETTING_FIELD_MAP } from "@/contracts/palworld-settings";
import { managedWorldSettingsSchema, worldBusy, type ManagedWorldSettings } from "@/contracts/world";
import { applyConfigurationOptions, configurationCredentials, configurationIsValid, parseConfigurationOptions, serializeConfigurationOptions, validateConfiguration } from "@/lib/palworld-ini";
import { database } from "@/server/db";
import { configVersions, events, worlds, worldSettings } from "@/server/db/schema";
import { readOptional } from "@/server/fs";
import { withReservationLock } from "../reservations";
import { pruneConfigurationVersions } from "../retention";
import { canonicalInstallDir, getWorld, requireWorld } from "../worlds";
import { applyDesiredSettings, applyUnlocked } from "./apply";
import { advertisedPortState, configPath, defaultConfigurationPath, legacyCredentialChanges, managedConfigurationChanges, managedWorldChangesFromConfiguration, readShippedDefaults, type ManagedConfigurationOptions } from "./managed";
import { bootstrapUnlocked, locked, managerFromRow, managerFromWorld, projection, rowFor, rowUnlocked, StaleSettingsRevisionError, state, validateReservations } from "./state";

// Reading and saving the desired configuration: a new revision of the INI text and the PSM-owned
// settings, applied immediately when the world is stopped.

export async function readSettingsState(worldId: string) {
  const row = await rowFor(worldId);
  const world = await requireWorld(worldId);
  return { ...state(row, world), desiredManager: managerFromRow(row), appliedManager: managerFromWorld(world), desiredContent: row.desiredContent, appliedContent: row.appliedContent };
}

export async function saveDesiredSettings(worldId: string, input: { baseRevision: number; manager: ManagedWorldSettings; content?: string; note?: string }) {
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
      const manager = managedWorldSettingsSchema.parse({ ...parsedManager, installDir: await canonicalInstallDir(parsedManager.installDir) });
      await validateReservations(worldId, manager);
      database().transaction((tx) => {
        tx.update(worldSettings).set({
          desiredManager: manager, desiredContent: content, desiredRevision: revision, pendingSince: row.pendingSince ?? now,
          ...(independent && !busy ? { managerAppliedRevision: revision } : {}),
          lastApplyError: independent ? "Registration saved. Game configuration is unavailable; install or repair the server before applying game settings." : null,
          updatedAt: now,
        }).where(eq(worldSettings.worldId, worldId)).run();
        if (independent && !busy) tx.update(worlds).set({ ...projection(manager), updatedAt: now }).where(eq(worlds.id, worldId)).run();
        if (!managerOnly) tx.insert(configVersions).values({ id: randomUUID(), worldId, fileName: "PalWorldSettings.ini", content, note: input.note ?? `desired revision ${revision}`, createdAt: now }).run();
        tx.insert(events).values({ worldId, kind: "settings", message: `Saved ${managerOnly ? "registration" : "settings"} revision ${revision}`, createdAt: now }).run();
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
    path: configPath(manager.installDir, manager.platform), exists: Boolean(row.desiredContent), content: row.desiredContent,
    running: world.status === "running",
    advertisedPort: advertisedPortState(parseConfigurationOptions(row.appliedContent).PublicPort, world.gamePort),
    ...state(row, world),
  };
}

export async function saveConfiguration(worldId: string, content: string, baseRevision?: number) {
  const current = await readSettingsState(worldId);
  const manager = managedWorldSettingsSchema.parse({ ...current.desiredManager, ...managedWorldChangesFromConfiguration(content) });
  return saveDesiredSettings(worldId, { baseRevision: baseRevision ?? current.desiredRevision, manager, content, note: "saved" });
}

const knownOptions = (options: Record<string, string>) => Object.fromEntries(Object.entries(options).filter(([key]) => PALWORLD_SETTING_FIELD_MAP.has(key)));

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
    path: configPath(desiredManager.installDir, desiredManager.platform), exists: Boolean(row.desiredContent), running: world.status === "running",
    options: knownOptions(desiredAll), appliedOptions: knownOptions(appliedAll),
    desiredManager, appliedManager: managerFromWorld(world),
    shippedDefaults: { available, options: knownOptions(templateOptions) },
    schemaWarnings: {
      unknownActiveKeys: Object.keys(desiredAll).filter((key) => !known.has(key)).sort(),
      unknownDefaultKeys: Object.keys(templateOptions).filter((key) => !known.has(key)).sort(),
      missingDefaultKeys: available ? [...PALWORLD_SETTING_FIELD_MAP.keys()].filter((key) => !Object.hasOwn(templateOptions, key)).sort() : [],
    },
    restartRequired: state(row, world).requiresRestart,
    advertisedPort: advertisedPortState(desiredAll.PublicPort, desiredManager.gamePort),
    appliedAdvertisedPort: advertisedPortState(appliedAll.PublicPort, world.gamePort),
    ...state(row, world),
  };
}

/** The shipped-template values for `keys`, which must be known, non-manager settings with supported defaults. */
export async function resolveShippedDefaultChanges(worldId: string, keys: readonly string[]) {
  if (!keys.length) return {};
  const current = await readSettingsState(worldId);
  const defaults = await readShippedDefaults(current.desiredManager.installDir);
  if (!defaults) throw new Error("The shipped default configuration is unavailable or malformed.");
  const managers = new Set<string>(PALWORLD_MANAGER_SETTING_KEYS);
  return Object.fromEntries(keys.map((key) => {
    const field = PALWORLD_SETTING_FIELD_MAP.get(key);
    if (!field || managers.has(key)) throw new Error(`Setting cannot be reset from the shipped template: ${key}`);
    if (!Object.hasOwn(defaults, key)) throw new Error(`The shipped template has no default for ${key}.`);
    if (decodeDefaultSettingValue(field, defaults[key]).status !== "valid") throw new Error(`The shipped template contains an unsupported default for ${key}.`);
    return [key, defaults[key]!];
  }));
}

export async function saveConfigurationOptions(worldId: string, changes: Record<string, string>, reset: readonly string[] = [], baseRevision?: number) {
  const current = await readConfiguration(worldId);
  return saveConfiguration(worldId, applyConfigurationOptions(current.content, { ...changes, ...(await resolveShippedDefaultChanges(worldId, reset)) }), baseRevision);
}

/** Brings the INI in line with the PSM-owned settings, initializing it from the shipped template when the world has none yet. */
export async function syncManagedConfiguration(worldId: string, options: ManagedConfigurationOptions = {}) {
  const current = await readSettingsState(worldId);
  let source = current.desiredContent;
  const initialized = !current.appliedContent.trim();
  if (!source.trim()) source = (await readOptional(defaultConfigurationPath(current.desiredManager.installDir))) ?? "";
  if (!source) return { synchronized: false, initialized: false, reason: "The shipped default configuration is not available yet." };
  const changes = managedConfigurationChanges(current.desiredManager, { syncPublicPort: initialized || options.syncPublicPort });
  if (initialized) {
    const world = await requireWorld(worldId);
    const credentials = configurationCredentials(source);
    Object.assign(changes, legacyCredentialChanges(source, world));
    if (current.desiredManager.restApiEnabled && !credentials.adminPassword && !world.adminPassword) changes.AdminPassword = JSON.stringify(randomBytes(18).toString("base64url"));
  }
  let content = applyConfigurationOptions(source, changes);
  if (initialized) content = serializeConfigurationOptions(parseConfigurationOptions(content));
  const saved = await saveDesiredSettings(worldId, { baseRevision: current.desiredRevision, manager: current.desiredManager, content, note: initialized ? "initialized from shipped defaults" : "synchronized manager settings" });
  const application = initialized && current.drift ? await applyDesiredSettings(worldId, { force: true }) : saved;
  return { synchronized: true, initialized, ...application };
}
