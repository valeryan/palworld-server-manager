import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), spawn: vi.fn() }));
import AdmZip from "adm-zip";
import * as inspector from "@/server/services/process-inspection";
import { ensureSteamCmd } from "@/server/services/steamcmd";
import type { JobContext } from "@/server/services/jobs";

let root: string;
const context = (controller = new AbortController()): JobContext => ({ signal: controller.signal, update: async () => {}, log: () => {} });
function fakeClient(onSpawn?: (finish: () => void) => void) {
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 98765, exitCode: null });
    queueMicrotask(() => { const finish = () => { child.stdout.write("Steam client initialized\n"); child.emit("close", 0); }; if (onSpawn) onSpawn(finish); else finish(); });
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
