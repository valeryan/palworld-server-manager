import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { database } from "@/server/db";
import { events, sessions, worldPlayers } from "@/server/db/schema";
import type { RestAdminAction } from "@/contracts/admin";
import { moderationEventMessage } from "@/lib/moderation-presentation";
import { ConflictError } from "@/server/errors";
import { requireWorld } from "./worlds";
import { palworldRest } from "./rest";

export async function runRestAdminAction(worldId: string, action: RestAdminAction): Promise<unknown> {
  const world = await requireWorld(worldId);
  if (world.status !== "running") throw new ConflictError("Start the server before using live administration controls.");
  if (!world.restApiEnabled) throw new ConflictError("Enable the REST API and restart the server before using live administration controls.");
  let result: unknown;
  if (action.action === "announce") result = await palworldRest.announce(world, action.message);
  else if (action.action === "save") result = await palworldRest.save(world);
  else if (action.action === "kick") result = await palworldRest.kick(world, action.userId, action.message);
  else if (action.action === "ban") result = await palworldRest.ban(world, action.userId, action.message);
  else result = await palworldRest.unban(world, action.userId);
  let message: string;
  let metadata: Record<string, unknown> | null = null;
  if ("userId" in action) {
    const providedName = action.playerName === action.userId ? undefined : action.playerName;
    const recentSession = !providedName ? (await database().select({ playerName: sessions.playerName }).from(sessions).where(and(eq(sessions.worldId, worldId), eq(sessions.userId, action.userId))).orderBy(desc(sessions.createdAt)).limit(1))[0] : undefined;
    const playerName = providedName ?? recentSession?.playerName ?? null;
    message = moderationEventMessage(action.action, action.userId, playerName);
    metadata = { action: action.action, userId: action.userId, playerName };
    if (action.action !== "kick") await database().update(worldPlayers).set({ bannedAt: action.action === "ban" ? Date.now() : null }).where(and(eq(worldPlayers.worldId, worldId), eq(worldPlayers.userId, action.userId)));
  } else message = action.action === "announce" ? "Sent server announcement" : "Saved the world";
  await database().insert(events).values({ worldId, kind: "administrator", message, metadata, createdAt: Date.now() });
  return result;
}
