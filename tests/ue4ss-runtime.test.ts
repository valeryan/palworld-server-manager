import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { prepareTestDatabase } from "./prepare-database";
import type { CatalogArtifact } from "@/server/mods/catalog";

let directory: string;
const context = () => ({ signal: new AbortController().signal, update: async () => undefined, log: () => undefined });
async function exists(target: string): Promise<boolean> { try { await stat(target); return true; } catch { return false; } }
async function put(file: string, content = ""): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); }

// Mirrors the real release layouts, including the bundled example mods that must be left out.
function windowsArchive(): Buffer {
  const zip = new AdmZip();
  zip.addFile("dwmapi.dll", Buffer.from("loader"));
  zip.addFile("ue4ss/UE4SS.dll", Buffer.from("runtime"));
  zip.addFile("ue4ss/UE4SS-settings.ini", Buffer.from("[Debug]\nConsoleEnabled = 1\nGuiConsoleEnabled = 1\nGuiConsoleVisible = 1\n"));
  zip.addFile("ue4ss/MemberVariableLayout.ini", Buffer.from("offsets"));
  zip.addFile("ue4ss/Mods/mods.txt", Buffer.from("CheatManagerEnablerMod : 1\n"));
  zip.addFile("ue4ss/Mods/CheatManagerEnablerMod/Scripts/main.lua", Buffer.from("-- cheat"));
  zip.addFile("ue4ss/Mods/shared/Types.lua", Buffer.from("-- types"));
  return zip.toBuffer();
}
function linuxArchive(): Buffer {
  const zip = new AdmZip();
  zip.addFile("libUE4SS.so", Buffer.from("preload"));
  zip.addFile("UE4SS-settings.ini", Buffer.from("GuiConsoleVisible = 1\n"));
  zip.addFile("MemberVariableLayout.ini", Buffer.from("offsets"));
  zip.addFile("UE4SS_Signatures/FName_ToString.lua", Buffer.from("-- sig"));
  zip.addFile("Mods/PalServerOptimizer/Scripts/main.lua", Buffer.from("-- experimental"));
  zip.addFile("Mods/shared/UEHelpers/UEHelpers.lua", Buffer.from("-- helpers"));
  return zip.toBuffer();
}

async function stage(variant: "windows" | "linux", archive: Buffer): Promise<void> {
  const { MOD_CATALOG, artifactPath } = await import("@/server/mods/catalog");
  const catalog = MOD_CATALOG as CatalogArtifact[];
  const index = catalog.findIndex((entry) => entry.variant === variant);
  catalog[index] = { ...catalog[index]!, sizeBytes: archive.byteLength, sha256: createHash("sha256").update(archive).digest("hex") };
  await put(artifactPath(catalog[index]!), "");
  await writeFile(artifactPath(catalog[index]!), archive);
}

async function world(name: string, platform: "windows" | "linux") {
  const installDir = path.join(directory, name);
  await mkdir(path.join(installDir, "Pal", "Binaries", platform === "windows" ? "Win64" : "Linux"), { recursive: true });
  const { createWorld } = await import("@/server/services/worlds");
  return createWorld({ displayName: name, installDir, platform });
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "psm-ue4ss-runtime-"));
  process.env.PALWORLD_MANAGER_DATA_DIR = path.join(directory, "data");
  process.env.PALWORLD_MANAGER_DB = path.join(directory, "data", "registry-v3.sqlite");
  await prepareTestDatabase(process.env.PALWORLD_MANAGER_DATA_DIR, process.env.PALWORLD_MANAGER_DB);
  await stage("windows", windowsArchive()); await stage("linux", linuxArchive());
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("UE4SS installation", () => {
  it("installs only the runtime from the library, with the console forced off", async () => {
    const { installUe4ss, runtimeRow } = await import("@/server/mods/ue4ss-runtime");
    const target = await world("win-install", "windows"); const win64 = path.join(target.installDir, "Pal", "Binaries", "Win64");
    await installUe4ss(target, { replace: false }, context());
    expect(await readFile(path.join(win64, "dwmapi.dll"), "utf8")).toBe("loader");
    expect(await readFile(path.join(win64, "ue4ss", "UE4SS-settings.ini"), "utf8")).toBe("[Debug]\nConsoleEnabled = 0\nGuiConsoleEnabled = 0\nGuiConsoleVisible = 0\n");
    expect(await exists(path.join(win64, "ue4ss", "Mods", "shared", "Types.lua"))).toBe(true);
    expect(await exists(path.join(win64, "ue4ss", "Mods", "CheatManagerEnablerMod"))).toBe(false);
    expect(await exists(path.join(win64, "ue4ss", "Mods", "mods.txt"))).toBe(false);
    const row = await runtimeRow(target.id);
    expect(row).toMatchObject({ variant: "windows", enabled: true, earlyCrashes: 0 });
    expect(row?.installedFiles.sort()).toEqual(["Pal/Binaries/Win64/dwmapi.dll", "Pal/Binaries/Win64/ue4ss/MemberVariableLayout.ini", "Pal/Binaries/Win64/ue4ss/Mods/shared/Types.lua", "Pal/Binaries/Win64/ue4ss/UE4SS-settings.ini", "Pal/Binaries/Win64/ue4ss/UE4SS.dll"]);
  });

  it("lays the Linux build next to PalServer.sh and leaves out the maintainer's experimental mods", async () => {
    const { installUe4ss } = await import("@/server/mods/ue4ss-runtime");
    const target = await world("linux-install", "linux");
    await installUe4ss(target, { replace: false }, context());
    expect(await exists(path.join(target.installDir, "libUE4SS.so"))).toBe(true);
    expect(await exists(path.join(target.installDir, "UE4SS_Signatures", "FName_ToString.lua"))).toBe(true);
    expect(await exists(path.join(target.installDir, "Mods", "shared", "UEHelpers", "UEHelpers.lua"))).toBe(true);
    expect(await exists(path.join(target.installDir, "Mods", "PalServerOptimizer"))).toBe(false);
    expect(await readFile(path.join(target.installDir, "UE4SS-settings.ini"), "utf8")).toContain("GuiConsoleVisible = 0");
  });

  it("refuses a running world, an unverified library copy, or another install's files unless replacing", async () => {
    const { installUe4ss } = await import("@/server/mods/ue4ss-runtime");
    const target = await world("win-conflict", "windows"); const win64 = path.join(target.installDir, "Pal", "Binaries", "Win64");
    await expect(installUe4ss({ ...target, status: "running" }, { replace: false }, context())).rejects.toThrow("Stop the server");
    await put(path.join(win64, "dwmapi.dll"), "someone else's loader");
    await expect(installUe4ss(target, { replace: false }, context())).rejects.toThrow("did not install");
    expect(await readFile(path.join(win64, "dwmapi.dll"), "utf8")).toBe("someone else's loader");
    await installUe4ss(target, { replace: true }, context());
    expect(await readFile(path.join(win64, "dwmapi.dll"), "utf8")).toBe("loader");
    const trash = path.join(directory, "data", "mod-trash", target.id);
    const [moved] = await readdir(trash);
    expect(await readFile(path.join(trash, moved!, "Pal", "Binaries", "Win64", "dwmapi.dll"), "utf8")).toBe("someone else's loader");
    const { MOD_CATALOG, artifactPath } = await import("@/server/mods/catalog");
    const artifact = MOD_CATALOG.find((entry) => entry.variant === "windows")!;
    const good = await readFile(artifactPath(artifact));
    await writeFile(artifactPath(artifact), Buffer.concat([good.subarray(0, -1), Buffer.from([good.at(-1)! ^ 1])]));
    try { await expect(installUe4ss(await world("win-tampered", "windows"), { replace: false }, context())).rejects.toThrow("failed verification"); }
    finally { await writeFile(artifactPath(artifact), good); }
  });
});

describe("UE4SS at launch", () => {
  it("preloads the Linux build, overrides dwmapi under Wine, and stops loading both when disabled", async () => {
    const { applyUe4ssLaunch, setUe4ssEnabled } = await import("@/server/mods/ue4ss-runtime");
    const linux = await world("linux-launch", "linux"); const windows = await world("win-launch", "windows");
    const { installUe4ss } = await import("@/server/mods/ue4ss-runtime");
    await installUe4ss(linux, { replace: false }, context()); await installUe4ss(windows, { replace: false }, context());
    const linuxEnv: NodeJS.ProcessEnv = { ...process.env, LD_PRELOAD: "/opt/other.so" }; await applyUe4ssLaunch(linux, linuxEnv);
    expect(linuxEnv.LD_PRELOAD).toBe(`${path.join(linux.installDir, "libUE4SS.so")}:/opt/other.so`);
    const wineEnv: NodeJS.ProcessEnv = { ...process.env, WINEDLLOVERRIDES: "winemenubuilder.exe=d" }; await applyUe4ssLaunch(windows, wineEnv);
    expect(wineEnv.WINEDLLOVERRIDES).toBe("winemenubuilder.exe=d;dwmapi=n,b");
    await setUe4ssEnabled(linux, false); await setUe4ssEnabled(windows, false);
    const off: NodeJS.ProcessEnv = { ...process.env }; delete off.LD_PRELOAD; delete off.WINEDLLOVERRIDES;
    await applyUe4ssLaunch(linux, off); await applyUe4ssLaunch(windows, off);
    expect(off.LD_PRELOAD).toBeUndefined(); expect(off.WINEDLLOVERRIDES).toBeUndefined();
    const win64 = path.join(windows.installDir, "Pal", "Binaries", "Win64");
    expect(await exists(path.join(win64, "dwmapi.dll"))).toBe(false);
    expect(await exists(path.join(win64, "dwmapi.dll.psm-disabled"))).toBe(true);
    await setUe4ssEnabled(windows, true);
    expect(await exists(path.join(win64, "dwmapi.dll"))).toBe(true);
  });

  it("refuses to start with UE4SS enabled but missing its offset table or with the console on", async () => {
    const { applyUe4ssLaunch, installUe4ss } = await import("@/server/mods/ue4ss-runtime");
    const target = await world("linux-broken", "linux"); await installUe4ss(target, { replace: false }, context());
    await writeFile(path.join(target.installDir, "UE4SS-settings.ini"), "ConsoleEnabled = 0\nGuiConsoleEnabled = 1\nGuiConsoleVisible = 0\n");
    await expect(applyUe4ssLaunch(target, { ...process.env })).rejects.toThrow("console is enabled");
    await rm(path.join(target.installDir, "MemberVariableLayout.ini"));
    await expect(applyUe4ssLaunch(target, { ...process.env })).rejects.toThrow("MemberVariableLayout.ini is missing");
  });

  it("removes only the files it installed, keeping user mods and UE4SS's own files", async () => {
    const { installUe4ss, removeUe4ss, runtimeRow, setUe4ssEnabled } = await import("@/server/mods/ue4ss-runtime");
    const target = await world("win-remove", "windows"); const win64 = path.join(target.installDir, "Pal", "Binaries", "Win64");
    await installUe4ss(target, { replace: false }, context());
    await put(path.join(win64, "ue4ss", "Mods", "MyMod", "Scripts", "main.lua"), "-- mine"); await put(path.join(win64, "ue4ss", "UE4SS.log"), "log");
    await setUe4ssEnabled(target, false);
    await removeUe4ss(target, context());
    expect(await runtimeRow(target.id)).toBeNull();
    for (const gone of ["dwmapi.dll", "dwmapi.dll.psm-disabled", "ue4ss/UE4SS.dll", "ue4ss/UE4SS-settings.ini", "ue4ss/Mods/shared"]) expect(await exists(path.join(win64, ...gone.split("/")))).toBe(false);
    expect(await readFile(path.join(win64, "ue4ss", "Mods", "MyMod", "Scripts", "main.lua"), "utf8")).toBe("-- mine");
    expect(await readFile(path.join(win64, "ue4ss", "UE4SS.log"), "utf8")).toBe("log");
    const { worldModStatus } = await import("@/server/mods/status");
    expect((await worldModStatus(target.id)).ue4ss).toMatchObject({ installed: false, managed: null, active: false });
  });
});

describe("UE4SS crash-loop guard", () => {
  it("pauses crash recovery after two early crashes in a row and resets after a healthy run", async () => {
    const { installUe4ss, recordHealthyExit, recordUnexpectedExit, runtimeRow, setUe4ssEnabled } = await import("@/server/mods/ue4ss-runtime");
    const target = await world("linux-crashes", "linux"); await installUe4ss(target, { replace: false }, context());
    expect(await recordUnexpectedExit(target.id, { code: 134, uptimeMs: 30_000 })).toBe(false);
    expect(await recordUnexpectedExit(target.id, { code: 134, uptimeMs: 600_000 })).toBe(false);
    expect(await recordUnexpectedExit(target.id, { code: 134, uptimeMs: 30_000 })).toBe(false);
    expect(await recordUnexpectedExit(target.id, { code: 134, uptimeMs: 25_000 })).toBe(true);
    expect(await runtimeRow(target.id)).toMatchObject({ earlyCrashes: 2, recoveryPaused: true });
    await recordHealthyExit(target.id); expect((await runtimeRow(target.id))?.earlyCrashes).toBe(0);
    await setUe4ssEnabled(target, false);
    expect(await runtimeRow(target.id)).toMatchObject({ recoveryPaused: false });
    expect(await recordUnexpectedExit(target.id, { code: 134, uptimeMs: 1_000 })).toBe(false);
  });
});
