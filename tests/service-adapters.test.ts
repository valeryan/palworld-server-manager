import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:net";
import type { JobContext } from "@/server/services/jobs";
import { prepareTestDatabase } from "./prepare-database";

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
    await prepareTestDatabase(process.env.PALWORLD_MANAGER_DATA_DIR, process.env.PALWORLD_MANAGER_DB);
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
    await mkdir(path.join(installDir, "Pal", "Saved", "Config", "LinuxServer"), { recursive: true });
    await writeFile(path.join(installDir, "Pal", "Saved", "Config", "LinuxServer", "PalWorldSettings.ini"), '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="Fake process")\n');
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
    expect(installedWorld?.adminPassword).toBe("");
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
    const generatedPassword = activeConfiguration.match(/AdminPassword="([^"]+)"/)?.[1];
    expect(generatedPassword).toHaveLength(24);
    expect(updates.at(-1)).toBe("Installed build 424242");
  });

  it("detects external semantic drift without replacing desired settings", async () => {
    const activePath = path.join(root, "steam-world", "Pal", "Saved", "Config", "LinuxServer", "PalWorldSettings.ini");
    const active = (await readFile(activePath, "utf8")).replace("ServerReplicatePawnCullDistance=15000.000000", "ServerReplicatePawnCullDistance=NaN");
    await writeFile(activePath, active);
    const { readConfigurationOptions, resolveShippedDefaultChanges, saveConfigurationOptions } = await import("@/server/services/configuration");
    const result = await saveConfigurationOptions(configurationWorldId, { ExpRate: "2.000000" });
    const preserved = await readConfigurationOptions(configurationWorldId);
    expect(result).toMatchObject({ pendingApply: true, drift: true });
    expect(preserved.options).toMatchObject({ ExpRate: "2.000000", ServerReplicatePawnCullDistance: "15000.000000" });
    expect(await readFile(activePath, "utf8")).toContain("ServerReplicatePawnCullDistance=NaN");
    expect(preserved.shippedDefaults.options.ServerReplicatePawnCullDistance).toBe("15000.000000");
    expect(preserved).not.toHaveProperty("content");
    expect(preserved.options.AdminPassword).toMatch(/^"[^"]{24}"$/);
    await expect(resolveShippedDefaultChanges(configurationWorldId, ["AdminPassword"])).rejects.toThrow("no default");
    await expect(resolveShippedDefaultChanges(configurationWorldId, ["UnknownSetting"])).rejects.toThrow("cannot be reset");
    await saveConfigurationOptions(configurationWorldId, {}, ["ServerReplicatePawnCullDistance"]);
    expect((await readConfigurationOptions(configurationWorldId)).options.ServerReplicatePawnCullDistance).toBe("15000.000000");
  });

  it("sends authenticated requests through a fake Palworld REST endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input, init) => { calls.push({ url: String(input), init }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as typeof fetch;
    const { palworldRest } = await import("@/server/services/rest");
    const { createWorld, setRuntimeState } = await import("@/server/services/worlds");
    const { readConfiguration, saveConfiguration } = await import("@/server/services/configuration");
    const installDir = path.join(root, "rest-world");
    const configDir = path.join(installDir, "Pal", "Saved", "Config", "LinuxServer");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "PalWorldSettings.ini"), '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(AdminPassword="secret")\n');
    const world = await createWorld({ displayName: "REST", installDir, gamePort: 39311, queryPort: 39312, restApiPort: 39313, rconPort: 39314, restApiEnabled: true });
    await palworldRest.announce(world, "Maintenance soon");
    expect(calls[0]?.url).toBe("http://127.0.0.1:39313/v1/api/announce");
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}` });
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ message: "Maintenance soon" }));
    const configuration = await readConfiguration(world.id);
    await setRuntimeState(world.id, "running", process.pid);
    await saveConfiguration(world.id, configuration.content.replace('AdminPassword="secret"', 'AdminPassword="staged"'), configuration.desiredRevision);
    await expect(saveConfiguration(world.id, configuration.content, configuration.desiredRevision)).rejects.toThrow("changed since");
    await palworldRest.announce({ ...world, status: "running", processId: process.pid }, "Still live");
    expect(calls[1]?.init?.headers).toMatchObject({ Authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}` });
    await setRuntimeState(world.id, "stopped", null);
  });

  it("keeps a combined manager and INI change pending when projection fails", async () => {
    const installDir = path.join(root, "projection-world");
    const configPath = path.join(installDir, "Pal", "Saved", "Config", "LinuxServer", "PalWorldSettings.ini");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="Applied",RESTAPIPort=39713)\n');
    const blockedParent = path.join(root, "not-a-directory"); await writeFile(blockedParent, "file");
    const { createWorld, getWorld } = await import("@/server/services/worlds");
    const { readSettingsState, saveDesiredSettings } = await import("@/server/services/configuration");
    const world = await createWorld({ displayName: "Projection", installDir, gamePort: 39711, queryPort: 39712, restApiPort: 39713, rconPort: 39714 });
    const before = await readSettingsState(world.id);
    const desiredContent = before.desiredContent.replace('ServerName="Applied"', 'ServerName="Desired"').replace("RESTAPIPort=39713", "RESTAPIPort=39723");
    const result = await saveDesiredSettings(world.id, { baseRevision: before.desiredRevision, manager: { ...before.desiredManager, installDir: path.join(blockedParent, "child"), restApiPort: 39723 }, content: desiredContent });
    expect(result.pendingApply).toBe(true);
    expect(result.applyError).toMatch(/directory|ENOTDIR/i);
    expect(await getWorld(world.id)).toMatchObject({ installDir, restApiPort: 39713 });
    expect(await readSettingsState(world.id)).toMatchObject({ desiredManager: { installDir: path.join(blockedParent, "child"), restApiPort: 39723 }, pendingApply: true });
  });

  it("preserves legacy credentials when bootstrapping from a shipped template", async () => {
    const installDir = path.join(root, "legacy-template-world");
    await mkdir(installDir, { recursive: true });
    await writeFile(path.join(installDir, "DefaultPalWorldSettings.ini"), '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(AdminPassword="",ServerPassword="")\n');
    const { createWorld, getWorld } = await import("@/server/services/worlds");
    const { readSettingsState } = await import("@/server/services/configuration");
    const world = await createWorld({ displayName: "Legacy template", installDir, gamePort: 39811, queryPort: 39812, restApiPort: 39813, rconPort: 39814, adminPassword: "legacy-admin", serverPassword: "legacy-player" });
    const settings = await readSettingsState(world.id);
    expect(settings.desiredContent).toContain('AdminPassword="legacy-admin"');
    expect(settings.desiredContent).toContain('ServerPassword="legacy-player"');
    expect(await getWorld(world.id)).toMatchObject({ adminPassword: "", serverPassword: "" });
  });

  it("preserves deferred legacy credentials when the template appears after bootstrap", async () => {
    const installDir = path.join(root, "deferred-legacy-world"); await mkdir(installDir, { recursive: true });
    const { createWorld, getWorld } = await import("@/server/services/worlds");
    const { readSettingsState, syncManagedConfiguration } = await import("@/server/services/configuration");
    const world = await createWorld({ displayName: "Deferred legacy", installDir, gamePort: 40311, queryPort: 40312, restApiPort: 40313, rconPort: 40314, adminPassword: "deferred-admin", serverPassword: "deferred-player" });
    expect(await readSettingsState(world.id)).toMatchObject({ drift: true, pendingApply: true });
    await writeFile(path.join(installDir, "DefaultPalWorldSettings.ini"), '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(AdminPassword="",ServerPassword="",RESTAPIEnabled=False,RESTAPIPort=40313,RCONEnabled=False,RCONPort=40314)\n');
    expect(await syncManagedConfiguration(world.id)).toMatchObject({ initialized: true, pendingApply: false, drift: false });
    const applied = await readSettingsState(world.id);
    expect(applied.appliedContent).toContain('AdminPassword="deferred-admin"');
    expect(applied.appliedContent).toContain('ServerPassword="deferred-player"');
    expect(await getWorld(world.id)).toMatchObject({ adminPassword: "", serverPassword: "" });
  });

  it("does not overwrite a different configuration when relocating a world", async () => {
    const installDir = path.join(root, "relocation-source"); const destination = path.join(root, "relocation-destination");
    const sourceConfig = path.join(installDir, "Pal", "Saved", "Config", "LinuxServer", "PalWorldSettings.ini");
    const destinationConfig = path.join(destination, "Pal", "Saved", "Config", "LinuxServer", "PalWorldSettings.ini");
    await mkdir(path.dirname(sourceConfig), { recursive: true }); await mkdir(path.dirname(destinationConfig), { recursive: true });
    await writeFile(sourceConfig, '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="Source")\n');
    await writeFile(destinationConfig, '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="Destination")\n');
    const { createWorld, getWorld } = await import("@/server/services/worlds");
    const { readSettingsState, saveDesiredSettings } = await import("@/server/services/configuration");
    const world = await createWorld({ displayName: "Relocation", installDir, gamePort: 39911, queryPort: 39912, restApiPort: 39913, rconPort: 39914 });
    const before = await readSettingsState(world.id);
    const result = await saveDesiredSettings(world.id, { baseRevision: before.desiredRevision, manager: { ...before.desiredManager, installDir: destination }, content: before.desiredContent });
    expect(result).toMatchObject({ pendingApply: true, drift: true });
    expect(await readFile(destinationConfig, "utf8")).toContain('ServerName="Destination"');
    expect(await getWorld(world.id)).toMatchObject({ installDir });
  });

  it("serializes cross-world desired port reservations", async () => {
    const { createWorld } = await import("@/server/services/worlds");
    const { readSettingsState, saveDesiredSettings } = await import("@/server/services/configuration");
    const firstDir = path.join(root, "reservation-a"); const secondDir = path.join(root, "reservation-b");
    for (const installDir of [firstDir, secondDir]) { const file = path.join(installDir, "Pal", "Saved", "Config", "LinuxServer", "PalWorldSettings.ini"); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="Reservation")\n'); }
    const first = await createWorld({ displayName: "Reservation A", installDir: firstDir, gamePort: 40011, queryPort: 40012, restApiPort: 40013, rconPort: 40014 });
    const second = await createWorld({ displayName: "Reservation B", installDir: secondDir, gamePort: 40111, queryPort: 40112, restApiPort: 40113, rconPort: 40114 });
    const [firstState, secondState] = await Promise.all([readSettingsState(first.id), readSettingsState(second.id)]);
    const results = await Promise.allSettled([
      saveDesiredSettings(first.id, { baseRevision: firstState.desiredRevision, manager: { ...firstState.desiredManager, gamePort: 40211 }, content: firstState.desiredContent }),
      saveDesiredSettings(second.id, { baseRevision: secondState.desiredRevision, manager: { ...secondState.desiredManager, gamePort: 40211 }, content: secondState.desiredContent }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("rejects staged install directories that alias another world through a symlink", async () => {
    if (process.platform === "win32") return;
    const { createWorld } = await import("@/server/services/worlds");
    const { readSettingsState, saveDesiredSettings } = await import("@/server/services/configuration");
    const occupied = path.join(root, "symlink-occupied"); const other = path.join(root, "symlink-other"); const alias = path.join(root, "symlink-alias");
    for (const installDir of [occupied, other]) { const file = path.join(installDir, "Pal", "Saved", "Config", "LinuxServer", "PalWorldSettings.ini"); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="Alias test")\n'); }
    await symlink(occupied, alias, "dir");
    await createWorld({ displayName: "Symlink owner", installDir: occupied, gamePort: 40411, queryPort: 40412, restApiPort: 40413, rconPort: 40414 });
    const candidate = await createWorld({ displayName: "Symlink candidate", installDir: other, gamePort: 40511, queryPort: 40512, restApiPort: 40513, rconPort: 40514 });
    const settings = await readSettingsState(candidate.id);
    await expect(saveDesiredSettings(candidate.id, { baseRevision: settings.desiredRevision, manager: { ...settings.desiredManager, installDir: path.join(alias, "missing", "deep") }, content: settings.desiredContent })).rejects.toThrow("overlaps");
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
    const configDir = path.join(installDir, "Pal", "Saved", "Config", "LinuxServer");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "PalWorldSettings.ini"), '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(AdminPassword="rcon-secret")\n');
    await setRuntimeState(world.id, "running", process.pid);
    await expect(runLegacyRconCommand(world.id, "Info")).resolves.toBe("fake response for Info");
    await setRuntimeState(world.id, "stopped", null);
  });

  it("backs up and restores a fake filesystem tree without touching external paths", async () => {
    const installDir = path.join(root, "filesystem-world"); const saveFile = path.join(installDir, "Pal", "Saved", "SaveGames", "world.sav");
    await mkdir(path.dirname(saveFile), { recursive: true }); await writeFile(saveFile, "before");
    const backupConfig = path.join(installDir, "Pal", "Saved", "Config", "LinuxServer", "PalWorldSettings.ini");
    await mkdir(path.dirname(backupConfig), { recursive: true }); await writeFile(backupConfig, '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="Backup")\n');
    const { createWorld } = await import("@/server/services/worlds");
    const { createBackup, restoreBackup } = await import("@/server/services/backups");
    const { readSettingsState, saveDesiredSettings } = await import("@/server/services/configuration");
    const world = await createWorld({ displayName: "Fake filesystem", installDir, gamePort: 39511, queryPort: 39512, restApiPort: 39513, rconPort: 39514 });
    const context: JobContext = { signal: new AbortController().signal, log: () => undefined, update: async () => undefined };
    const backupId = await createBackup(world.id, "adapter-test", context);
    const settings = await readSettingsState(world.id); const blockedParent = path.join(root, "restore-not-a-directory"); await writeFile(blockedParent, "file");
    expect(await saveDesiredSettings(world.id, { baseRevision: settings.desiredRevision, manager: { ...settings.desiredManager, installDir: path.join(blockedParent, "child") }, content: settings.desiredContent })).toMatchObject({ pendingApply: true });
    await writeFile(saveFile, "after");
    await restoreBackup(world.id, backupId, context);
    expect(await readFile(saveFile, "utf8")).toBe("before");
    expect(await readSettingsState(world.id)).toMatchObject({ desiredManager: { installDir }, appliedManager: { installDir }, pendingApply: false });
  });
});
