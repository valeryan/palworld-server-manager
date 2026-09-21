import "server-only";
import { database } from "@/server/db";
import { events } from "@/server/db/schema";
import type { RestAdminAction } from "@/contracts/admin";
import { getWorld } from "./worlds";
import { palworldRest } from "./rest";

export async function runRestAdminAction(worldId: string, action: RestAdminAction): Promise<unknown> {
  const world = await getWorld(worldId);
  if (!world) throw new Error("World not found.");
  if (world.status !== "running") throw new Error("Start the server before using live administration controls.");
  if (!world.restApiEnabled) throw new Error("Enable the REST API and restart the server before using live administration controls.");
  let result: unknown;
  if (action.action === "announce") result = await palworldRest.announce(world, action.message);
  else if (action.action === "save") result = await palworldRest.save(world);
  else if (action.action === "kick") result = await palworldRest.kick(world, action.userId, action.message);
  else if (action.action === "ban") result = await palworldRest.ban(world, action.userId, action.message);
  else result = await palworldRest.unban(world, action.userId);
  const target = "userId" in action ? ` for ${action.userId}` : "";
  await database().insert(events).values({ worldId, kind: "administrator", message: `${action.action === "announce" ? "Sent server announcement" : action.action === "save" ? "Saved the world" : `${action.action.charAt(0).toUpperCase()}${action.action.slice(1)} completed${target}`}`, createdAt: Date.now() });
  return result;
}
