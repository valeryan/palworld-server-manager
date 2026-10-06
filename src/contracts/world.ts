import { z } from "zod";

// Single source of the enumerations shared by the database schema, the API and the client.
export const PLATFORMS = ["linux", "windows"] as const;
export const WORLD_STATUSES = ["stopped", "starting", "running", "stopping", "crashed", "unknown"] as const;
export const ARGUMENT_FORMATS = ["legacy", "windows"] as const;
export type Platform = typeof PLATFORMS[number];
export type ArgumentFormat = typeof ARGUMENT_FORMATS[number];

export const platformSchema = z.enum(PLATFORMS);
export const worldStatusSchema = z.enum(WORLD_STATUSES);
export const portSchema = z.coerce.number().int().min(1).max(65535);
const port = portSchema;
export const PORT_FIELDS = ["gamePort", "queryPort", "restApiPort", "rconPort"] as const;
export type PortField = typeof PORT_FIELDS[number];
export const defaultWorldPorts = { gamePort: 8211, queryPort: 27015, restApiPort: 8212, rconPort: 25575 } as const;
export type WorldPorts = Record<PortField, number>;

export const createWorldSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  installDir: z.string().trim().min(1),
  platform: platformSchema.default("linux"),
  gamePort: port.default(defaultWorldPorts.gamePort),
  queryPort: port.default(defaultWorldPorts.queryPort),
  restApiPort: port.default(defaultWorldPorts.restApiPort),
  rconPort: port.default(defaultWorldPorts.rconPort),
  adminPassword: z.string().max(256).default(""),
  serverPassword: z.string().max(256).default(""),
  restApiEnabled: z.boolean().default(true),
  rconEnabled: z.boolean().default(false),
  communityServer: z.boolean().default(false),
  autostart: z.boolean().default(false),
  crashGuard: z.boolean().default(true),
  legacyPerfFlags: z.boolean().default(true),
  extraArgs: z.string().max(4096).default(""),
  argumentFormat: z.enum(ARGUMENT_FORMATS).optional(),
  env: z.record(z.string(), z.string()).default({}),
  wineBinary: z.string().trim().default("wine"),
  winePrefix: z.string().nullable().default(null),
  wineLaunchFlags: z.string().max(4096).default(""),
});

export const updateWorldSchema = createWorldSchema.partial();
// Everything PSM manages about a world apart from the game credentials, which live only in the INI.
export const managedWorldSettingsSchema = createWorldSchema.omit({ adminPassword: true, serverPassword: true }).strict();
export const portableWorldSchema = managedWorldSettingsSchema;
/** The managed field names, derived from the schema so no code has to list them by hand. */
export const MANAGED_KEYS = Object.keys(managedWorldSettingsSchema.shape) as Array<keyof ManagedWorldSettings>;
/** Only the managed fields of `source`, as a plain object ready for `managedWorldSettingsSchema.parse`. */
export function pickManaged<T extends object>(source: T): Pick<T, keyof ManagedWorldSettings & keyof T> {
  const record = source as Record<string, unknown>;
  return Object.fromEntries(MANAGED_KEYS.filter((key) => key in record).map((key) => [key, record[key]])) as Pick<T, keyof ManagedWorldSettings & keyof T>;
}
export const worldRegistrationSchema = z.object({
  format: z.literal("psm-next/world-registration"),
  version: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.iso.datetime(),
  sourceWorldId: z.string().min(1),
  world: portableWorldSchema,
}).strict();
export function parseWorldUpdate(raw: unknown): UpdateWorldInput {
  const parsed = updateWorldSchema.parse(raw);
  const provided = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.hasOwn(provided, key))) as UpdateWorldInput;
}
export const worldActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("stop"), force: z.boolean().default(false) }),
  z.object({ action: z.literal("restart") }),
  z.object({ action: z.literal("install") }),
  z.object({ action: z.literal("repair-prerequisites") }),
  z.object({ action: z.literal("update") }),
  z.object({ action: z.literal("check-update") }),
  z.object({ action: z.literal("backup"), reason: z.string().max(200).default("manual") }),
  z.object({ action: z.literal("restore"), backupId: z.string().min(1) }),
]);

export type CreateWorldInput = z.infer<typeof createWorldSchema>;
export type UpdateWorldInput = z.infer<typeof updateWorldSchema>;
export type ManagedWorldSettings = z.infer<typeof managedWorldSettingsSchema>;
export type WorldStatus = z.infer<typeof worldStatusSchema>;
export type WorldRegistration = z.infer<typeof worldRegistrationSchema>;

export const ACTIVE_WORLD_STATUSES = ["running", "starting", "stopping"] as const satisfies readonly WorldStatus[];

/** True while a lifecycle transition is in progress or a server PID is recorded. Ownership marked
 * `unknown` counts as busy only when the caller asks, since nothing can be verified about it. */
export function worldBusy(world: Pick<WorldView, "status" | "processId">, options: { includeUnknown?: boolean } = {}): boolean {
  return (ACTIVE_WORLD_STATUSES as readonly string[]).includes(world.status) || Boolean(world.processId) || (options.includeUnknown === true && world.status === "unknown");
}

/** Nothing is running and ownership is settled: the world is stopped or has crashed. */
export function isWorldStopped(world: Pick<WorldView, "status">): boolean { return world.status === "stopped" || world.status === "crashed"; }

export interface WorldView extends CreateWorldInput {
  installation?: import("./installation").InstallationHealth;
  id: string;
  status: WorldStatus;
  processId: number | null;
  buildId: string | null;
  latestBuildId: string | null;
  lastStartedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** A world as the API returns it: never the game credentials or the process environment. */
export type PublicWorldView = Omit<WorldView, "adminPassword" | "serverPassword" | "env">;

/** A player the presence poller has seen in a world; one row per world and user ID. */
export interface KnownPlayer { userId: string; playerName: string; accountName: string | null; firstSeenAt: number; lastSeenAt: number; joinCount: number; lastLeftAt: number | null; bannedAt: number | null }

/** The state cards of a world's Overview tab; installation and configuration state come from their own endpoints. */
export interface WorldOverview {
  nextSchedule: { action: import("./schedule").ScheduleAction; mode: import("./schedule").ScheduleMode; nextRunAt: number; skipNext: boolean } | null;
  enabledSchedules: number;
  backups: { count: number; latest: { createdAt: number; sizeBytes: number; verified: boolean; reason: string } | null };
  modRuntime: { version: string; enabled: boolean; earlyCrashes: number; recoveryPaused: boolean } | null;
}

/** How the port advertised to players (PublicPort) relates to the game port. */
export type AdvertisedPortState =
  | { mode: "inherit"; effectivePort: number }
  | { mode: "override"; effectivePort: number }
  | { mode: "invalid"; raw: string; effectivePort: number };
