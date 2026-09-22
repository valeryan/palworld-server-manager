import { z } from "zod";

const userId = z.string().trim().min(1, "Player user ID is required.").max(128);
const playerName = z.string().trim().min(1).max(128).optional();
const moderationMessage = z.string().trim().min(1).max(512).optional();

export const restAdminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("announce"), message: z.string().trim().min(1, "Announcement cannot be empty.").max(2_000) }),
  z.object({ action: z.literal("save") }),
  z.object({ action: z.literal("kick"), userId, playerName, message: moderationMessage }),
  z.object({ action: z.literal("ban"), userId, playerName, message: moderationMessage }),
  z.object({ action: z.literal("unban"), userId, playerName }),
]);

export const rconCommandSchema = z.object({ command: z.string().trim().min(1, "RCON command cannot be empty.").max(1_000) });
export type RestAdminAction = z.infer<typeof restAdminActionSchema>;
