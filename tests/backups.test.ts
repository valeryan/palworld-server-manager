import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { setupTestDataDirectory } from "./prepare-database";

// The Backups tab end to end against a scratch install: archive, verify, retention, custom destination,
// the save flush a running server gets first, and a restore that puts the files back.
const dir = setupTestDataDirectory("psm-backups-test-");
const context = { signal: new AbortController().signal, update: async () => {}, log: () => {} };
const ini = (name: string) => `[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="${name}")\n`;
const exists = (target: string) => access(target).then(() => true, () => false);
let port = 39600;
async function world(name: string) {
  const { createWorld } = await import("@/server/services/worlds");
  const installDir = path.join(dir.directory, name); const saved = path.join(installDir, "Pal", "Saved");
  await mkdir(path.join(saved, "Config", "LinuxServer"), { recursive: true }); await mkdir(path.join(saved, "SaveGames", "0", "WORLD", "backup"), { recursive: true });
  await writeFile(path.join(installDir, "PalServer.sh"), "fixture");
  await writeFile(path.join(saved, "Config", "LinuxServer", "PalWorldSettings.ini"), ini(name));
  await writeFile(path.join(saved, "SaveGames", "0", "WORLD", "Level.sav"), "level-1");
  await writeFile(path.join(saved, "SaveGames", "0", "WORLD", "backup", "old.sav"), "palworld rolling backup");
  port += 4;
  const created = await createWorld({ displayName: name, installDir, gamePort: port, queryPort: port + 1, restApiPort: port + 2, rconPort: port + 3 });
  return { ...created, saved };
}
afterEach(() => vi.restoreAllMocks());

describe("backups", () => {
  it("archives the save folder into a verified zip in the manager's default location", async () => {
    const { createBackup, getBackup } = await import("@/server/services/backups");
    const { paths } = await import("@/server/paths");
    const created = await world("default-destination");
    const id = await createBackup(created.id, "manual", context);
    const record = await getBackup(created.id, id);
    expect(record).toMatchObject({ reason: "manual", verified: true });
    expect(path.dirname(record.filePath)).toBe(paths.backups(created.id));
    const entries = new AdmZip(record.filePath).getEntries().map((entry) => entry.entryName);
    expect(entries).toContain("Saved/Config/LinuxServer/PalWorldSettings.ini");
    expect(entries).toContain("Saved/SaveGames/0/WORLD/Level.sav");
    expect(entries.some((entry) => entry.includes("/backup/"))).toBe(false);
  });

  it("writes to a custom destination and refuses one inside the installation", async () => {
    const { createBackup, getBackup, updateBackupSettings } = await import("@/server/services/backups");
    const created = await world("custom-destination");
    const destination = path.join(dir.directory, "external-drive", "palworld");
    await updateBackupSettings(created.id, { destinationDir: destination, retentionCount: 0 });
    const record = await getBackup(created.id, await createBackup(created.id, "manual", context));
    expect(path.dirname(record.filePath)).toBe(destination);
    await expect(updateBackupSettings(created.id, { destinationDir: path.join(created.installDir, "backups"), retentionCount: 0 })).rejects.toThrow();
  });

  it("keeps only the newest backups under the retention limit", async () => {
    const { createBackup, listBackups, updateBackupSettings } = await import("@/server/services/backups");
    const { paths } = await import("@/server/paths");
    const created = await world("retention");
    await updateBackupSettings(created.id, { destinationDir: null, retentionCount: 2 });
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) { ids.push(await createBackup(created.id, "scheduled", context)); await new Promise((resolve) => setTimeout(resolve, 5)); }
    const remaining = await listBackups(created.id);
    expect(remaining.map((row) => row.id).sort()).toEqual(ids.slice(1).sort());
    expect((await readdir(paths.backups(created.id))).filter((name) => name.endsWith(".zip"))).toHaveLength(2);
  });

  it("asks a running server to save first and still archives when the save call fails", async () => {
    const { createBackup } = await import("@/server/services/backups");
    const { palworldRest } = await import("@/server/services/rest");
    const { setRuntimeState } = await import("@/server/services/worlds");
    const created = await world("save-flush");
    const save = vi.spyOn(palworldRest, "save").mockResolvedValue({});
    await createBackup(created.id, "scheduled", context);
    expect(save).not.toHaveBeenCalled();
    await setRuntimeState(created.id, "running", 4242);
    await createBackup(created.id, "scheduled", context);
    expect(save).toHaveBeenCalledTimes(1);
    save.mockRejectedValue(new Error("REST unreachable"));
    await expect(createBackup(created.id, "scheduled", context)).resolves.toBeTypeOf("string");
    await setRuntimeState(created.id, "stopped", null);
  });

  it("restores a backup onto a stopped server after taking a safety backup", async () => {
    const { createBackup, listBackups, restoreBackup } = await import("@/server/services/backups");
    const { setRuntimeState } = await import("@/server/services/worlds");
    const created = await world("restore");
    const level = path.join(created.saved, "SaveGames", "0", "WORLD", "Level.sav"); const settings = path.join(created.saved, "Config", "LinuxServer", "PalWorldSettings.ini");
    const id = await createBackup(created.id, "manual", context);
    await writeFile(level, "level-2"); await writeFile(settings, ini("changed"));
    await setRuntimeState(created.id, "running", 4242);
    await expect(restoreBackup(created.id, id, context)).rejects.toThrow("Stop the server");
    await setRuntimeState(created.id, "stopped", null);
    await restoreBackup(created.id, id, context);
    expect(await readFile(level, "utf8")).toBe("level-1");
    expect(await readFile(settings, "utf8")).toBe(ini("restore"));
    expect((await listBackups(created.id)).some((row) => row.reason === `pre-restore-${id}`)).toBe(true);
    const siblings = await readdir(path.dirname(created.saved));
    expect(siblings.some((name) => name.startsWith("Saved.before-"))).toBe(true);
    expect(await exists(created.saved)).toBe(true);
  });
});
