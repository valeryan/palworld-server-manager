import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as inspector from "@/server/services/process-inspection";
import type { ProcessIdentity } from "@/server/services/process-inspection";
import { assertWorldOwnership, claimLease, claimOperationLease, operationLeasePath, readLease, runtimeLeasePath, type OperationLease, type RuntimeLease } from "@/server/services/leases";

let root: string;
const self = (): ProcessIdentity => ({ pid: process.pid, parentPid: 1, started: "self-start", executable: process.execPath, commandLine: "" });
const other = (pid: number, started = "other-start"): ProcessIdentity => ({ pid, parentPid: 1, started, executable: "/usr/bin/other-manager", commandLine: "" });
const options = { identity: "no identity", conflict: "still owned", payload: (owner: ProcessIdentity): OperationLease => ({ profile: "me", owner }) };

beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), "psm-leases-")); process.env.PALWORLD_MANAGER_DATA_DIR = path.join(root, "data"); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("claimLease", () => {
  it("creates a private lease owned by this process when none exists", async () => {
    const file = path.join(root, "fresh.json");
    const lease = await claimLease(file, [self()], options);
    expect(lease.owner.pid).toBe(process.pid);
    expect(await readLease<OperationLease>(file)).toEqual(lease);
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
  it("refuses while the recorded owner is still alive and leaves the file alone", async () => {
    const file = path.join(root, "live.json"); const owner = other(4242);
    await writeFile(file, JSON.stringify({ profile: "them", owner }));
    await expect(claimLease(file, [self(), owner], options)).rejects.toThrow("still owned");
    expect(await readLease<OperationLease>(file)).toMatchObject({ profile: "them" });
  });
  it("reclaims a lease whose owner has exited", async () => {
    const file = path.join(root, "stale.json");
    await writeFile(file, JSON.stringify({ profile: "them", owner: other(4242) }));
    await claimLease(file, [self()], options);
    expect(await readLease<OperationLease>(file)).toMatchObject({ profile: "me", owner: { pid: process.pid } });
  });
  it("treats a reused PID with a different start time as a dead owner", async () => {
    const file = path.join(root, "reused.json");
    await writeFile(file, JSON.stringify({ profile: "them", owner: other(4242, "old") }));
    await claimLease(file, [self(), other(4242, "new")], options);
    expect(await readLease<OperationLease>(file)).toMatchObject({ profile: "me" });
  });
  it("lets the caller keep a lease live through what it tracked", async () => {
    const file = path.join(root, "tracked.json"); const server = other(5151);
    await writeFile(file, JSON.stringify({ profile: "them", owner: other(4242), processes: [server] } satisfies RuntimeLease));
    const runtime = { ...options, alsoLive: (lease: RuntimeLease, snapshot: ProcessIdentity[]) => inspector.ownedTree(lease.processes, snapshot).length > 0, payload: (owner: ProcessIdentity): RuntimeLease => ({ profile: "me", owner, processes: [] }) };
    await expect(claimLease(file, [self(), server], runtime)).rejects.toThrow("still owned");
    await claimLease(file, [self()], runtime);
    expect(await readLease<RuntimeLease>(file)).toMatchObject({ profile: "me", processes: [] });
  });
  it("never takes over a lease it cannot read", async () => {
    const file = path.join(root, "corrupt.json");
    await writeFile(file, "{not json");
    await expect(claimLease(file, [self()], options)).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{not json");
  });
  it("fails when this process is missing from the snapshot", async () => {
    await expect(claimLease(path.join(root, "unknown.json"), [other(1)], options)).rejects.toThrow("no identity");
  });
});

describe("installation ownership", () => {
  it("blocks changes while another profile's live lease exists, and reclaims it once that owner is gone", async () => {
    const installDir = path.join(root, "install"); const foreign = other(6161);
    await mkdir(installDir, { recursive: true });
    await writeFile(runtimeLeasePath(installDir), JSON.stringify({ profile: "/elsewhere", owner: foreign, processes: [] } satisfies RuntimeLease));
    const snapshot = vi.spyOn(inspector, "processSnapshot").mockResolvedValue([self(), foreign]);
    await expect(assertWorldOwnership({ installDir })).rejects.toThrow("Another manager profile");
    await expect(claimOperationLease({ installDir })).rejects.toThrow("Another manager profile");
    snapshot.mockResolvedValue([self()]);
    await expect(assertWorldOwnership({ installDir })).resolves.toBeUndefined();
    const release = await claimOperationLease({ installDir });
    expect(await readLease<OperationLease>(operationLeasePath(installDir))).toMatchObject({ profile: process.env.PALWORLD_MANAGER_DATA_DIR!, owner: { pid: process.pid } });
    await release();
    expect(await readLease<OperationLease>(operationLeasePath(installDir))).toBeNull();
  });
  it("keeps an operation lease while any SteamCMD worker is running", async () => {
    const installDir = path.join(root, "install-steam");
    await mkdir(installDir, { recursive: true });
    await writeFile(operationLeasePath(installDir), JSON.stringify({ profile: process.env.PALWORLD_MANAGER_DATA_DIR!, owner: other(7171) } satisfies OperationLease));
    const worker: ProcessIdentity = { pid: 8181, parentPid: 1, started: "w", executable: "/opt/steam/steamcmd", commandLine: "" };
    vi.spyOn(inspector, "processSnapshot").mockResolvedValue([self(), worker]);
    await expect(claimOperationLease({ installDir })).rejects.toThrow("An existing operation still owns this installation.");
  });
});
