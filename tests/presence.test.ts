import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { setupTestDataDirectory } from "./prepare-database";

const dir = setupTestDataDirectory("psm-presence-test-");
const roster = (...players: Array<[string, string]>) => ({ players: players.map(([userId, name]) => ({ userId, name, accountName: `${name.toLowerCase()}#1`, level: 1 })) });
afterEach(() => vi.restoreAllMocks());

describe("player presence", () => {
  it("remembers every player it sees and tracks joins, leaves, and bans", async () => {
    const { createWorld, setRuntimeState } = await import("@/server/services/worlds");
    const { presenceTick } = await import("@/server/services/runtime/presence");
    const { knownPlayers } = await import("@/server/services/observability");
    const { runRestAdminAction } = await import("@/server/services/administration");
    const { palworldRest } = await import("@/server/services/rest");
    const { database } = await import("@/server/db"); const { sessions } = await import("@/server/db/schema");
    const world = await createWorld({ displayName: "Presence", installDir: path.join(dir.directory, "presence-world"), gamePort: 39611, queryPort: 39612, restApiPort: 39613, rconPort: 39614, restApiEnabled: true });
    await setRuntimeState(world.id, "running", process.pid);
    const players = vi.spyOn(palworldRest, "players");
    players.mockResolvedValueOnce(roster(["steam_a", "Alice"])); await presenceTick();
    expect(await knownPlayers(world.id)).toMatchObject([{ userId: "steam_a", playerName: "Alice", accountName: "alice#1", joinCount: 1, lastLeftAt: null }]);
    expect(await database().select().from(sessions)).toHaveLength(0);
    players.mockResolvedValueOnce(roster(["steam_a", "Alice"], ["steam_b", "Bob"])); await presenceTick();
    expect((await knownPlayers(world.id)).map((player) => [player.userId, player.joinCount])).toEqual(expect.arrayContaining([["steam_a", 1], ["steam_b", 1]]));
    expect((await database().select().from(sessions)).map((row) => [row.userId, row.event])).toEqual([["steam_b", "join"]]);
    players.mockResolvedValueOnce(roster(["steam_b", "Bob"])); await presenceTick();
    const left = (await knownPlayers(world.id)).find((player) => player.userId === "steam_a")!;
    expect(left.lastLeftAt).not.toBeNull();
    players.mockResolvedValueOnce(roster(["steam_a", "Alice A"], ["steam_b", "Bob"])); await presenceTick();
    expect((await knownPlayers(world.id)).find((player) => player.userId === "steam_a")).toMatchObject({ playerName: "Alice A", joinCount: 2 });
    vi.spyOn(palworldRest, "ban").mockResolvedValue({}); vi.spyOn(palworldRest, "unban").mockResolvedValue({});
    await runRestAdminAction(world.id, { action: "ban", userId: "steam_b", playerName: "Bob" });
    expect((await knownPlayers(world.id)).find((player) => player.userId === "steam_b")?.bannedAt).toBeTypeOf("number");
    await runRestAdminAction(world.id, { action: "unban", userId: "steam_b" });
    expect((await knownPlayers(world.id)).find((player) => player.userId === "steam_b")?.bannedAt).toBeNull();
    await setRuntimeState(world.id, "stopped", null);
  });
});
