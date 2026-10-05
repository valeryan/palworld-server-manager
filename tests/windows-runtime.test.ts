import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { windowsArguments } from "@/lib/arguments";
import { parseCustomLaunchFlags } from "../electron/launch-options";
import { safeEntries, safeArchivePath } from "@/server/services/archive";
import { sameProcess, ownedTree, type ProcessIdentity } from "@/server/services/process-inspection";
import { hostCapabilities, assertSupportedTarget, assertLocalWindowsPath } from "@/server/host";
import { steamCmdHost } from "@/server/services/steamcmd";
import { prepareTestDatabase } from "./prepare-database";
import { commandFor } from "@/server/services/processes";
import type { WorldView } from "@/contracts/world";

describe("native host and command contracts", () => {
  it("selects Windows at runtime even when source tests are running on Linux", () => {
    const spy = vi.spyOn(process.getBuiltinModule("node:os"), "platform").mockReturnValue("win32");
    try {
      expect(hostCapabilities()).toMatchObject({ platform: "win32", defaultWorldPlatform: "windows", worldPlatforms: ["windows"], wine: false });
      expect(steamCmdHost()).toMatchObject({ executable: "steamcmd.exe", archive: "steamcmd.zip" });
      const command = commandFor({ platform: "windows", installDir: "/tmp/Native world Ω", env: {}, argumentFormat: "windows", extraArgs: '-Log="D:\\Server Logs\\Ω.log" ""', gamePort: 8211, queryPort: 27015 } as WorldView);
      expect(command.command).toBe("/tmp/Native world Ω/Pal/Binaries/Win64/PalServer-Win64-Shipping-Cmd.exe");
      expect(command.args).toEqual(["Pal", "-port=8211", "-queryport=27015", "-Log=D:\\Server Logs\\Ω.log", "", "-NoConsole", "-stdout", "-FullStdOutLogOutput", "-FORCELOGFLUSH"]);
      expect(() => assertSupportedTarget("linux")).toThrow("Cannot run");
      for (const value of ["\\\\server\\share", "\\relative", "C:relative", "\\\\?\\C:\\extended"]) expect(() => assertLocalWindowsPath(value)).toThrow("local drive");
      expect(() => assertLocalWindowsPath("D:\\Worlds\\Ω")).not.toThrow();
    } finally { spy.mockRestore(); }
    expect(steamCmdHost().executable).toBe("steamcmd.sh");
  });
  it("round trips Windows paths, empty values, UNC paths and escaped quotes without a shell", () => {
    expect(windowsArguments(String.raw`-Log="C:\Server Logs\Ω.log" "" \\host\share\file plain` + "\\")).toEqual(["-Log=C:\\Server Logs\\Ω.log", "", "\\\\host\\share\\file", "plain\\"]);
    expect(windowsArguments(String.raw`"C:\path\\" "say \"hi\""`)).toEqual(["C:\\path\\", 'say "hi"']);
    expect(parseCustomLaunchFlags(String.raw`--log-file="C:\My Logs\app.log"`, "windows")).toEqual(["--log-file=C:\\My Logs\\app.log"]);
    expect(() => windowsArguments('"unfinished')).toThrow();
    const command = commandFor({ platform: "linux", argumentFormat: "windows", extraArgs: '"" -Log="C:\\Server Logs\\Ω.log"', env: {}, installDir: "/tmp/fixture", gamePort: 8211, queryPort: 27015 } as WorldView);
    expect(command.args).toContain("");
    expect(command.args).toContain("-Log=C:\\Server Logs\\Ω.log");
  });
  it("reports a native installation without the headless launch binary as incomplete", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psm-native-layout-"));
    const binaries = path.join(root, "Pal", "Binaries", "Win64");
    await mkdir(binaries, { recursive: true });
    await writeFile(path.join(root, "PalServer.exe"), "MZfixture");
    await writeFile(path.join(binaries, "PalServer-Win64-Shipping.exe"), "MZfixture");
    const spy = vi.spyOn(process.getBuiltinModule("node:os"), "platform").mockReturnValue("win32");
    try {
      const { inspectInstallation } = await import("@/server/services/installation");
      expect(await inspectInstallation(root, "windows")).toMatchObject({ executable: false });
      await writeFile(path.join(binaries, "PalServer-Win64-Shipping-Cmd.exe"), "MZfixture");
      expect(await inspectInstallation(root, "windows")).toMatchObject({ executable: true });
    } finally { spy.mockRestore(); await rm(root, { recursive: true, force: true }); }
  });
  it("rejects unsafe Windows archive aliases and collisions before extraction", () => {
    for (const name of ["C:/escape", "\\\\host\\share", "Saved/file:stream", "Saved/CON.txt", "Saved/x.", "../escape", "Saved/../escape"]) expect(safeArchivePath(name), name).toBe(false);
    const zip = new AdmZip(); zip.addFile("Saved/Config.ini", Buffer.from("one")); zip.addFile("saved/config.INI", Buffer.from("two")); expect(safeEntries(zip)).toBe(false);
    const good = new AdmZip(); good.addFile("Saved/Ω world/Config.ini", Buffer.from("ok")); expect(safeEntries(good)).toBe(true);
  });
  it("never treats a recycled PID or unrelated child as owned", () => {
    const root: ProcessIdentity = { pid: 12, parentPid: 1, started: "100", executable: "C:/Pal/PalServer.exe", commandLine: "" };
    const reused = { ...root, started: "200" };
    expect(sameProcess(root, reused)).toBe(false);
    expect(ownedTree([root], [reused, { ...root, pid: 13, parentPid: 12 }])).toEqual([]);
    expect(ownedTree([root], [root, { ...root, pid: 13, parentPid: 12 }, { ...root, pid: 14, parentPid: 99 }]).map((row) => row.pid)).toEqual([12, 13]);
  });
});

describe("registration and recovery on an incomplete installation", () => {
  let root: string; let id: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "psm-native-regression-"));
    process.env.PALWORLD_MANAGER_DATA_DIR = path.join(root, "manager");
    process.env.PALWORLD_MANAGER_DB = path.join(root, "manager", "registry-v3.sqlite");
    process.env.PSM_ADMIN_TOKEN = "native-test";
    await prepareTestDatabase(process.env.PALWORLD_MANAGER_DATA_DIR);
    const { createWorld } = await import("@/server/services/worlds");
    id = (await createWorld({ displayName: "Failed install", installDir: path.join(root, "missing") })).id;
  });
  afterAll(async () => {
    const { sqliteClient } = await import("@/server/db"); sqliteClient().close(); globalThis.__psmDatabase = undefined;
    globalThis.__psmDraining = false; delete process.env.PSM_ADMIN_TOKEN; await rm(root, { recursive: true, force: true });
  });
  const request = (body: unknown) => new Request(`http://localhost/api/worlds/${id}/configuration/admin`, { method: "PUT", headers: { cookie: "psm_admin=native-test", "content-type": "application/json" }, body: JSON.stringify(body) });
  it("renames and relocates through the existing admin API without writing an INI", async () => {
    const { readSettingsState } = await import("@/server/services/configuration"); const { PUT } = await import("@/app/api/worlds/[id]/configuration/admin/route");
    const current = await readSettingsState(id);
    const target = path.join(root, "Fixed Ω path");
    const response = await PUT(request({ baseRevision: current.desiredRevision, managed: { displayNameOverride: "Repairable", installDir: target, gamePort: 40001 } }), { params: Promise.resolve({ id }) });
    expect(await response.json()).toMatchObject({ ok: true, configurationChanged: false, result: { managerAppliedRevision: current.desiredRevision + 1, pendingApply: true } });
    const { getWorld } = await import("@/server/services/worlds"); expect(await getWorld(id)).toMatchObject({ id, displayName: "Repairable", installDir: target, gamePort: 40001 });
    expect((await readSettingsState(id)).desiredContent).toBe("");
    await expect(readFile(path.join(target, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"))).rejects.toThrow();
  });
  it("rejects a stale or mixed invalid save without applying the rename", async () => {
    const { readSettingsState } = await import("@/server/services/configuration"); const { PUT } = await import("@/app/api/worlds/[id]/configuration/admin/route");
    const current = await readSettingsState(id);
    const mixed = await PUT(request({ baseRevision: current.desiredRevision, changes: { ServerName: "Game name" }, managed: { displayNameOverride: "Must not save" } }), { params: Promise.resolve({ id }) });
    expect(mixed.ok).toBe(false);
    const stale = await PUT(request({ baseRevision: 0, managed: { displayNameOverride: "Stale" } }), { params: Promise.resolve({ id }) }); expect(stale.status).toBe(409);
    expect((await readSettingsState(id)).desiredManager.displayName).toBe("Repairable");
  });
  it("reports an incomplete world as not startable but keeps its registration", async () => {
    const { getWorld } = await import("@/server/services/worlds"); const { installationHealth } = await import("@/server/services/installation");
    const health = await installationHealth((await getWorld(id))!); expect(health).toMatchObject({ state: "missing", canStart: false, canBackup: false, canInstall: true });
  });
  it("allows an adopted installation to initialize a missing INI from its real shipped template", async () => {
    const { getWorld } = await import("@/server/services/worlds"); const { inspectInstallation } = await import("@/server/services/installation");
    const world = (await getWorld(id))!; await mkdir(world.installDir, { recursive: true });
    await writeFile(path.join(world.installDir, "DefaultPalWorldSettings.ini"), '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="Actual template")\n');
    expect(await inspectInstallation(world.installDir, world.platform)).toMatchObject({ configuration: false, canInitialize: true });
  });
  it("rejects a backup destination aliased into a world", async () => {
    const { getWorld } = await import("@/server/services/worlds"); const world = (await getWorld(id))!;
    await mkdir(world.installDir, { recursive: true }); const alias = path.join(root, "alias"); await symlink(world.installDir, alias);
    const { updateBackupSettings } = await import("@/server/services/backups");
    await expect(updateBackupSettings(id, { destinationDir: path.join(alias, "backups"), retentionCount: 1 })).rejects.toThrow("overlaps");
  });
  it("recovers an orphaned job and refuses new work while draining", async () => {
    const { database } = await import("@/server/db"); const { jobs } = await import("@/server/db/schema");
    await database().insert(jobs).values({ id: "orphan-test", worldId: id, kind: "backup", state: "running", createdAt: Date.now() });
    const { reconcileInterruptedJobs, getJob, beginDrain, startJob } = await import("@/server/services/jobs");
    await reconcileInterruptedJobs(); expect(await getJob("orphan-test")).toMatchObject({ state: "failed", message: "Interrupted" });
    beginDrain(); await expect(startJob(id, "backup", async () => {})).rejects.toThrow("quitting"); globalThis.__psmDraining = false;
  });
  it("waits for an in-flight mod change when quitting", async () => {
    const { withWorldLock, beginDrain, activeOperationCount } = await import("@/server/services/jobs");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const change = withWorldLock(id, async () => { entered(); await gate; });
    await ready;
    try {
      expect(beginDrain()).toBe(1);
      await expect(withWorldLock(id, async () => {})).rejects.toThrow("quitting");
    } finally { release(); await change; globalThis.__psmDraining = false; }
    expect(activeOperationCount()).toBe(0);
  });
  it("drains a settings save already waiting for a path reservation", async () => {
    const { withReservationLock } = await import("@/server/services/reservations");
    const { saveDesiredSettings, readSettingsState } = await import("@/server/services/configuration");
    const { beginDrain, activeOperationCount } = await import("@/server/services/jobs");
    const current = await readSettingsState(id);
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const reservation = withReservationLock(async () => { entered(); await gate; });
    await ready;
    const save = saveDesiredSettings(id, { baseRevision: current.desiredRevision, manager: { ...current.desiredManager, displayName: "Saved before quit" } });
    try { expect(beginDrain()).toBeGreaterThan(0); }
    finally { release(); await reservation; await save; globalThis.__psmDraining = false; }
    expect(activeOperationCount()).toBe(0);
    expect((await readSettingsState(id)).desiredManager.displayName).toBe("Saved before quit");
  });
  it("removes an incomplete registration only when idle, preserving files and operation history", async () => {
    const { getWorld, unregisterWorld, setRuntimeState } = await import("@/server/services/worlds");
    const { withWorldLock, getJob } = await import("@/server/services/jobs");
    const world = (await getWorld(id))!;
    const template = path.join(world.installDir, "DefaultPalWorldSettings.ini");
    const original = await readFile(template, "utf8");
    await withWorldLock(id, async () => {
      await expect(unregisterWorld(id)).rejects.toThrow("Another operation");
      expect(await getWorld(id)).toMatchObject({ id });
    });
    await setRuntimeState(id, "running", process.pid);
    await expect(unregisterWorld(id)).rejects.toThrow("Stop the world");
    await setRuntimeState(id, "stopped", null);
    await unregisterWorld(id);
    expect(await getWorld(id)).toBeNull();
    expect(await readFile(template, "utf8")).toBe(original);
    expect(await getJob("orphan-test")).toMatchObject({ state: "failed", worldId: null });
  });
});
