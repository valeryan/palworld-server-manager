import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { prepareTestDatabase } from "./prepare-database";
import { setModsTxtEntry } from "@/server/mods/lua-mods";
import { readLuaArchive } from "@/server/mods/lua-library";
import { parsePalModSettings, updatePalModSettings } from "@/server/mods/workshop-mods";

let directory: string;
async function exists(target: string): Promise<boolean> { try { await stat(target); return true; } catch { return false; } }
async function put(file: string, content = ""): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); }
function archive(files: Record<string, string>): Buffer { const zip = new AdmZip(); for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content)); return zip.toBuffer(); }
async function world(name: string, platform: "windows" | "linux") {
  const installDir = path.join(directory, name);
  await mkdir(path.join(installDir, "Pal", "Binaries", platform === "windows" ? "Win64" : "Linux"), { recursive: true });
  const { createWorld } = await import("@/server/services/worlds");
  return createWorld({ displayName: name, installDir, platform });
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "psm-lua-workshop-"));
  process.env.PALWORLD_MANAGER_DATA_DIR = path.join(directory, "data");
  process.env.PALWORLD_MANAGER_DB = path.join(directory, "data", "registry-v3.sqlite");
  await prepareTestDatabase(process.env.PALWORLD_MANAGER_DATA_DIR, process.env.PALWORLD_MANAGER_DB);
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("mods.txt editing", () => {
  it("changes one entry, keeps comments and line endings, and inserts above Keybinds", () => {
    const shipped = "CheatManagerEnablerMod : 1\r\n\r\n; Built-in keybinds, do not move up!\r\nKeybinds : 1\r\n";
    expect(setModsTxtEntry(shipped, "MyMod", true)).toBe("CheatManagerEnablerMod : 1\r\n\r\nMyMod : 1\r\n; Built-in keybinds, do not move up!\r\nKeybinds : 1\r\n");
    expect(setModsTxtEntry("MyMod : 1\nOther : 1\n", "MyMod", false)).toBe("MyMod : 0\nOther : 1\n");
    expect(setModsTxtEntry("MyMod : 1\nOther : 1\n", "MyMod", null)).toBe("Other : 1\n");
    expect(setModsTxtEntry("", "MyMod", true)).toBe("MyMod : 1\n");
  });
});

describe("Lua mod archives", () => {
  it("finds the single mod, names it by its folder, and leaves enabled.txt out", () => {
    const read = readLuaArchive(new AdmZip(archive({ "Download/CoolMod/Scripts/main.lua": "--", "Download/CoolMod/enabled.txt": "", "Download/CoolMod/config.lua": "x=1", "README.md": "" })), "cool-1.2.zip");
    expect(read.name).toBe("CoolMod");
    expect(read.files.map((file) => file.relative).sort()).toEqual(["Scripts/main.lua", "config.lua"]);
    expect(readLuaArchive(new AdmZip(archive({ "scripts/main.lua": "--" })), "Bare Mod.zip").name).toBe("Bare_Mod");
  });

  it("rejects archives that are not exactly one importable Lua mod", () => {
    expect(() => readLuaArchive(new AdmZip(archive({ "readme.txt": "" })), "x.zip")).toThrow("no Scripts/main.lua");
    expect(() => readLuaArchive(new AdmZip(archive({ "A/Scripts/main.lua": "", "B/Scripts/main.lua": "" })), "x.zip")).toThrow("2 Lua mods");
    expect(() => readLuaArchive(new AdmZip(archive({ "shared/Scripts/main.lua": "" })), "x.zip")).toThrow("reserved");
    expect(() => readLuaArchive(new AdmZip(archive({ "PSMDeathRelay/Scripts/main.lua": "" })), "x.zip")).toThrow("reserved");
    const unsafe = new AdmZip(archive({ "Mod/Scripts/main.lua": "" })); unsafe.getEntries()[0]!.entryName = "../Mod/Scripts/main.lua";
    expect(() => readLuaArchive(unsafe, "x.zip")).toThrow("unsafe paths");
  });
});

describe("Lua mods in worlds", () => {
  it("enables a library mod, updates it without touching files the mod wrote, and removes it to the trash", async () => {
    const { importLuaArchive } = await import("@/server/mods/lua-library");
    const { installLuaMod, removeLuaMod, setLuaModEnabled } = await import("@/server/mods/lua-mods");
    const { worldModStatus } = await import("@/server/mods/status");
    const target = await world("win-lua", "windows"); const mods = path.join(target.installDir, "Pal", "Binaries", "Win64", "ue4ss", "Mods");
    const first = await importLuaArchive(archive({ "CoolMod/Scripts/main.lua": "-- v1", "CoolMod/old.lua": "-- only in v1" }), "cool.zip");
    expect((await worldModStatus(target.id)).availableLuaMods).toEqual([{ id: first.id, name: "CoolMod" }]);
    await installLuaMod(target, first.id);
    expect(await readFile(path.join(mods, "mods.txt"), "utf8")).toBe("CoolMod : 1\n");
    await put(path.join(mods, "CoolMod", "settings.json"), "{\"written\":\"by the mod\"}");
    const second = await importLuaArchive(archive({ "CoolMod/Scripts/main.lua": "-- v2" }), "cool-2.zip");
    expect(second.id).toBe(first.id);
    const before = (await worldModStatus(target.id)).luaMods.find((mod) => mod.name === "CoolMod");
    expect(before).toMatchObject({ managed: true, artifactId: first.id, updateAvailable: true });
    await installLuaMod(target, first.id);
    expect(await readFile(path.join(mods, "CoolMod", "Scripts", "main.lua"), "utf8")).toBe("-- v2");
    expect(await exists(path.join(mods, "CoolMod", "old.lua"))).toBe(false);
    expect(await readFile(path.join(mods, "CoolMod", "settings.json"), "utf8")).toContain("by the mod");
    expect((await worldModStatus(target.id)).luaMods.find((mod) => mod.name === "CoolMod")?.updateAvailable).toBe(false);
    await put(path.join(mods, "CoolMod", "enabled.txt"));
    await setLuaModEnabled(target, "CoolMod", false);
    expect(await readFile(path.join(mods, "mods.txt"), "utf8")).toBe("CoolMod : 0\n");
    expect(await exists(path.join(mods, "CoolMod", "enabled.txt"))).toBe(false);
    expect(await exists(path.join(mods, "CoolMod", "enabled.txt.psm-disabled"))).toBe(true);
    await expect(setLuaModEnabled({ ...target, status: "running" }, "CoolMod", true)).rejects.toThrow("Stop the server");
    await removeLuaMod(target, "CoolMod");
    expect(await exists(path.join(mods, "CoolMod"))).toBe(false);
    expect(await readFile(path.join(mods, "mods.txt"), "utf8")).toBe("");
    expect((await readdir(path.join(directory, "data", "mod-trash", target.id))).some((name) => name.startsWith("CoolMod-"))).toBe(true);
  });

  it("never overwrites a same-named folder it did not install unless replacing", async () => {
    const { importLuaArchive } = await import("@/server/mods/lua-library");
    const { installLuaMod } = await import("@/server/mods/lua-mods");
    const target = await world("linux-lua", "linux"); const mods = path.join(target.installDir, "Mods");
    await put(path.join(mods, "HandMod", "Scripts", "main.lua"), "-- by hand");
    const artifact = await importLuaArchive(archive({ "HandMod/Scripts/main.lua": "-- library" }), "hand.zip");
    await expect(installLuaMod(target, artifact.id)).rejects.toThrow("was not installed from the Mods library");
    expect(await readFile(path.join(mods, "HandMod", "Scripts", "main.lua"), "utf8")).toBe("-- by hand");
    await installLuaMod(target, artifact.id, { replace: true });
    expect(await readFile(path.join(mods, "HandMod", "Scripts", "main.lua"), "utf8")).toBe("-- library");
  });
});

describe("Workshop settings", () => {
  it("rewrites only the global switch and the active list", () => {
    const original = "[PalModSettings]\nbGlobalEnableMod=False\nActiveModList=keep\nActiveModList=drop\nWorkshopRootDir=\nConfigVersion=1.0\nFutureKey=value\n";
    const next = updatePalModSettings(original, { globalEnable: true, activeMods: ["keep", "added"] });
    expect(next).toBe("[PalModSettings]\nbGlobalEnableMod=True\nActiveModList=keep\nActiveModList=added\nWorkshopRootDir=\nConfigVersion=1.0\nFutureKey=value\n");
    expect(parsePalModSettings(next)).toMatchObject({ globalEnable: true, activeMods: ["keep", "added"], configVersion: "1.0" });
    expect(updatePalModSettings(null, { globalEnable: false })).toBe("[PalModSettings]\nbGlobalEnableMod=False\n");
  });

  it("toggles installed Workshop mods on Windows builds only", async () => {
    const { setWorkshopEnabled, setWorkshopModActive } = await import("@/server/mods/workshop-mods");
    const target = await world("win-workshop", "windows"); const settings = path.join(target.installDir, "Mods", "PalModSettings.ini");
    await put(path.join(target.installDir, "Mods", "Workshop", "123", "Info.json"), JSON.stringify({ PackageName: "pack", InstallRule: [{ IsServer: true }] }));
    await setWorkshopEnabled(target, true); await setWorkshopModActive(target, "pack", true);
    expect(await readFile(settings, "utf8")).toBe("[PalModSettings]\nbGlobalEnableMod=True\nActiveModList=pack\n");
    await expect(setWorkshopModActive(target, "missing", true)).rejects.toThrow("not installed");
    await setWorkshopModActive(target, "pack", false);
    expect(await readFile(settings, "utf8")).toBe("[PalModSettings]\nbGlobalEnableMod=True\n");
    await expect(setWorkshopEnabled(await world("linux-workshop", "linux"), true)).rejects.toThrow("only on the Windows server build");
  });
});
