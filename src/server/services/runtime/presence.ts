import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { database } from "@/server/db";
import { sessions, worldPlayers } from "@/server/db/schema";
import { palworldRest } from "../rest";
import { listWorlds } from "../worlds";
import { fireJoinSchedules } from "./join";
import { playersFrom, presence, type Player } from "./players";

// Remembers every identified player: a new row on first sight, otherwise the latest name and
// seen time. `joined` keys count as another join; the first poll after startup only seeds.
async function rememberPlayers(worldId: string, players: Iterable<Player>, joined: Set<string>, now: number): Promise<void> {
  for (const player of players) {
    if (!player.userId) continue;
    await database().insert(worldPlayers).values({ worldId, userId: player.userId, playerName: player.name, accountName: player.accountName, firstSeenAt: now, lastSeenAt: now, joinCount: 1 })
      .onConflictDoUpdate({ target: [worldPlayers.worldId, worldPlayers.userId], set: { playerName: player.name, accountName: player.accountName, lastSeenAt: now, ...(joined.has(player.key) ? { joinCount: sql`${worldPlayers.joinCount} + 1` } : {}) } });
  }
}

/** Polls every running world for its players, records joins and leaves, and fires on-join schedules. */
export async function presenceTick(): Promise<void> {
  for (const world of await listWorlds()) {
    if (world.status !== "running" || !world.restApiEnabled) { presence().delete(world.id); continue; }
    let current: Map<string, Player>;
    try { current = new Map(playersFrom(await palworldRest.players(world)).map((player) => [player.key, player])); } catch { continue; }
    const previous = presence().get(world.id);
    presence().set(world.id, current);
    const now = Date.now();
    const joined = new Set(previous ? [...current.keys()].filter((key) => !previous.has(key)) : []);
    await rememberPlayers(world.id, current.values(), joined, now);
    if (!previous) continue;
    for (const key of joined) {
      const player = current.get(key)!;
      await database().insert(sessions).values({ worldId: world.id, userId: player.userId, playerName: player.name, event: "join", createdAt: now });
      await fireJoinSchedules(world.id, player);
    }
    for (const [key, player] of previous) if (!current.has(key)) {
      await database().insert(sessions).values({ worldId: world.id, userId: player.userId, playerName: player.name, event: "leave", createdAt: now });
      if (player.userId) await database().update(worldPlayers).set({ lastLeftAt: now, lastSeenAt: now }).where(and(eq(worldPlayers.worldId, world.id), eq(worldPlayers.userId, player.userId)));
    }
  }
}
