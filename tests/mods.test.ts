import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareTestDatabase } from "./prepare-database";
import { parseModsTxt } from "@/server/mods/lua-mods";
import { parseInfoJson, parsePalModSettings } from "@/server/mods/workshop-mods";
import { readGuiConsole } from "@/server/mods/ue4ss";

let directory: string;
async function put(file: string, content = ""): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); }

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "psm-mods-test-"));
  process.env.PALWORLD_MANAGER_DATA_DIR = path.join(directory, "data");
  process.env.PALWORLD_MANAGER_DB = path.join(directory, "data", "registry-v3.sqlite");
  await prepareTestDatabase(process.env.PALWORLD_MANAGER_DATA_DIR, process.env.PALWORLD_MANAGER_DB);
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("mod file parsers", () => {
  it("reads mods.txt flags and ignores comments and malformed lines", () => {
    expect(parseModsTxt("; comment\nAlpha : 1\r\nBeta:0\n\nnot a mod line\nGamma Mod : 1\n")).toEqual(new Map([["Alpha", true], ["Beta", false], ["Gamma Mod", true]]));
  });
  it("keeps each PalModSettings.ini value on its own line", () => {
    const settings = parsePalModSettings("[PalModSettings]\nbGlobalEnableMod=True\nActiveModList=One\nActiveModList=Two\nWorkshopRootDir=\nConfigVersion=1.0\n");
    expect(settings).toEqual({ exists: true, globalEnable: true, activeMods: ["One", "Two"], workshopRootDir: null, configVersion: "1.0" });
    expect(parsePalModSettings(null)).toMatchObject({ exists: false, globalEnable: false, activeMods: [] });
  });
  it("treats a Workshop mod as server-capable when any install rule opts in", () => {
    expect(parseInfoJson(JSON.stringify({ ModName: "Pack", PackageName: "pack", Version: "2", InstallRule: [{ Type: "Paks", IsServer: false }, { Type: "Lua", IsServer: true }] }))).toEqual({ packageName: "pack", displayName: "Pack", version: "2", serverCapable: true });
    expect(parseInfoJson(JSON.stringify({ PackageName: "solo", InstallRule: { Type: "Paks" } })).serverCapable).toBe(false);
  });
  it("reads GuiConsoleVisible", () => {
    expect(readGuiConsole("[Debug]\nGuiConsoleVisible = 0\n")).toBe("hidden");
    expect(readGuiConsole("GuiConsoleVisible=1")).toBe("visible");
    expect(readGuiConsole("")).toBe("unknown");
  });
});

describe("world mod status", () => {
  it("reports a Windows UE4SS install, its crash-risk warnings, and managed versus unmanaged Lua mods", async () => {
    const install = path.join(directory, "windows-world"); const win64 = path.join(install, "Pal", "Binaries", "Win64"); const mods = path.join(win64, "ue4ss", "Mods");
    await put(path.join(win64, "dwmapi.dll"));
    await put(path.join(win64, "ue4ss", "UE4SS-settings.ini"), "GuiConsoleVisible=1\n");
    await put(path.join(mods, "mods.txt"), "Library : 1\nHand : 0\nshared : 1\n");
    await put(path.join(mods, "Library", "Scripts", "main.lua")); await put(path.join(mods, "Library", "psm-mod.json"), "{}");
    await put(path.join(mods, "Hand", "Scripts", "main.lua"));
    await put(path.join(mods, "Forced", "enabled.txt"));
    await put(path.join(mods, "shared", "types.lua"));
    await put(path.join(install, "Mods", "PalModSettings.ini"), "[PalModSettings]\nbGlobalEnableMod=True\nActiveModList=pack\n");
    await put(path.join(install, "Mods", "Workshop", "123", "Info.json"), JSON.stringify({ ModName: "Pack", PackageName: "pack", InstallRule: [{ IsServer: true }] }));
    await put(path.join(install, "Mods", "Workshop", "456", "Info.json"), "{broken");
    const { createWorld } = await import("@/server/services/worlds"); const { worldModStatus } = await import("@/server/mods/status");
    const world = await createWorld({ displayName: "Windows", installDir: install, platform: "windows" });
    const status = await worldModStatus(world.id);
    expect(status.ue4ss).toMatchObject({ variant: "windows", layoutVerified: true, binariesPresent: true, installed: true, loader: true, memberLayout: false, guiConsole: "visible", modsDirectory: mods });
    expect(status.ue4ss.warnings).toEqual(["member-layout-missing", "gui-console-visible"]);
    expect(status.luaMods).toEqual([
      { name: "Forced", enabled: true, enabledBy: "enabled-txt", hasScript: false, managed: false },
      { name: "Hand", enabled: false, enabledBy: null, hasScript: true, managed: false },
      { name: "Library", enabled: true, enabledBy: "mods-txt", hasScript: true, managed: true },
    ]);
    expect(status.workshop).toMatchObject({ platformSupported: true, settingsExists: true, globalEnable: true, activeMods: ["pack"] });
    expect(status.workshop.mods.map((mod) => [mod.folder, mod.active, mod.serverCapable, mod.error === null])).toEqual([["123", true, true, true], ["456", false, false, false]]);
  });

  it("reads the native Linux layout without treating Palworld's own mod folders as Lua mods", async () => {
    const install = path.join(directory, "linux-world");
    await mkdir(path.join(install, "Pal", "Binaries", "Linux"), { recursive: true });
    await put(path.join(install, "libUE4SS.so")); await put(path.join(install, "MemberVariableLayout.ini")); await put(path.join(install, "UE4SS-settings.ini"), "GuiConsoleVisible=0\n");
    await put(path.join(install, "Mods", "mods.txt"), "Relay : 1\n\nUE4SSStatus : 1\n"); await put(path.join(install, "Mods", "Relay", "scripts", "main.lua")); await put(path.join(install, "Mods", "UE4SSStatus", "scripts", "main.lua"));
    await put(path.join(install, "Mods", "Workshop", "789", "Info.json"), JSON.stringify({ PackageName: "linux-pack" }));
    const { createWorld } = await import("@/server/services/worlds"); const { worldModStatus } = await import("@/server/mods/status");
    const world = await createWorld({ displayName: "Linux", installDir: install, platform: "linux" });
    const status = await worldModStatus(world.id);
    expect(status.ue4ss).toMatchObject({ variant: "linux", layoutVerified: true, installed: true, memberLayout: true, guiConsole: "hidden", warnings: [] });
    expect(status.luaMods).toEqual([{ name: "Relay", enabled: true, enabledBy: "mods-txt", hasScript: true, managed: false }]);
    expect(status.workshop.platformSupported).toBe(false);
    expect(status.workshop.mods.map((mod) => mod.packageName)).toEqual(["linux-pack"]);
  });

  it("reports an empty world without errors", async () => {
    const install = path.join(directory, "empty-world"); await mkdir(install, { recursive: true });
    const { createWorld } = await import("@/server/services/worlds"); const { worldModStatus } = await import("@/server/mods/status");
    const status = await worldModStatus((await createWorld({ displayName: "Empty", installDir: install, platform: "linux" })).id);
    expect(status).toMatchObject({ ue4ss: { installed: false, binariesPresent: false, warnings: [] }, luaMods: [], workshop: { settingsExists: false, mods: [] } });
  });
});

describe("mod library", () => {
  it("lists pinned builds with download state and the worlds where each is detected", async () => {
    const { modLibrary, artifactPath } = await import("@/server/mods/status"); const { MOD_CATALOG } = await import("@/server/mods/catalog");
    const linux = MOD_CATALOG.find((artifact) => artifact.variant === "linux")!;
    await put(artifactPath(linux), "cached");
    const entries = await modLibrary();
    expect(entries.map((entry) => entry.id)).toEqual(MOD_CATALOG.map((artifact) => artifact.id));
    expect(entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256) && entry.sizeBytes > 0 && !("url" in entry))).toBe(true);
    const byVariant = Object.fromEntries(entries.map((entry) => [entry.variant, entry]));
    expect(byVariant.linux).toMatchObject({ downloaded: true, detectedIn: [{ displayName: "Linux" }] });
    expect(byVariant.windows).toMatchObject({ downloaded: false, detectedIn: [{ displayName: "Windows" }] });
  });
});
