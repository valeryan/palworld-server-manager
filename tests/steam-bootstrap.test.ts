import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), spawn: vi.fn() }));
import AdmZip from "adm-zip";
import * as inspector from "@/server/services/process-inspection";
import { ensureSteamCmd, reinstallSteamCmd, steamCmdStatus } from "@/server/services/steamcmd";
import type { JobContext } from "@/server/services/jobs";

let root: string;
const context = (controller = new AbortController()): JobContext => ({ signal: controller.signal, update: async () => {}, log: () => {} });
function fakeClient(onSpawn?: (finish: (code?: number, output?: string) => void) => void) {
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 98765, exitCode: null });
    queueMicrotask(() => { const finish = (code = 0, output = "Steam client initialized\n") => { child.stdout.write(output); child.emit("close", code); }; if (onSpawn) onSpawn(finish); else finish(); });
    return child as unknown as ChildProcess;
  });
}
function windowsHost() {
  vi.spyOn(process.getBuiltinModule("node:os"), "platform").mockReturnValue("win32");
  vi.spyOn(inspector, "processSnapshot").mockResolvedValue([{ pid: process.pid, parentPid: 1, started: "owned", executable: process.execPath, commandLine: "" }]);
}
function archive() { const zip = new AdmZip(); zip.addFile("steamcmd.exe", Buffer.from("MZfixture")); return zip.toBuffer(); }

beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), "psm-bootstrap-")); process.env.PALWORLD_MANAGER_DATA_DIR = root; });
afterEach(async () => { vi.restoreAllMocks(); vi.mocked(spawn).mockReset(); await rm(path.join(root, "steamcmd"), { recursive: true, force: true }); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("staged Windows SteamCMD bootstrap", () => {
  it("extracts ZIP without tar and promotes only after initialization succeeds", async () => {
    windowsHost(); fakeClient();
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(archive())));
    await ensureSteamCmd(context());
    expect(String(fetcher.mock.calls[0]![0])).toMatch(/steamcmd\.zip$/);
    expect(await readFile(path.join(root, "steamcmd", "steamcmd.exe"), "utf8")).toBe("MZfixture");
    expect(JSON.parse(await readFile(path.join(root, "steamcmd", ".psm-ready.json"), "utf8"))).toMatchObject({ platform: "win32" });
    expect((await readdir(path.join(root, "steamcmd"))).some((name) => name.startsWith(".bootstrap-") || name.includes("owner"))).toBe(false);
    expect(spawn).toHaveBeenCalledWith(expect.stringMatching(/steamcmd\.exe$/), ["+quit"], expect.anything());
  });
  it("discards a truncated download and allows retry with the same profile", async () => {
    windowsHost(); fakeClient();
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("truncated"));
    await expect(ensureSteamCmd(context())).rejects.toThrow();
    await expect(readFile(path.join(root, "steamcmd", ".psm-ready.json"))).rejects.toThrow();
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array(archive())));
    await ensureSteamCmd(context());
    expect(await readdir(path.join(root, "steamcmd"))).toContain("steamcmd.exe");
  });
  it("probes the updated client after Windows self-update exits 7 without redownloading", async () => {
    windowsHost(); let attempts = 0;
    fakeClient((finish) => { attempts += 1; finish(attempts === 1 ? 7 : 0, attempts === 1 ? "Update complete, launching...\n" : "Steam client initialized\n"); });
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(archive())));
    const job = context(); job.log = vi.fn();
    await ensureSteamCmd(job);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(spawn).mock.calls[0]![0]).toBe(vi.mocked(spawn).mock.calls[1]![0]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(job.log).toHaveBeenCalledWith("SteamCMD initialization attempt 1 exited with code 7.");
    expect(await readdir(path.join(root, "steamcmd"))).toContain(".psm-ready.json");
  });
  it.each([[7, "Update failed\n", 1], [5, "Update complete, launching...\n", 1], [7, "Update complete, launching...\n", 3]])("does not accept unsuccessful bootstrap (exit %i, %s)", async (code, output, attempts) => {
    windowsHost(); fakeClient((finish) => finish(code, output));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(archive())));
    await expect(ensureSteamCmd(context())).rejects.toThrow(`exit ${code}, attempt ${attempts}`);
    expect(spawn).toHaveBeenCalledTimes(attempts);
    expect(await readdir(path.join(root, "steamcmd"))).toEqual([]);
  });
  it("preserves staging and ownership if worker inspection fails after self-update", async () => {
    windowsHost(); fakeClient((finish) => {
      vi.mocked(inspector.processSnapshot).mockRejectedValue(new Error("CIM unavailable"));
      finish(7, "Update complete, launching...\n");
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(archive())));
    await expect(ensureSteamCmd(context())).rejects.toThrow("staged files and lock were preserved");
    expect(spawn).toHaveBeenCalledTimes(1);
    const files = await readdir(path.join(root, "steamcmd"));
    expect(files).toContain(".psm-owner.json");
    expect(files.some((name) => name.startsWith(".bootstrap-"))).toBe(true);
    expect(files).not.toContain(".psm-ready.json");
  });
  it("waits for a surviving updater before probing or moving the staged client", async () => {
    windowsHost(); let attempts = 0; let inspectedUpdater = false;
    fakeClient((finish) => {
      attempts += 1;
      if (attempts === 1) {
        const executable = String(vi.mocked(spawn).mock.calls[0]![0]);
        vi.mocked(inspector.processSnapshot).mockImplementationOnce(async () => {
          inspectedUpdater = true;
          return [{ pid: 98766, parentPid: 98765, started: "updated-worker", executable, commandLine: "" }];
        });
        finish(7, "Update complete, launching...\n");
      } else finish();
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(archive())));
    const running = ensureSteamCmd(context());
    await vi.waitFor(() => expect(inspectedUpdater).toBe(true));
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(await readdir(path.join(root, "steamcmd"))).not.toContain(".psm-ready.json");
    await running;
    expect(spawn).toHaveBeenCalledTimes(2);
  });
  it("reports client status and reinstalls by discarding the client while keeping the lease", async () => {
    windowsHost(); fakeClient();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(archive())));
    expect(await steamCmdStatus()).toMatchObject({ installed: false, preparedAt: null, inUse: false });
    await ensureSteamCmd(context());
    const before = await steamCmdStatus(); expect(before).toMatchObject({ installed: true, inUse: false }); expect(before.preparedAt).toBeTypeOf("number");
    await mkdir(path.join(root, "steamcmd", "package"), { recursive: true }); await writeFile(path.join(root, "steamcmd", "package", "stale.bin"), "stale");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await reinstallSteamCmd(context());
    expect(fetcher).toHaveBeenCalledTimes(2);
    const files = await readdir(path.join(root, "steamcmd"));
    expect(files).not.toContain("package"); expect(files).not.toContain(".psm-owner.json"); expect(files).toContain(".psm-ready.json");
    expect((await steamCmdStatus()).preparedAt!).toBeGreaterThan(before.preparedAt!);
  });
  it("cancels a queued bootstrap without overtaking the active client", async () => {
    windowsHost(); let finish: (() => void) | undefined; fakeClient((done) => { finish = done; });
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(archive())));
    const first = ensureSteamCmd(context());
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const controller = new AbortController(); const second = ensureSteamCmd(context(controller));
    controller.abort(new Error("cancelled while queued"));
    await expect(second).rejects.toThrow("cancelled while queued");
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish!(); await first;
    await ensureSteamCmd(context()); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
