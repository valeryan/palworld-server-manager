import { z } from "zod";
import { PALWORLD_SETTING_FIELDS } from "./palworld-settings";
import { ARGUMENT_FORMATS, PLATFORMS, portSchema } from "./world";

// Changes to PSM-owned world settings sent from the guided settings page. Every field is optional:
// only the keys the administrator actually changed are present (the server must not fill defaults).
export const managedChangesSchema = z.object({
  displayNameOverride: z.string().trim().max(80).nullable().optional(),
  installDir: z.string().trim().min(1).optional(),
  platform: z.enum(PLATFORMS).optional(),
  gamePort: portSchema.optional(),
  queryPort: portSchema.optional(),
  publicPortOverride: portSchema.nullable().optional(),
  restApiEnabled: z.boolean().optional(),
  restApiPort: portSchema.optional(),
  rconEnabled: z.boolean().optional(),
  rconPort: portSchema.optional(),
  communityServer: z.boolean().optional(),
  autostart: z.boolean().optional(),
  crashGuard: z.boolean().optional(),
  legacyPerfFlags: z.boolean().optional(),
  extraArgs: z.string().max(4096).optional(),
  argumentFormat: z.enum(ARGUMENT_FORMATS).optional(),
  env: z.record(z.string(), z.string()).optional(),
  wineBinary: z.string().trim().optional(),
  winePrefix: z.string().nullable().optional(),
  wineLaunchFlags: z.string().max(4096).optional(),
}).strict();

export const administrationRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  changes: z.record(z.string(), z.unknown()).default({}),
  resetToDefaults: z.array(z.string()).max(PALWORLD_SETTING_FIELDS.length).default([]),
  managed: managedChangesSchema.default({}),
}).strict();

export type ManagedChanges = z.infer<typeof managedChangesSchema>;
export type AdministrationRequest = z.infer<typeof administrationRequestSchema>;
