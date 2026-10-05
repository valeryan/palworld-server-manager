import { describe, expect, it, vi } from "vitest";
import { appendFile, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { setupTestDataDirectory } from "./prepare-database";
import { exists, world as worldFixture } from "./mod-fixtures";

const dir = setupTestDataDirectory("psm-relays-");
async function world(name: string, platform: "windows" | "linux") { return worldFixture(dir.directory, name, platform); }
async function enableUe4ss(worldId: string, variant: "windows" | "linux") {
  const { database } = await import("@/server/db"); const { modRuntimes } = await import("@/server/db/schema");
  await database().insert(modRuntimes).values({ worldId, artifactId: `ue4ss-${variant}`, variant, version: "test", sha256: "0".repeat(64), enabled: true, installedFiles: [], installedAt: 1, updatedAt: 1 });
}

describe("relay scripts", () => {
  it("fills in the world's path as the game sees it, and carries a version", async () => {
    const { relayVersion, renderRelay } = await import("@/server/mods/relays");
    const source = await readFile(path.join(process.cwd(), "src/server/mods/lua/PSMDeathRelay/Scripts/main.lua"), "utf8");
    expect(relayVersion(source)).toBeGreaterThan(0);
    expect(renderRelay(source, "death-relay", { installDir: "/srv/pal", platform: "linux" })).toContain("[[/srv/pal/Pal/Saved/psm-deaths.jsonl]]");
    expect(renderRelay(source, "death-relay", { installDir: "/srv/wine", platform: "windows" })).toContain("[[Z:/srv/wine/Pal/Saved/psm-deaths.jsonl]]");
    const broadcast = await readFile(path.join(process.cwd(), "src/server/mods/lua/PSMBroadcast/Scripts/main.lua"), "utf8");
    expect(broadcast).toContain('FindFirstOf("PalGameStateInGame")');
    expect(renderRelay(broadcast, "broadcast", { installDir: "/srv/pal", platform: "linux" })).not.toContain("__PSM_QUEUE_PATH__");
  });
});

describe("relays in worlds", () => {
  it("installs a relay, reports it active only while UE4SS is enabled, and keeps it out of the Lua list", async () => {
    const { installRelay, relayStatus } = await import("@/server/mods/relays"); const { worldModStatus } = await import("@/server/mods/status");
    const target = await world("linux-relay", "linux");
    await installRelay(target, "death-relay");
    const folder = path.join(target.installDir, "Mods", "PSMDeathRelay");
    expect(await readFile(path.join(folder, "Scripts", "main.lua"), "utf8")).toContain(`[[${target.installDir}/Pal/Saved/psm-deaths.jsonl]]`);
    expect(JSON.parse(await readFile(path.join(folder, "psm-mod.json"), "utf8"))).toMatchObject({ builtin: "death-relay" });
    expect(await readFile(path.join(target.installDir, "Mods", "mods.txt"), "utf8")).toBe("PSMDeathRelay : 1\n");
    expect((await relayStatus(target)).find((relay) => relay.id === "death-relay")).toMatchObject({ installed: true, managed: true, enabled: true, active: false, updateAvailable: false });
    await enableUe4ss(target.id, "linux");
    expect((await relayStatus(target)).find((relay) => relay.id === "death-relay")?.active).toBe(true);
    expect((await worldModStatus(target.id)).luaMods.map((mod) => mod.name)).not.toContain("PSMDeathRelay");
  });

  it("does not overwrite a relay copy PSM did not install unless replacing", async () => {
    const { installRelay } = await import("@/server/mods/relays");
    const target = await world("win-relay", "windows");
    const folder = path.join(target.installDir, "Pal", "Binaries", "Win64", "ue4ss", "Mods", "PSMBroadcast");
    await mkdir(path.join(folder, "Scripts"), { recursive: true }); await writeFile(path.join(folder, "Scripts", "main.lua"), "-- older copy");
    await expect(installRelay(target, "broadcast")).rejects.toThrow("not installed by PSM");
    await installRelay(target, "broadcast", { replace: true });
    expect(await readFile(path.join(folder, "Scripts", "main.lua"), "utf8")).toContain("[[Z:");
  });
});

describe("death capture", () => {
  it("records complete lines once, waits for partial lines, skips bad lines, and restarts after truncation", async () => {
    const { readNewDeaths } = await import("@/server/mods/relays");
    const { database } = await import("@/server/db"); const { deaths } = await import("@/server/db/schema"); const { eq } = await import("drizzle-orm");
    const target = await world("linux-deaths", "linux"); const file = path.join(target.installDir, "Pal", "Saved", "psm-deaths.jsonl");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{"victim":"Ana","cause":"Attack","killer":"KingSunfish","killerKind":"pal","at":1000}\nnot json\n{"victim":"Bo","cause":"Falli');
    expect(await readNewDeaths(target)).toBe(1);
    expect(await readNewDeaths(target)).toBe(0);
    await appendFile(file, 'ng","killer":"","killerKind":"","at":2000}\n');
    expect(await readNewDeaths(target)).toBe(1);
    const rows = await database().select().from(deaths).where(eq(deaths.worldId, target.id));
    expect(rows.map((row) => [row.victim, row.cause, row.killer, row.killerKind, row.createdAt])).toEqual([["Ana", "Attack", "KingSunfish", "pal", 1000], ["Bo", "Falling", null, null, 2000]]);
    await writeFile(file, '{"victim":"Cy","cause":"Drown","at":3000}\n');
    expect(await readNewDeaths(target)).toBe(1);
  });

  it("does not record a death twice when reads overlap", async () => {
    const { readNewDeaths } = await import("@/server/mods/relays");
    const { database } = await import("@/server/db"); const { deaths } = await import("@/server/db/schema"); const { eq } = await import("drizzle-orm");
    const target = await world("linux-overlap", "linux"); const file = path.join(target.installDir, "Pal", "Saved", "psm-deaths.jsonl");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{"victim":"Ana","cause":"Attack","at":1}\n{"victim":"Bo","cause":"Drown","at":2}\n');
    const counts = await Promise.all([readNewDeaths(target), readNewDeaths(target), readNewDeaths(target)]);
    expect(counts.reduce((total, count) => total + count, 0)).toBe(2);
    expect(await database().select().from(deaths).where(eq(deaths.worldId, target.id))).toHaveLength(2);
  });
});

describe("notices", () => {
  it("queues an on-screen notice for PSM Broadcast when it runs, and falls back to REST otherwise", async () => {
    const { deliverNotice, installRelay } = await import("@/server/mods/relays"); const { palworldRest } = await import("@/server/services/rest");
    const announce = vi.spyOn(palworldRest, "announce").mockResolvedValue(undefined as never);
    const target = await world("linux-notice", "linux");
    expect(await deliverNotice(target, "Restarting soon")).toBe("rest");
    expect(announce).toHaveBeenCalledWith(target, "Restarting soon");
    await installRelay(target, "broadcast"); await enableUe4ss(target.id, "linux");
    // Installed and enabled, but not yet running in the game: the notice goes out as chat.
    expect(await deliverNotice(target, "Still booting")).toBe("rest");
    const alive = path.join(target.installDir, "Pal", "Saved", "psm-broadcast.alive");
    await writeFile(alive, "1");
    expect(await deliverNotice(target, "Überraschung \"quotes\"\nline")).toBe("broadcast");
    const queued = JSON.parse((await readFile(path.join(target.installDir, "Pal", "Saved", "psm-broadcast.jsonl"), "utf8")).trim());
    expect(Buffer.from(queued.b64, "base64").toString("utf8")).toBe("Überraschung \"quotes\"\nline");
    expect(announce).toHaveBeenCalledTimes(2);
    expect(await exists(path.join(target.installDir, "Mods", "PSMBroadcast", "Scripts", "main.lua"))).toBe(true);
    const stale = new Date(Date.now() - 60_000); await utimes(alive, stale, stale);
    expect(await deliverNotice(target, "Relay stopped")).toBe("rest");
  });

  it("empties the queue and drops the old heartbeat before a start, and the relay reads from the top", async () => {
    const { resetBroadcastQueue } = await import("@/server/mods/relays");
    const target = await world("linux-reset", "linux"); const saved = path.join(target.installDir, "Pal", "Saved");
    await mkdir(saved, { recursive: true });
    await writeFile(path.join(saved, "psm-broadcast.jsonl"), '{"b64":"b2xk","at":1}\n'); await writeFile(path.join(saved, "psm-broadcast.alive"), "1");
    await resetBroadcastQueue(target);
    expect(await readFile(path.join(saved, "psm-broadcast.jsonl"), "utf8")).toBe("");
    expect(await exists(path.join(saved, "psm-broadcast.alive"))).toBe(false);
    const source = await readFile(path.join(process.cwd(), "src/server/mods/lua/PSMBroadcast/Scripts/main.lua"), "utf8");
    expect(source).not.toContain('seek("end") or 0; file:close() end');
    expect(source).toContain("psm-broadcast.alive");
  });
});
