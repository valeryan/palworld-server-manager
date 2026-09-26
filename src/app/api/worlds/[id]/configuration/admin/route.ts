import { z } from "zod";
import { PALWORLD_SETTING_FIELDS, validateAndEncodeSettingChanges } from "@/contracts/palworld-settings";
import { errorResponse, requireAdmin } from "@/server/http";
import { managedDisplayNameChange, managedPublicPortChange, readConfigurationOptions, resolveShippedDefaultChanges, saveConfigurationOptions } from "@/server/services/configuration";
import { getWorld, updateWorld } from "@/server/services/worlds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const port = z.coerce.number().int().min(1).max(65535);
const managedSchema = z.object({
  displayNameOverride: z.string().trim().max(80).nullable().optional(),
  installDir: z.string().trim().min(1).optional(),
  platform: z.enum(["linux", "windows"]).optional(),
  gamePort: port.optional(),
  queryPort: port.optional(),
  publicPortOverride: port.nullable().optional(),
  restApiEnabled: z.boolean().optional(),
  restApiPort: port.optional(),
  rconEnabled: z.boolean().optional(),
  rconPort: port.optional(),
  communityServer: z.boolean().optional(),
  autostart: z.boolean().optional(),
  crashGuard: z.boolean().optional(),
  legacyPerfFlags: z.boolean().optional(),
  extraArgs: z.string().max(4096).optional(),
  env: z.record(z.string(), z.string()).optional(),
  wineBinary: z.string().trim().optional(),
  winePrefix: z.string().nullable().optional(),
  wineLaunchFlags: z.string().max(4096).optional(),
}).strict();
const requestSchema = z.object({
  changes: z.record(z.string(), z.unknown()).default({}),
  resetToDefaults: z.array(z.string()).max(PALWORLD_SETTING_FIELDS.length).default([]),
  managed: managedSchema.default({}),
}).strict();

export async function GET(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const { id } = await context.params;
    const world = await getWorld(id); if (!world) throw new Error("World not found.");
    const configuration = await readConfigurationOptions(id);
    return Response.json({
      ok: true,
      configuration,
      admin: {
        restApiEnabled: world.restApiEnabled, restApiPort: world.restApiPort,
        rconEnabled: world.rconEnabled, rconPort: world.rconPort,
        displayName: world.displayName, installDir: world.installDir, platform: world.platform,
        gamePort: world.gamePort, queryPort: world.queryPort, advertisedPort: configuration.advertisedPort,
        status: world.status,
        communityServer: world.communityServer, autostart: world.autostart, crashGuard: world.crashGuard,
        legacyPerfFlags: world.legacyPerfFlags, extraArgs: world.extraArgs, environment: world.env,
        wineBinary: world.wineBinary, winePrefix: world.winePrefix, wineLaunchFlags: world.wineLaunchFlags,
      },
    });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const { id } = await context.params;
    const input = requestSchema.parse(await request.json());
    if (new Set(input.resetToDefaults).size !== input.resetToDefaults.length) throw new Error("A setting can only be reset once.");
    const overlap = input.resetToDefaults.find((key) => Object.hasOwn(input.changes, key));
    if (overlap) throw new Error(`A setting cannot be changed and reset in the same request: ${overlap}`);
    const encoded = Object.keys(input.changes).length ? validateAndEncodeSettingChanges(input.changes) : {};
    const managedKeys = Object.keys(input.managed) as Array<keyof typeof input.managed>;
    if (!Object.keys(encoded).length && !input.resetToDefaults.length && !managedKeys.length) throw new Error("No configuration changes were provided.");
    const previous = await getWorld(id); if (!previous) throw new Error("World not found.");
    const previousConfiguration = await readConfigurationOptions(id);
    const resetChanges = await resolveShippedDefaultChanges(id, input.resetToDefaults);
    const nextServerName = encoded.ServerName ?? resetChanges.ServerName ?? previousConfiguration.options.ServerName;
    const displayNameProvided = Object.hasOwn(input.managed, "displayNameOverride");
    const displayNameChange = managedDisplayNameChange(previous.displayName, previousConfiguration.options.ServerName, nextServerName, input.managed.displayNameOverride, displayNameProvided);
    const worldChanges = { ...input.managed };
    delete worldChanges.publicPortOverride;
    delete worldChanges.displayNameOverride;
    if (displayNameChange !== undefined) Object.assign(worldChanges, { displayName: displayNameChange });
    const world = Object.keys(worldChanges).length ? await updateWorld(id, worldChanges) : previous;
    if (!world) throw new Error("World not found.");
    const publicPortProvided = Object.hasOwn(input.managed, "publicPortOverride");
    const publicPortChange = managedPublicPortChange(previousConfiguration.advertisedPort, previous.gamePort, world.gamePort, input.managed.publicPortOverride, publicPortProvided);
    const fileManagedKeys = new Set(["restApiEnabled", "restApiPort", "rconEnabled", "rconPort"]);
    const configurationChanged = Boolean(Object.keys(encoded).length || input.resetToDefaults.length || publicPortChange !== undefined || managedKeys.some((key) => fileManagedKeys.has(key)));
    let result = null;
    if (configurationChanged) {
      const synchronized: Record<string, string> = {
        RESTAPIEnabled: world.restApiEnabled ? "True" : "False", RESTAPIPort: String(world.restApiPort),
        RCONEnabled: world.rconEnabled ? "True" : "False", RCONPort: String(world.rconPort),
      };
      if (publicPortChange !== undefined) synchronized.PublicPort = publicPortChange;
      result = await saveConfigurationOptions(id, { ...encoded, ...resetChanges, ...synchronized });
    }
    return Response.json({ ok: true, result, configurationChanged });
  } catch (error) { return errorResponse(error); }
}
