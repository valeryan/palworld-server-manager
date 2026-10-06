import "server-only";
import { database } from "@/server/db";
import { sessions } from "@/server/db/schema";
import { palworldRest } from "../rest";
import { listWorlds } from "../worlds";
import { fireJoinSchedules } from "./join";
import { playersFrom, presence, type Player } from "./players";

/** Polls every running world for its players, records joins and leaves, and fires on-join schedules. */
export async function presenceTick(): Promise<void> {
  for (const world of await listWorlds()) {
    if (world.status !== "running" || !world.restApiEnabled) { presence().delete(world.id); continue; }
    let current: Map<string, Player>;
    try { current = new Map(playersFrom(await palworldRest.players(world)).map((player) => [player.key, player])); } catch { continue; }
    const previous = presence().get(world.id);
    presence().set(world.id, current);
    if (!previous) continue;
    for (const [key, player] of current) if (!previous.has(key)) {
      await database().insert(sessions).values({ worldId: world.id, userId: player.userId, playerName: player.name, event: "join", createdAt: Date.now() });
      await fireJoinSchedules(world.id, player);
    }
    for (const [key, player] of previous) if (!current.has(key)) await database().insert(sessions).values({ worldId: world.id, userId: player.userId, playerName: player.name, event: "leave", createdAt: Date.now() });
  }
}
