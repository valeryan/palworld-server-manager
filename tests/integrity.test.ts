import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { prepareTestDatabase } from "./prepare-database";
import { context, exists, linuxArchive, stage, windowsArchive } from "./mod-fixtures";

let directory: string;
async function world(name: string, platform: "windows" | "linux") {
  const installDir = path.join(directory, name);
  await mkdir(path.join(installDir, "Pal", "Binaries", platform === "windows" ? "Win64" : "Linux"), { recursive: true });
  const { createWorld } = await import("@/server/services/worlds");
  return createWorld({ displayName: name, installDir, platform });
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "psm-integrity-"));
  process.env.PALWORLD_MANAGER_DATA_DIR = path.join(directory, "data");
  process.env.PALWORLD_MANAGER_DB = path.join(directory, "data", "registry-v3.sqlite");
  await prepareTestDatabase(process.env.PALWORLD_MANAGER_DATA_DIR, process.env.PALWORLD_MANAGER_DB);
  await stage("windows", windowsArchive()); await stage("linux", linuxArchive());
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("managed mod checks", () => {
  it("finds missing and changed UE4SS files and restores them from the library", async () => {
    const { checkManagedMods, repairManagedMods } = await import("@/server/mods/integrity");
    const { installUe4ss } = await import("@/server/mods/ue4ss-runtime");
    const target = await world("linux-repair", "linux");
    await installUe4ss(target, { replace: false }, context());
    expect(await checkManagedMods(target)).toEqual({ checked: 1, needsRepair: false, problems: [] });
    await rm(path.join(target.installDir, "libUE4SS.so"));
    await writeFile(path.join(target.installDir, "UE4SS-settings.ini"), "replaced by an update\n");
    expect((await checkManagedMods(target)).problems).toEqual([{ kind: "ue4ss", name: "UE4SS", missing: 1, changed: 1, repairable: true }]);
    await repairManagedMods(target, context());
    expect(await exists(path.join(target.installDir, "libUE4SS.so"))).toBe(true);
    expect(await readFile(path.join(target.installDir, "UE4SS-settings.ini"), "utf8")).toContain("GuiConsoleVisible = 0");
    expect((await checkManagedMods(target)).needsRepair).toBe(false);
  });

  it("treats a disabled Windows install's parked loader as intact and keeps it disabled through repair", async () => {
    const { checkManagedMods, repairManagedMods } = await import("@/server/mods/integrity");
    const { installUe4ss, runtimeRow, setUe4ssEnabled } = await import("@/server/mods/ue4ss-runtime");
    const target = await world("win-repair", "windows"); const win64 = path.join(target.installDir, "Pal", "Binaries", "Win64");
    await installUe4ss(target, { replace: false }, context()); await setUe4ssEnabled(target, false);
    expect((await checkManagedMods(target)).needsRepair).toBe(false);
    await rm(path.join(win64, "ue4ss", "UE4SS.dll"));
    await repairManagedMods(target, context());
    expect(await exists(path.join(win64, "ue4ss", "UE4SS.dll"))).toBe(true);
    expect(await exists(path.join(win64, "dwmapi.dll"))).toBe(false);
    expect(await exists(path.join(win64, "dwmapi.dll.psm-disabled"))).toBe(true);
    expect((await runtimeRow(target.id))?.enabled).toBe(false);
  });

  it("repairs an edited relay without turning it back on", async () => {
    const { checkManagedMods, repairManagedMods } = await import("@/server/mods/integrity");
    const { installRelay } = await import("@/server/mods/relays"); const { setLuaModEnabled } = await import("@/server/mods/lua-mods");
    const target = await world("linux-relay-repair", "linux");
    await installRelay(target, "broadcast"); await setLuaModEnabled(target, "PSMBroadcast", false);
    const script = path.join(target.installDir, "Mods", "PSMBroadcast", "Scripts", "main.lua");
    await writeFile(script, "-- edited");
    expect((await checkManagedMods(target)).problems).toEqual([{ kind: "relay", name: "broadcast", missing: 0, changed: 1, repairable: true }]);
    await repairManagedMods(target, context());
    expect(await readFile(script, "utf8")).toContain("PSMBroadcast");
    expect(await readFile(path.join(target.installDir, "Mods", "mods.txt"), "utf8")).toBe("PSMBroadcast : 0\n");
  });

  it("refuses to repair a Lua mod whose library copy is gone, and says so", async () => {
    const { checkManagedMods, repairManagedMods } = await import("@/server/mods/integrity");
    const { importLuaArchive, removeLuaArtifact } = await import("@/server/mods/lua-library"); const { installLuaMod } = await import("@/server/mods/lua-mods");
    const target = await world("linux-lua-repair", "linux");
    const zip = new AdmZip(); zip.addFile("Gone/Scripts/main.lua", Buffer.from("-- mod")); zip.addFile("Gone/data.lua", Buffer.from("-- data"));
    const artifact = await importLuaArchive(zip.toBuffer(), "gone.zip");
    await installLuaMod(target, artifact.id);
    await rm(path.join(target.installDir, "Mods", "Gone", "data.lua"));
    expect((await checkManagedMods(target)).problems).toEqual([{ kind: "lua", name: "Gone", missing: 1, changed: 0, repairable: true }]);
    await removeLuaArtifact(artifact.id);
    expect((await checkManagedMods(target)).problems[0]?.repairable).toBe(false);
    await expect(repairManagedMods(target, context())).rejects.toThrow("library copy is missing for Gone");
  });
});
