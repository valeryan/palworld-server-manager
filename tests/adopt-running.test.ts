import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setupTestDataDirectory } from "./prepare-database";

// A server that is already running from an installation (started by a previous manager instance,
// or by hand) is adopted instead of blocking the world: on registration, on Start, and at boot.
const dir = setupTestDataDirectory("psm-adopt-test-", { closeDatabase: true, dataSubdir: "manager-data" });
let port = 39800; const launched: number[] = [];
async function fakeInstall(name: string) {
  const installDir = path.join(dir.directory, name); const binary = path.join(installDir, "Pal", "Binaries", "Linux", "PalServer-Linux-Shipping");
  await mkdir(path.dirname(binary), { recursive: true }); await mkdir(path.join(installDir, "Pal", "Saved", "Config", "LinuxServer"), { recursive: true });
  await writeFile(path.join(installDir, "Pal", "Saved", "Config", "LinuxServer", "PalWorldSettings.ini"), `[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="${name}")\n`);
  await copyFile("/bin/sleep", binary); await chmod(binary, 0o755);
  await writeFile(path.join(installDir, "PalServer.sh"), `#!/bin/sh\nexec "${binary}" 600\n`); await chmod(path.join(installDir, "PalServer.sh"), 0o755);
  return installDir;
}
async function launchFake(installDir: string): Promise<void> {
  const child = spawn("/bin/sh", [path.join(installDir, "PalServer.sh")], { cwd: installDir, detached: true, stdio: "ignore" }); child.unref(); launched.push(child.pid!);
  const { processSnapshot } = await import("@/server/services/process-inspection"); const { runningServerTree } = await import("@/server/services/lifecycle");
  for (let attempt = 0; attempt < 100; attempt += 1) { if (runningServerTree(installDir, await processSnapshot()).length) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error("The fake server did not appear in the process table.");
}
const registration = (displayName: string, installDir: string) => { port += 4; return { displayName, installDir, platform: "linux", gamePort: port, queryPort: port + 1, restApiPort: port + 2, rconPort: port + 3, restApiEnabled: false }; };

beforeAll(() => { if (process.platform === "win32") throw new Error("Linux-only test."); });
afterAll(async () => { for (const pid of launched) { try { process.kill(-pid, "SIGKILL"); } catch { /* exited */ } try { process.kill(pid, "SIGKILL"); } catch { /* exited */ } } });

describe("adopting a server that is already running", () => {
  it("adopts the running server when the folder is registered and can stop it afterwards", async () => {
    const { registerWorld } = await import("@/server/services/installation"); const { stopWorld, runningServerTree } = await import("@/server/services/lifecycle");
    const { processSnapshot } = await import("@/server/services/process-inspection"); const { paths } = await import("@/server/paths"); const { getWorld } = await import("@/server/services/worlds");
    const { database } = await import("@/server/db"); const { events } = await import("@/server/db/schema"); const { eq } = await import("drizzle-orm");
    const { adoptRegisteredServer } = await import("@/server/services/lifecycle");
    const installDir = await fakeInstall("adopted"); await launchFake(installDir);
    const registered = await registerWorld(registration("Adopted", installDir), "adopt");
    expect(await adoptRegisteredServer(registered)).toBe(true);
    const world = (await getWorld(registered.id))!;
    expect(world).toMatchObject({ status: "running" }); expect(world.processId).toBeTypeOf("number");
    expect(JSON.parse(await readFile(path.join(installDir, ".psm-runtime-owner.json"), "utf8"))).toMatchObject({ profile: paths.data(), owner: { pid: process.pid } });
    expect((await database().select().from(events).where(eq(events.worldId, world.id))).map((row) => row.message)).toEqual([expect.stringMatching(/^Adopted a server already running/)]);
    await stopWorld(world.id, true);
    expect(await getWorld(world.id)).toMatchObject({ status: "stopped", processId: null });
    expect(runningServerTree(installDir, await processSnapshot())).toEqual([]);
    expect(await readFile(path.join(installDir, ".psm-runtime-owner.json")).catch(() => null)).toBeNull();
  });

  it("refuses a server owned by another live manager profile, then adopts it on Start once that lease is gone", async () => {
    const { registerWorld } = await import("@/server/services/installation"); const { startWorld, stopWorld } = await import("@/server/services/lifecycle");
    const { processSnapshot } = await import("@/server/services/process-inspection"); const { getWorld } = await import("@/server/services/worlds");
    const installDir = await fakeInstall("foreign");
    const world = await registerWorld(registration("Foreign", installDir), "adopt"); expect(world).toMatchObject({ status: "stopped" });
    await launchFake(installDir);
    const me = (await processSnapshot()).find((row) => row.pid === process.pid)!;
    const lease = path.join(installDir, ".psm-runtime-owner.json"); await writeFile(lease, JSON.stringify({ profile: "/elsewhere/manager-data", owner: me, processes: [] }));
    const { assertAdoptableInstall } = await import("@/server/services/lifecycle");
    await expect(startWorld(world.id)).rejects.toThrow("another profile");
    await expect(assertAdoptableInstall(installDir)).rejects.toThrow("another profile");
    await rm(lease);
    await startWorld(world.id);
    const adopted = await getWorld(world.id); expect(adopted).toMatchObject({ status: "running" });
    expect((await processSnapshot()).filter((row) => row.executable.startsWith(installDir))).toHaveLength(1);
    await stopWorld(world.id, true); expect(await getWorld(world.id)).toMatchObject({ status: "stopped" });
  });

  it("adopts orphaned servers of stopped worlds at boot", async () => {
    const { registerWorld } = await import("@/server/services/installation"); const { adoptOrphanedServers, stopWorld } = await import("@/server/services/lifecycle"); const { getWorld } = await import("@/server/services/worlds");
    const installDir = await fakeInstall("boot");
    const world = await registerWorld(registration("Boot", installDir), "adopt"); expect(world).toMatchObject({ status: "stopped" });
    await launchFake(installDir);
    await adoptOrphanedServers();
    expect(await getWorld(world.id)).toMatchObject({ status: "running" });
    await stopWorld(world.id, true);
  });
});
