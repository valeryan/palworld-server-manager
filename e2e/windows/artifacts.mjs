// Executes the Linux-built release EXEs. It does not build or run application source on Windows.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

if (process.platform !== "win32") throw new Error("Run this harness on a Windows artifact runner.");
const release = path.resolve(process.argv[2] || "release");
const output = path.resolve(process.argv[3] || "windows-artifact-results");
// An optional third argument limits the run to one flavor so the two can run on separate runners.
const flavors = ["Portable", "Setup"].filter((name) => !process.argv[4] || name === process.argv[4]);
if (!flavors.length) throw new Error(`Unknown flavor "${process.argv[4]}"; use Portable or Setup.`);
await mkdir(output, { recursive: true });
// Plain ASCII paths, like a normal install: SteamCMD refuses to run from a folder whose path has
// non-English characters, so that case is a product limitation tracked separately, not a test input.
const root = await mkdtemp(path.join(os.tmpdir(), "PSM artifact "));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(action, timeout = 90_000) {
  const deadline = Date.now() + timeout; let error;
  while (Date.now() < deadline) { try { const result = await action(); if (result) return result; } catch (cause) { error = cause; } await delay(300); }
  throw error || new Error("Timed out waiting for the artifact.");
}
const results = [];
let port = 45380;
for (const flavor of flavors) {
  const filename = (await readdir(release)).find((name) => name.includes(`-${flavor}-`) && name.endsWith(".exe"));
  assert.ok(filename, `${flavor} release EXE is missing`);
  const directory = path.join(root, flavor); await mkdir(directory);
  const artifact = path.join(directory, filename); await copyFile(path.join(release, filename), artifact);
  const sha256 = createHash("sha256").update(await readFile(artifact)).digest("hex");
  const install = path.join(directory, "installed");
  if (flavor === "Setup") execFileSync(artifact, ["/S", `/D=${install}`], { timeout: 120_000 });
  const executable = flavor === "Portable" ? artifact : path.join(install, "Palworld Server Manager.exe");
  const profile = path.join(directory, flavor === "Portable" ? "PSM-Data" : "profile");
  const webPort = port++; const debugPort = port++;
  let child; let browser; let page;
  async function launch() {
    const env = { ...process.env, PSM_PORT: String(webPort) }; delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1"], { env, windowsHide: false, stdio: "ignore" });
    browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`));
    page = await until(async () => {
      const pages = browser.contexts().flatMap((context) => context.pages());
      for (const candidate of pages) {
        if (candidate.url().startsWith("data:")) {
          const confirm = candidate.getByRole("button", { name: /^(Upgrade|Continue)$/ });
          if (await confirm.count()) await confirm.first().click();
        }
      }
      return pages.find((candidate) => candidate.url().startsWith(`http://127.0.0.1:${webPort}`));
    });
    await page.waitForLoadState("domcontentloaded");
    await until(() => page.evaluate(() => Boolean(window.psmDesktop)));
  }
  async function api(route, body, method = body === undefined ? "GET" : "POST") {
    return page.evaluate(async ({ route, body, method }) => {
      const response = await fetch(route, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }, { route, body, method });
  }
  async function job(action) {
    const started = await action; assert.equal(started.status, 202, JSON.stringify(started));
    const finished = await until(async () => { const result = (await api(`/api/jobs/${started.body.jobId}`)).body.job; return ["succeeded", "failed", "cancelled"].includes(result.state) ? result : null; }, 240_000);
    if (finished.state !== "succeeded") {
      const logs = (await api(`/api/jobs/${started.body.jobId}/logs`)).body.logs;
      const text = (Array.isArray(logs) ? logs : [logs]).map((entry) => typeof entry === "string" ? entry : entry?.message ?? entry?.line ?? JSON.stringify(entry)).join("\n");
      await writeFile(path.join(output, `${flavor}-job-${finished.kind}.log`), text);
      assert.fail(`${JSON.stringify(finished)}\n--- job log (last lines) ---\n${text.split("\n").slice(-25).join("\n")}`);
    }
    return finished;
  }
  async function quit() {
    await page.evaluate(() => window.psmDesktop.setCloseToTray(false)); await page.close();
    await until(async () => { try { await fetch(`http://127.0.0.1:${webPort}/api/host`); return false; } catch { return true; } });
    await browser.close(); await delay(1_000);
  }
  try {
    // Seed the baseline schema with WAL-backed data; the preflight inside the EXE must open it as current.
    await mkdir(profile, { recursive: true });
    const fixtureDB = new DatabaseSync(path.join(profile, "registry-v3.sqlite"));
    fixtureDB.exec("PRAGMA journal_mode=WAL; CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric, name text, applied_at text);");
    const migrations = (await readdir(path.join(process.cwd(), "drizzle"))).filter((name) => /^\d{14}_/.test(name)).sort();
    for (const name of migrations) {
      const sql = await readFile(path.join(process.cwd(), "drizzle", name, "migration.sql"), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) fixtureDB.exec(statement);
      fixtureDB.prepare("INSERT INTO __drizzle_migrations(hash,created_at,name,applied_at) VALUES(?,?,?,?)").run(createHash("sha256").update(sql).digest("hex"), Date.UTC(+name.slice(0, 4), +name.slice(4, 6) - 1, +name.slice(6, 8), +name.slice(8, 10), +name.slice(10, 12), +name.slice(12, 14)), name, new Date().toISOString());
    }
    fixtureDB.prepare("INSERT INTO events(kind,message,created_at) VALUES('fixture','Preserved native WAL event',?)").run(Date.now());
    await writeFile(path.join(profile, "desktop-preferences.json"), JSON.stringify({ closeToTray: false, launchAtLogin: false, lastSuccessfulAppVersion: "1.0.0-alpha.1" }));
    await launch();
    assert.ok(fixtureDB.prepare("PRAGMA table_info(world_settings)").all().some((column) => column.name === "manager_applied_revision"));
    assert.equal(fixtureDB.prepare("SELECT count(*) AS n FROM events WHERE message='Preserved native WAL event'").get().n, 1);
    fixtureDB.close();

    const ready = await api("/api/runtime/ready");
    assert.equal(ready.status, 200); assert.equal(ready.body.host.platform, "win32");
    assert.deepEqual(ready.body.host.worldPlatforms, ["windows"]);
    assert.equal(ready.body.steamcmd.executable, "steamcmd.exe");
    assert.match(ready.body.steamcmd.url, /steamcmd\.zip$/);
    assert.equal((await fetch(`http://127.0.0.1:${webPort}/api/runtime/ready`)).status, 401);
    // A real first-client bootstrap catches folded platform choices and unimplemented extraction.
    await job(api("/api/runtime/steamcmd", {}));
    const created = await api("/api/worlds", { displayName: "Incomplete native world", installDir: path.join(directory, "missing world") });
    assert.equal(created.status, 201, JSON.stringify(created)); const id = created.body.world.id;
    let settings = (await api(`/api/worlds/${id}/configuration/admin`)).body.configuration;
    const renamed = await api(`/api/worlds/${id}/configuration/admin`, { baseRevision: settings.desiredRevision, managed: { displayNameOverride: "Recoverable native world" } }, "PUT");
    assert.equal(renamed.status, 200, JSON.stringify(renamed));
    const missing = (await api(`/api/worlds/${id}`)).body.world; assert.equal(missing.installation.canStart, false);
    const linux = await api("/api/worlds", { displayName: "Unsupported", installDir: path.join(directory, "linux"), platform: "linux" }); assert.ok(linux.status >= 400);
    await page.screenshot({ path: path.join(output, `${flavor}-first-start.png`) });
    await quit(); await launch();
    assert.equal((await api(`/api/worlds/${id}`)).body.world.displayName, "Recoverable native world");
    // Compile only a small fixture executable; application development remains Linux-based.
    // The manager starts PalServer-Win64-Shipping-Cmd.exe directly and hands it the server log as
    // its stdout, exactly as it does for the real console server binary, so the fixture is the
    // server: it records whether a console window is visible and which arguments arrived, prints
    // its start line to stdout, and heartbeats until it is killed.
    const fixture = path.join(directory, "Fixture server"); await mkdir(path.join(fixture, "Pal", "Binaries", "Win64"), { recursive: true });
    const cs = path.join(directory, "Fixture.cs");
    await writeFile(cs, String.raw`
using System;
using System.IO;
using System.Threading;
using System.Runtime.InteropServices;
class Fixture {
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  static void Main(string[] args) {
    var self = Path.GetFileName(Environment.GetCommandLineArgs()[0]);
    if (self != "PalServer-Win64-Shipping-Cmd.exe") throw new Exception("The manager must start the shipped console server binary directly, not " + self + ".");
    File.WriteAllText("console.txt", IsWindowVisible(GetConsoleWindow()).ToString());
    File.WriteAllLines("argv.txt", args);
    Console.WriteLine("Fixture shipping server started"); Console.Out.Flush();
    while (true) {
      var heartbeat = DateTime.UtcNow.ToString("O");
      File.WriteAllText("heartbeat.txt", heartbeat);
      Console.WriteLine("Fixture heartbeat " + heartbeat); Console.Out.Flush();
      Thread.Sleep(100);
    }
  }
}
`);
    const csc = path.join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    execFileSync(csc, ["/nologo", "/target:exe", `/out:${path.join(fixture, "PalServer.exe")}`, cs]);
    await copyFile(path.join(fixture, "PalServer.exe"), path.join(fixture, "Pal", "Binaries", "Win64", "PalServer-Win64-Shipping.exe"));
    await copyFile(path.join(fixture, "PalServer.exe"), path.join(fixture, "Pal", "Binaries", "Win64", "PalServer-Win64-Shipping-Cmd.exe"));
    const configDir = path.join(fixture, "Pal", "Saved", "Config", "WindowsServer"); await mkdir(configDir, { recursive: true });
    const ini = '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="Native fixture",RESTAPIEnabled=False,RCONEnabled=False)\n';
    await writeFile(path.join(configDir, "PalWorldSettings.ini"), ini); await writeFile(path.join(fixture, "DefaultPalWorldSettings.ini"), ini);
    const adopted = await api("/api/worlds?mode=adopt", { displayName: "Native fixture", installDir: fixture, platform: "windows", restApiEnabled: false, crashGuard: true, extraArgs: '-Log="C:\\Server Logs\\fixture.log" ""' });
    assert.equal(adopted.status, 201, JSON.stringify(adopted)); const fixtureId = adopted.body.world.id;
    await job(api(`/api/worlds/${fixtureId}/actions`, { action: "backup" }));
    const backups = (await api(`/api/worlds/${fixtureId}/backups`)).body.backups;
    assert.ok(backups.length); await job(api(`/api/worlds/${fixtureId}/actions`, { action: "restore", backupId: backups[0].id }));
    assert.equal(await readFile(path.join(configDir, "PalWorldSettings.ini"), "utf8"), ini);
    await job(api(`/api/worlds/${fixtureId}/actions`, { action: "start" }));
    assert.equal(await until(() => readFile(path.join(fixture, "console.txt"), "utf8")), "False", "No console window may be visible for the server");
    await until(async () => (await api(`/api/worlds/${fixtureId}/logs`)).body.logs.content.includes("Fixture shipping server started"));
    const argv = (await readFile(path.join(fixture, "argv.txt"), "utf8")).split(/\r?\n/).slice(0, -1);
    assert.ok(argv.includes("-Log=C:\\Server Logs\\fixture.log")); assert.ok(argv.includes(""), "An explicit empty argument must reach the native child");
    await quit(); const before = await readFile(path.join(fixture, "heartbeat.txt"), "utf8"); await delay(500); assert.notEqual(await readFile(path.join(fixture, "heartbeat.txt"), "utf8"), before);
    await launch(); assert.equal((await api(`/api/worlds/${fixtureId}`)).body.world.status, "running");
    const afterQuitLogs = (await api(`/api/worlds/${fixtureId}/logs`)).body.logs.content;
    assert.ok(afterQuitLogs.includes(before.trim()), "Detached file logging must continue while the manager is closed");
    // Kill only this artifact's bundled web process; preserve its game process and WAL.
    const interruptedDB = new DatabaseSync(path.join(profile, "registry-v3.sqlite"));
    interruptedDB.prepare("INSERT INTO jobs(id,kind,state,message,created_at) VALUES('native-interrupted','backup','running','Fixture interrupted operation',?)").run(Date.now()); interruptedDB.close();
    const runtimePid = (await api("/api/runtime/ready")).body.pid;
    execFileSync("taskkill.exe", ["/PID", String(runtimePid), "/F"]);
    await quit(); await launch();
    assert.equal((await api("/api/jobs/native-interrupted")).body.job.state, "failed");
    assert.equal((await api(`/api/worlds/${fixtureId}`)).body.world.status, "running");
    await job(api(`/api/worlds/${fixtureId}/actions`, { action: "stop", force: true }));
    await delay(6_000);
    assert.equal((await api(`/api/worlds/${fixtureId}`)).body.world.status, "stopped", "Intentional Stop must not trigger crash recovery");
    const login = await page.evaluate(async () => { await window.psmDesktop.setLaunchAtLogin(true); return window.psmDesktop.getLoginStatus(); });
    assert.equal(login.configured, true);
    const registry = execFileSync("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"], { encoding: "utf8" });
    assert.ok(registry.includes(executable), "Login must target the durable executable");
    await page.evaluate(() => window.psmDesktop.setLaunchAtLogin(false));
    await quit();
    if (flavor === "Setup") {
      const uninstaller = (await readdir(install)).find((name) => /^Uninstall.*\.exe$/i.test(name)); assert.ok(uninstaller);
      execFileSync(path.join(install, uninstaller), ["/S"], { timeout: 120_000 });
      assert.equal(await readFile(path.join(configDir, "PalWorldSettings.ini"), "utf8"), ini);
      execFileSync(artifact, ["/S", `/D=${install}`], { timeout: 120_000 }); await launch(); assert.equal((await api(`/api/worlds/${fixtureId}`)).status, 200); await quit();
    }
    results.push({ flavor, artifact: filename, sha256, passed: true });
  } catch (error) {
    results.push({ flavor, artifact: filename, sha256, passed: false, error: String(error), profile });
    if (page) await page.screenshot({ path: path.join(output, `${flavor}-failure.png`) }).catch(() => {});
    try { await copyFile(path.join(profile, "launcher-v3.log"), path.join(output, `${flavor}-launcher.log`)); } catch { /* Startup may fail before log creation. */ }
    throw error;
  } finally {
    await writeFile(path.join(output, "results.json"), JSON.stringify({ root, results }, null, 2));
    // Runner-owned process only; never issue a global image-name kill.
    if (child?.exitCode === null) try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already exited */ }
  }
}
