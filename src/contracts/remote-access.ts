import { z } from "zod";

export const remotePermissions = ["world.view", "world.lifecycle", "world.players", "world.messages"] as const;
export type RemotePermission = typeof remotePermissions[number];

export const remoteAccessSettingsSchema = z.object({
  enabled: z.boolean().default(false),
});
export type RemoteAccessSettings = z.infer<typeof remoteAccessSettingsSchema>;

export const createRemoteCodeSchema = z.object({
  label: z.string().trim().min(1).max(80),
  scope: z.enum(["all", "world"]),
  worldId: z.string().uuid().nullable().optional(),
  permissions: z.array(z.enum(remotePermissions)).min(1).transform((values) => [...new Set(values)]),
}).superRefine((value, context) => {
  if (value.scope === "world" && !value.worldId) context.addIssue({ code: "custom", path: ["worldId"], message: "Select a world for a world-scoped code." });
});

export const remoteLoginSchema = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the six-digit access code.") });
export const updateRemoteCodeSchema = z.object({ enabled: z.boolean() });
