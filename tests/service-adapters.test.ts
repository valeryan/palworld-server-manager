import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:net";
import type { JobContext } from "@/server/services/jobs";

const waitFor = async (predicate: () => Promise<boolean>, message: string) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
};

describe("service boundaries with isolated fakes", () => {
  let root = "";
  let processWorldId = "";
  let configurationWorldId = "";
  let server: Server | undefined;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "psm-service-fakes-"));
    process.env.PALWORLD_MANAGER_DATA_DIR = path.join(root, "manager-data");
    process.env.PALWORLD_MANAGER_DB = path.join(root, "manager-data", "registry-v3.sqlite");
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    const { getWorld } = await import("@/server/services/worlds");
    const { stopWorld } = await import("@/server/services/processes");
    if (processWorldId && (await getWorld(processWorldId))?.processId) await stopWorld(processWorldId, true).catch(() => undefined);
    const { sqliteClient } = await import("@/server/db");
    sqliteClient().close(); globalThis.__psmDatabase = undefined;
    await rm(root, { recursive: true, force: true });
  });

  it("drives lifecycle state through a fake PalServer process", async () => {
    const installDir = path.join(root, "process-world");
    await mkdir(path.join(installDir, "Pal", "Saved"), { recursive: true });
    const executable = path.join(installDir, "PalServer.sh");
    await writeFile(executable, "#!/bin/sh\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n");
    await chmod(executable, 0o700);
    const [{ createWorld, getWorld, setRuntimeState }, { startWorld, stopWorld, reconcileProcesses }] = await Promise.all([
      import("@/server/services/worlds"), import("@/server/services/processes"),
    ]);
    const world = await createWorld({ displayName: "Fake process", installDir, gamePort: 39111, queryPort: 39112, restApiPort: 39113, rconPort: 39114, restApiEnabled: false, crashGuard: false });
    if (process.platform !== "win32") {
      for (const suffix of ["", "-wal", "-shm"]) {
        expect((await stat(`${process.env.PALWORLD_MANAGER_DB}${suffix}`)).mode & 0o777).toBe(0o600);
      }
    }
    processWorldId = world.id;
    await startWorld(world.id);
    const running = await getWorld(world.id);
    expect(running).toMatchObject({ status: "running" });
    expect(running?.processId).toBeTypeOf("number");
    await setRuntimeState(world.id, "starting", running!.processId);
    await reconcileProcesses();
    expect(await getWorld(world.id)).toMatchObject({ status: "running", processId: running!.processId });
    await stopWorld(world.id, true);
    expect(await getWorld(world.id)).toMatchObject({ status: "stopped", processId: null });
  });

  it("records succeeded and failed job states and enforces the per-world lock", async () => {
    const { startJob, getJob, worldIsLocked } = await import("@/server/services/jobs");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = await startJob(processWorldId, "fake-held", async ({ update, log }) => { await update(42, "Halfway"); log("fake output"); await held; });
    await waitFor(async () => (await getJob(first))?.state === "running", "Fake held job did not start.");
    expect(worldIsLocked(processWorldId)).toBe(true);
    await expect(startJob(processWorldId, "overlap", async () => undefined)).rejects.toThrow("Another operation");
    release();
    await waitFor(async () => (await getJob(first))?.state === "succeeded", "Fake held job did not succeed.");
    const failed = await startJob(processWorldId, "fake-failure", async () => { throw new Error("synthetic adapter failure"); });
    await waitFor(async () => (await getJob(failed))?.state === "failed", "Fake failed job did not settle.");
    expect(await getJob(failed)).toMatchObject({ state: "failed", error: "synthetic adapter failure", progress: 0 });
    expect(worldIsLocked(processWorldId)).toBe(false);
  });

  it("installs through a fake SteamCMD executable and redacts credentials", async () => {
    const installDir = path.join(root, "steam-world");
    const steamDir = path.join(root, "manager-data", "steamcmd");
    await mkdir(steamDir, { recursive: true });
    const steam = path.join(steamDir, "steamcmd.sh");
    await writeFile(steam, `#!/bin/sh
install=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "+force_install_dir" ]; then install="$argument"; break; fi
  previous="$argument"
done
mkdir -p "$install/steamapps"
printf '#!/bin/sh\\nexit 0\\n' > "$install/PalServer.sh"
chmod 700 "$install/PalServer.sh"
printf '"AppState" { "buildid" "424242" }\\n' > "$install/steamapps/appmanifest_2394010.acf"
printf '; This shipped template comment must not be copied into the active file.\\n[/Script/Pal.PalGameWorldSettings]\\nOptionSettings=(ServerName="Default Palworld Server",PublicPort=8211,ServerReplicatePawnCullDistance=15000.000000,DenyTechnologyList=,RESTAPIEnabled=False,RESTAPIPort=8212,RCONEnabled=False,RCONPort=25575)\\n' > "$install/DefaultPalWorldSettings.ini"
mkdir -p "$install/Pal/Saved/Config/LinuxServer"
: > "$install/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"
echo "login $PSM_STEAM_USERNAME $PSM_STEAM_PASSWORD"
echo "Success! App '2394010' fully installed."
`);
    await chmod(steam, 0o700);
    process.env.PSM_STEAM_USERNAME = "fake-user"; process.env.PSM_STEAM_PASSWORD = "fake-password";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: { "2394010": { depots: { branches: { public: { buildid: "424242" } } } } } }), { status: 200 })) as typeof fetch;
    const { createWorld, getWorld } = await import("@/server/services/worlds");
    const { installOrUpdate } = await import("@/server/services/steamcmd");
    const world = await createWorld({ displayName: "Fake Steam", installDir, gamePort: 39211, queryPort: 39212, restApiPort: 39213, rconPort: 39214 });
    configurationWorldId = world.id;
    const output: string[] = []; const updates: string[] = [];
    const context: JobContext = { signal: new AbortController().signal, log: (line) => output.push(line), update: async (_progress, message) => { updates.push(message); } };
    await installOrUpdate(world, context);
    const installedWorld = await getWorld(world.id);
    expect(installedWorld).toMatchObject({ buildId: "424242", latestBuildId: "424242" });
    expect(installedWorld?.adminPassword).toHaveLength(24);
    expect(output.join("\n")).not.toContain("fake-user");
    expect(output.join("\n")).not.toContain("fake-password");
    expect(output.join("\n")).toContain("[redacted]");
    expect(output.join("\n")).toContain("Initialized PalWorldSettings.ini from the shipped defaults.");
    const activeConfiguration = await readFile(path.join(installDir, "Pal", "Saved", "Config", "LinuxServer", "PalWorldSettings.ini"), "utf8");
    expect(activeConfiguration).toMatch(/^\[\/Script\/Pal\.PalGameWorldSettings\]\nOptionSettings=\([^\n]+\)\n$/);
    expect(activeConfiguration).not.toContain("shipped template comment");
    expect(activeConfiguration).toContain("ServerName=\"Default Palworld Server\"");
    expect(activeConfiguration).toContain("PublicPort=39211");
    expect(activeConfiguration).toContain("RESTAPIPort=39213");
    expect(activeConfiguration).toContain(`AdminPassword="${installedWorld?.adminPassword}"`);
    expect(updates.at(-1)).toBe("Installed build 424242");
  });

  it("preserves invalid raw settings until an explicit shipped-default repair", async () => {
    const activePath = path.join(root, "steam-world", "Pal", "Saved", "Config", "LinuxServer", "PalWorldSettings.ini");
    const active = (await readFile(activePath, "utf8")).replace("ServerReplicatePawnCullDistance=15000.000000", "ServerReplicatePawnCullDistance=NaN");
    await writeFile(activePath, active);
    const { readConfigurationOptions, resolveShippedDefaultChanges, saveConfigurationOptions } = await import("@/server/services/configuration");
    await saveConfigurationOptions(configurationWorldId, { ExpRate: "2.000000" });
    const preserved = await readConfigurationOptions(configurationWorldId);
    expect(preserved.options).toMatchObject({ ExpRate: "2.000000", ServerReplicatePawnCullDistance: "NaN" });
    expect(preserved.shippedDefaults.options.ServerReplicatePawnCullDistance).toBe("15000.000000");
    expect(preserved).not.toHaveProperty("content");
    expect(preserved.options).not.toHaveProperty("AdminPassword");
    await expect(resolveShippedDefaultChanges(configurationWorldId, ["AdminPassword"])).rejects.toThrow("cannot be reset");
    await expect(resolveShippedDefaultChanges(configurationWorldId, ["UnknownSetting"])).rejects.toThrow("cannot be reset");
    await saveConfigurationOptions(configurationWorldId, {}, ["ServerReplicatePawnCullDistance"]);
    expect((await readConfigurationOptions(configurationWorldId)).options.ServerReplicatePawnCullDistance).toBe("15000.000000");
  });

  it("sends authenticated requests through a fake Palworld REST endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input, init) => { calls.push({ url: String(input), init }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as typeof fetch;
    const { palworldRest } = await import("@/server/services/rest");
    const world = { id: "rest", displayName: "REST", installDir: root, platform: "linux", gamePort: 1, queryPort: 2, restApiPort: 39313, rconPort: 4, adminPassword: "secret", serverPassword: "", restApiEnabled: true, rconEnabled: false, communityServer: false, autostart: false, crashGuard: false, legacyPerfFlags: false, extraArgs: "", env: {}, wineBinary: "wine", winePrefix: null, wineLaunchFlags: "", status: "running", processId: 1, buildId: null, latestBuildId: null, lastStartedAt: null, createdAt: 1, updatedAt: 1 } as const;
    await palworldRest.announce(world, "Maintenance soon");
    expect(calls[0]?.url).toBe("http://127.0.0.1:39313/v1/api/announce");
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}` });
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ message: "Maintenance soon" }));
  });

  it("executes the complete protocol against a fake RCON server", async () => {
    const encode = (id: number, type: number, payload: string) => {
      const body = Buffer.from(payload); const packet = Buffer.alloc(body.length + 14);
      packet.writeInt32LE(body.length + 10, 0); packet.writeInt32LE(id, 4); packet.writeInt32LE(type, 8); body.copy(packet, 12); return packet;
    };
    server = createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
          const size = buffer.readInt32LE(0); const frame = buffer.subarray(0, size + 4); buffer = buffer.subarray(size + 4);
          const type = frame.readInt32LE(8); const payload = frame.subarray(12, frame.length - 2).toString();
          if (type === 3) socket.write(encode(payload === "rcon-secret" ? 1 : -1, 2, ""));
          else if (type === 2) socket.write(encode(0, 0, `fake response for ${payload}`));
        }
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Fake RCON server did not bind.");
    const { createWorld, setRuntimeState } = await import("@/server/services/worlds");
    const { runLegacyRconCommand } = await import("@/server/services/legacy-rcon");
    const installDir = path.join(root, "rcon-world"); await mkdir(installDir, { recursive: true });
    const world = await createWorld({ displayName: "Fake RCON", installDir, gamePort: 39411, queryPort: 39412, restApiPort: 39413, rconPort: address.port, adminPassword: "rcon-secret", rconEnabled: true });
    await setRuntimeState(world.id, "running", process.pid);
    await expect(runLegacyRconCommand(world.id, "Info")).resolves.toBe("fake response for Info");
    await setRuntimeState(world.id, "stopped", null);
  });

  it("backs up and restores a fake filesystem tree without touching external paths", async () => {
    const installDir = path.join(root, "filesystem-world"); const saveFile = path.join(installDir, "Pal", "Saved", "SaveGames", "world.sav");
    await mkdir(path.dirname(saveFile), { recursive: true }); await writeFile(saveFile, "before");
    const { createWorld } = await import("@/server/services/worlds");
    const { createBackup, restoreBackup } = await import("@/server/services/backups");
    const world = await createWorld({ displayName: "Fake filesystem", installDir, gamePort: 39511, queryPort: 39512, restApiPort: 39513, rconPort: 39514 });
    const context: JobContext = { signal: new AbortController().signal, log: () => undefined, update: async () => undefined };
    const backupId = await createBackup(world.id, "adapter-test", context);
    await writeFile(saveFile, "after");
    await restoreBackup(world.id, backupId, context);
    expect(await readFile(saveFile, "utf8")).toBe("before");
  });
});
