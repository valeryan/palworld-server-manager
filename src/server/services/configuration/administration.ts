import "server-only";
import { validateAndEncodeSettingChanges } from "@/contracts/palworld-settings";
import { managedWorldSettingsSchema, parseWorldUpdate, type ManagedWorldSettings } from "@/contracts/world";
import type { AdministrationRequest } from "@/contracts/world-administration";
import { applyConfigurationOptions, configurationIsValid, parseConfigurationOptions } from "@/lib/palworld-ini";
import { ConflictError } from "@/server/errors";
import { requireWorld } from "../worlds";
import { readConfigurationOptions, readSettingsState, resolveShippedDefaultChanges, saveDesiredSettings } from "./desired";
import { advertisedPortState, managedConfigurationChanges, managedDisplayNameChange, managedPublicPortChange } from "./managed";
import { StaleSettingsRevisionError } from "./state";

// The two request shapes that change PSM-owned settings and game options together: the guided
// settings page and the world registration PATCH.

/** PSM-owned settings as the page shows them, next to the game options. */
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
    appliedAdmin: { ...managerView(configuration.appliedManager), advertisedPort: configuration.appliedAdvertisedPort, status: actualWorld.status },
  };
}

/** Saves a mixed change from the guided settings page: game options, options reset to the shipped
 * defaults, and PSM-owned settings, as one new desired revision. */
export async function saveAdministration(worldId: string, input: AdministrationRequest) {
  if (new Set(input.resetToDefaults).size !== input.resetToDefaults.length) throw new ConflictError("A setting can only be reset once.");
  const overlap = input.resetToDefaults.find((key) => Object.hasOwn(input.changes, key));
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

/** A registration patch from the world API: PSM-owned fields plus, optionally, the game credentials,
 * which are written into the INI rather than kept in the registry. */
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
    ...(serverPassword === undefined ? {} : { ServerPassword: JSON.stringify(serverPassword) }),
  };
  const valid = configurationIsValid(current.desiredContent);
  if (!valid && (adminPassword !== undefined || serverPassword !== undefined)) throw new ConflictError("Game configuration is missing or malformed; save registration changes separately.");
  return saveDesiredSettings(worldId, { baseRevision, manager, ...(valid ? { content: applyConfigurationOptions(current.desiredContent, optionChanges) } : {}) });
}
