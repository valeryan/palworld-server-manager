import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setupTestDataDirectory } from "./prepare-database";

const dir = setupTestDataDirectory("psm-removal-test-");
let port = 39500;
async function world(name: string, markers: string[] = ["PalServer.sh", "Pal/Saved/Level.sav"]) {
  const { createWorld } = await import("@/server/services/worlds");
  const installDir = path.join(dir.directory, name);
  for (const marker of markers) { await mkdir(path.dirname(path.join(installDir, marker)), { recursive: true }); await writeFile(path.join(installDir, marker), "fixture"); }
  port += 4;
  return createWorld({ displayName: name, installDir, gamePort: port, queryPort: port + 1, restApiPort: port + 2, rconPort: port + 3 });
}
const exists = (target: string) => access(target).then(() => true, () => false);
afterEach(() => vi.restoreAllMocks());

describe("removing a world and its files", () => {
  it("deletes the install directory and the manager-owned Wine prefix", async () => {
    const { getWorld, unregisterWorld } = await import("@/server/services/worlds");
    const { paths } = await import("@/server/paths");
    const created = await world("deleted-world");
    await mkdir(paths.winePrefix(created.id), { recursive: true }); await writeFile(path.join(paths.winePrefix(created.id), "system.reg"), "");
    await unregisterWorld(created.id, { deleteFiles: true });
    expect(await getWorld(created.id)).toBeNull();
    expect(await exists(created.installDir)).toBe(false);
    expect(await exists(paths.winePrefix(created.id))).toBe(false);
  });
  it("keeps every file without the delete option", async () => {
    const { getWorld, unregisterWorld } = await import("@/server/services/worlds");
    const created = await world("kept-world");
    await unregisterWorld(created.id);
    expect(await getWorld(created.id)).toBeNull();
    expect(await exists(path.join(created.installDir, "PalServer.sh"))).toBe(true);
  });
  it("refuses a folder that does not look like a server installation", async () => {
    const { getWorld, unregisterWorld } = await import("@/server/services/worlds");
    const created = await world("notes-world", ["notes.txt"]);
    await expect(unregisterWorld(created.id, { deleteFiles: true })).rejects.toThrow("does not look like a Palworld server installation");
    expect(await getWorld(created.id)).not.toBeNull();
    expect(await exists(path.join(created.installDir, "notes.txt"))).toBe(true);
  });
  it("allows a missing or empty folder", async () => {
    const { getWorld, unregisterWorld } = await import("@/server/services/worlds");
    const missing = await world("missing-world", []);
    await unregisterWorld(missing.id, { deleteFiles: true }); expect(await getWorld(missing.id)).toBeNull();
    const empty = await world("empty-world", []); await mkdir(empty.installDir, { recursive: true });
    await unregisterWorld(empty.id, { deleteFiles: true }); expect(await getWorld(empty.id)).toBeNull(); expect(await exists(empty.installDir)).toBe(false);
  });
  it("refuses a folder that holds another registered world", async () => {
    const { eq } = await import("drizzle-orm"); const { database } = await import("@/server/db"); const { worlds } = await import("@/server/db/schema");
    const { unregisterWorld } = await import("@/server/services/worlds");
    const outer = await world("outer-world"); const inner = await world("inner-world");
    await database().update(worlds).set({ installDir: path.join(outer.installDir, "nested") }).where(eq(worlds.id, inner.id));
    await expect(unregisterWorld(outer.id, { deleteFiles: true })).rejects.toThrow("shared with inner-world");
    expect(await exists(path.join(outer.installDir, "PalServer.sh"))).toBe(true);
  });
  it("refuses the home directory, a backup destination, and a filesystem root", async () => {
    const { eq } = await import("drizzle-orm"); const { database } = await import("@/server/db"); const { backupSettings, worlds } = await import("@/server/db/schema");
    const { unregisterWorld } = await import("@/server/services/worlds");
    const home = await world("home-world");
    vi.spyOn(process.getBuiltinModule("node:os"), "homedir").mockReturnValue(path.join(home.installDir, "user"));
    await expect(unregisterWorld(home.id, { deleteFiles: true })).rejects.toThrow("home directory");
    vi.restoreAllMocks();
    const backedUp = await world("backup-world");
    await database().insert(backupSettings).values({ worldId: backedUp.id, destinationDir: path.join(backedUp.installDir, "backups"), retentionCount: 0, updatedAt: Date.now() });
    await expect(unregisterWorld(backedUp.id, { deleteFiles: true })).rejects.toThrow("backup destination");
    const rooted = await world("root-world");
    await database().update(worlds).set({ installDir: path.parse(tmpdir()).root }).where(eq(worlds.id, rooted.id));
    await expect(unregisterWorld(rooted.id, { deleteFiles: true })).rejects.toThrow("filesystem root");
    expect(await exists(path.join(home.installDir, "PalServer.sh"))).toBe(true);
  });
});
