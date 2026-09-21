import { z } from "zod";

export const platformSchema = z.enum(["linux", "windows"]);
export const worldStatusSchema = z.enum(["stopped", "starting", "running", "stopping", "crashed", "unknown"]);
const port = z.coerce.number().int().min(1).max(65535);

export const createWorldSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  installDir: z.string().trim().min(1),
  platform: platformSchema.default("linux"),
  gamePort: port.default(8211),
  queryPort: port.default(27015),
  restApiPort: port.default(8212),
  rconPort: port.default(25575),
  adminPassword: z.string().max(256).default(""),
  serverPassword: z.string().max(256).default(""),
  restApiEnabled: z.boolean().default(true),
  rconEnabled: z.boolean().default(false),
  communityServer: z.boolean().default(false),
  autostart: z.boolean().default(false),
  crashGuard: z.boolean().default(true),
  legacyPerfFlags: z.boolean().default(true),
  extraArgs: z.string().max(4096).default(""),
  env: z.record(z.string(), z.string()).default({}),
  wineBinary: z.string().trim().default("wine"),
  winePrefix: z.string().nullable().default(null),
  wineLaunchFlags: z.string().max(4096).default(""),
});

export const updateWorldSchema = createWorldSchema.partial();
export const portableWorldSchema = createWorldSchema.omit({ adminPassword: true, serverPassword: true }).strict();
export const worldRegistrationSchema = z.object({
  format: z.literal("psm-next/world-registration"),
  version: z.literal(1),
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
  z.object({ action: z.literal("update") }),
  z.object({ action: z.literal("check-update") }),
  z.object({ action: z.literal("backup"), reason: z.string().max(200).default("manual") }),
  z.object({ action: z.literal("restore"), backupId: z.string().min(1) }),
]);

export type CreateWorldInput = z.infer<typeof createWorldSchema>;
export type UpdateWorldInput = z.infer<typeof updateWorldSchema>;
export type WorldActionInput = z.infer<typeof worldActionSchema>;
export type WorldStatus = z.infer<typeof worldStatusSchema>;
export type WorldRegistration = z.infer<typeof worldRegistrationSchema>;

export interface WorldView extends CreateWorldInput {
  id: string;
  status: WorldStatus;
  processId: number | null;
  buildId: string | null;
  latestBuildId: string | null;
  lastStartedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
