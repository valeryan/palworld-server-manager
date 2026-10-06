import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { setupTestDataDirectory } from "./prepare-database";

vi.mock("@/server/services/steamcmd", async (original) => ({ ...await original<typeof import("@/server/services/steamcmd")>(), installOrUpdate: vi.fn() }));
vi.mock("@/server/services/backups", async (original) => ({ ...await original<typeof import("@/server/services/backups")>(), createBackup: vi.fn(async () => "backup") }));
vi.mock("@/server/services/lifecycle", async (original) => ({ ...await original<typeof import("@/server/services/lifecycle")>(), startWorld: vi.fn(), stopWorld: vi.fn() }));

const dir = setupTestDataDirectory("psm-builds-test-");
const steamPayload = (buildid: string) => new Response(JSON.stringify({ data: { "2394010": { depots: { branches: { public: { buildid } } } } } }));
let port = 39700;
async function world(name: string, buildId: string | null) {
  const { createWorld } = await import("@/server/services/worlds");
  const { eq } = await import("drizzle-orm"); const { database } = await import("@/server/db"); const { worlds } = await import("@/server/db/schema");
  port += 4;
  const created = await createWorld({ displayName: name, installDir: path.join(dir.directory, name), gamePort: port, queryPort: port + 1, restApiPort: port + 2, rconPort: port + 3 });
  await database().update(worlds).set({ buildId }).where(eq(worlds.id, created.id));
  return created;
}
async function reset() { const { sqliteClient } = await import("@/server/db"); sqliteClient().exec("DELETE FROM jobs; DELETE FROM world_settings; DELETE FROM worlds; DELETE FROM app_settings;"); }
afterEach(async () => { vi.restoreAllMocks(); await reset(); });

describe("server builds", () => {
  it("checks the latest build once for every world and summarizes their state", async () => {
    const { refreshLatestBuild } = await import("@/server/services/steamcmd");
    const { buildSummary } = await import("@/server/services/builds");
    const { getWorld } = await import("@/server/services/worlds");
    const current = await world("current", "500"); const outdated = await world("outdated", "400"); const unknown = await world("unknown", null);
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => steamPayload("500"));
    expect(await refreshLatestBuild()).toBe("500");
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const id of [current.id, outdated.id, unknown.id]) expect((await getWorld(id))?.latestBuildId).toBe("500");
    const summary = await buildSummary();
    expect(summary.latest).toMatchObject({ buildId: "500" });
    expect(Object.fromEntries(summary.worlds.map((row) => [row.displayName, row.state]))).toEqual({ current: "current", outdated: "update-available", unknown: "unknown" });
    expect(summary.activeJob).toBeNull();
    expect(summary.steamCmd).toMatchObject({ installed: false, inUse: false });
  });

  it("updates outdated worlds one at a time, skipping busy ones", async () => {
    const steamcmd = await import("@/server/services/steamcmd");
    const { awaitJob, listJobs, startJob } = await import("@/server/services/jobs");
    const { holdWorldLock } = await import("@/server/services/locks");
    const { updateOutdatedWorlds } = await import("@/server/services/builds");
    const { eq } = await import("drizzle-orm"); const { database } = await import("@/server/db"); const { worlds } = await import("@/server/db/schema");
    const first = await world("first", "400"); await world("fresh", "500"); const second = await world("second", "300"); const locked = await world("locked", "200");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => steamPayload("500"));
    const order: string[] = [];
    vi.mocked(steamcmd.installOrUpdate).mockImplementation(async (target) => { order.push(target.displayName); await new Promise((resolve) => setTimeout(resolve, 20)); await database().update(worlds).set({ buildId: "500" }).where(eq(worlds.id, target.id)); });
    const parent = await holdWorldLock(locked.id, async () => awaitJob(await startJob(null, "update-all", updateOutdatedWorlds, { singleton: true })));
    expect(parent).toMatchObject({ state: "succeeded", message: "Updated 2 world(s); skipped 1" });
    expect(order).toEqual(["first", "second"]);
    const children = (await listJobs(500)).filter((job) => job.kind === "update-restart");
    expect(children.map((job) => job.worldId).sort()).toEqual([first.id, second.id].sort());
    expect(children.every((job) => job.state === "succeeded")).toBe(true);
    const [earlier, later] = children.sort((a, b) => a.createdAt - b.createdAt);
    expect(later!.startedAt!).toBeGreaterThanOrEqual(earlier!.finishedAt!);
    const { startWorld } = await import("@/server/services/lifecycle");
    expect(startWorld).not.toHaveBeenCalled();
  });

  it("fails the fleet update when a world update fails and refuses a concurrent run", async () => {
    const steamcmd = await import("@/server/services/steamcmd");
    const { awaitJob, listJobs, startJob } = await import("@/server/services/jobs");
    const { updateOutdatedWorlds } = await import("@/server/services/builds");
    await world("broken", "400");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => steamPayload("500"));
    vi.mocked(steamcmd.installOrUpdate).mockRejectedValue(new Error("Disk write failure"));
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const blockerId = await startJob(null, "update-all", async () => { await gate; }, { singleton: true });
    await expect(startJob(null, "update-all", updateOutdatedWorlds, { singleton: true })).rejects.toThrow("already running");
    release(); await awaitJob(blockerId);
    const parent = await awaitJob(await startJob(null, "update-all", updateOutdatedWorlds, { singleton: true }));
    expect(parent).toMatchObject({ state: "failed", error: "1 of 1 world updates failed; see each world's operations." });
    expect((await listJobs(500)).find((job) => job.kind === "update-restart")).toMatchObject({ state: "failed", error: "Disk write failure" });
  });

  it("cancels the running world update when the fleet update is cancelled", async () => {
    const steamcmd = await import("@/server/services/steamcmd");
    const { awaitJob, cancelJob, listJobs, startJob } = await import("@/server/services/jobs");
    const { updateOutdatedWorlds } = await import("@/server/services/builds");
    await world("slow", "400");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => steamPayload("500"));
    let started!: () => void; const childStarted = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(steamcmd.installOrUpdate).mockImplementation((_target, context) => new Promise<void>((_resolve, reject) => { started(); context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true }); }));
    const parentId = await startJob(null, "update-all", updateOutdatedWorlds, { singleton: true });
    await childStarted; await cancelJob(parentId);
    expect(await awaitJob(parentId)).toMatchObject({ state: "cancelled" });
    expect((await listJobs(500)).find((job) => job.kind === "update-restart")).toMatchObject({ state: "cancelled" });
  });
});
