import "server-only";
import path from "node:path";
import { access, readFile, readdir } from "node:fs/promises";
import { isDirectory, isFile } from "@/server/fs";
import { desc, eq } from "drizzle-orm";
import { createWorldSchema, isWorldStopped, type WorldView } from "@/contracts/world";
import { isJobActive, SERVER_INSTALL_JOB_KINDS } from "@/contracts/job";
import type { InstallationHealth } from "@/contracts/installation";
import { configurationIsValid } from "@/lib/palworld-ini";
import { ConflictError } from "@/server/errors";
import { hostCapabilities, hostPlatform } from "@/server/host";
import { database } from "@/server/db";
import { jobs, worlds } from "@/server/db/schema";
import { configPath } from "./configuration/managed";
import { inspectPrerequisites } from "./prerequisites";
import { readInstalledBuild } from "./steam-manifest";
import { canonicalInstallDir, createWorld, getWorld } from "./worlds";
export async function inspectInstallation(installDir: string, target?: "linux" | "windows") {
  const platforms: Array<"linux" | "windows"> = [];
  if (await isFile(path.join(/* turbopackIgnore: true */ installDir, "PalServer.sh"))) platforms.push("linux");
  if (await isFile(path.join(/* turbopackIgnore: true */ installDir, "PalServer.exe"))) platforms.push("windows");
  const platform = target ?? (platforms.length === 1 ? platforms[0] : undefined);
  const warnings: string[] = []; let executable = false;
  if (platform) {
    const launcher = path.join(/* turbopackIgnore: true */ installDir, platform === "windows" ? "PalServer.exe" : "PalServer.sh");
    const bytes = await readFile(launcher).catch(() => null);
    executable = Boolean(bytes?.length && (platform !== "windows" || bytes.subarray(0, 2).toString() === "MZ"));
    if (platform === "windows") {
      const names = await readdir(path.join(/* turbopackIgnore: true */ installDir, "Pal", "Binaries", "Win64")).catch(() => []);
      const native = hostPlatform() === "win32";
      const available = native
        ? names.some((name) => name.toLowerCase() === "palserver-win64-shipping-cmd.exe")
        : names.some((name) => /^PalServer.*Shipping.*\.exe$/i.test(name));
      if (!available) { executable = false; warnings.push(native ? "PalServer-Win64-Shipping-Cmd.exe is missing; repair the Windows installation before starting." : "The Windows shipping-server executable is missing."); }
    }
  }
  const content = platform ? await readFile(configPath(installDir, platform), "utf8").catch(() => "") : "";
  const configuration = configurationIsValid(content);
  const template = !content.trim() ? await readFile(path.join(/* turbopackIgnore: true */ installDir, "DefaultPalWorldSettings.ini"), "utf8").catch(() => "") : "";
  const canInitialize = !content.trim() && configurationIsValid(template);
  const saves = await isDirectory(path.join(/* turbopackIgnore: true */ installDir, "Pal", "Saved"));
  const build = platform ? readInstalledBuild({ installDir }) : null;
  const buildId = build?.buildId ?? null;
  if (!buildId) warnings.push("Installed build is unknown; no matching Steam manifest was found.");
  if (!configuration && !canInitialize) warnings.push("Game configuration is missing or malformed.");
  const nonempty = (await readdir(installDir).catch(() => [])).length > 0;
  return { installDir, nonempty, platforms, platform, ambiguous: platforms.length > 1 && !target, executable, configuration, canInitialize, saves, buildId, manifestPath: build?.manifestPath ?? null, warnings };
}
export async function installationHealth(world: WorldView): Promise<InstallationHealth> {
  const inspected = await inspectInstallation(world.installDir, world.platform);
  const prerequisite = await inspectPrerequisites(world);
  const [last] = await database().select().from(jobs).where(eq(jobs.worldId, world.id)).orderBy(desc(jobs.createdAt)).limit(1);
  const busy = Boolean(last && isJobActive(last));
  const lastIsInstall = SERVER_INSTALL_JOB_KINDS.has(last?.kind ?? "");
  const activeInstall = busy && lastIsInstall;
  const supported = hostCapabilities().worldPlatforms.includes(world.platform);
  const reasons = [...inspected.warnings.filter((warning) => !warning.startsWith("Installed build"))];
  if (world.status === "unknown") reasons.push("Process ownership is uncertain. Inspect the manager log and Windows processes before changing this installation.");
  if (!supported) reasons.push("This host cannot run the selected world platform.");
  if (!inspected.executable) reasons.push("Server files are missing or incomplete. Install or repair this world.");
  if (prerequisite.state === "missing") reasons.push(prerequisite.detail);
  const lastInstallFailed = last?.state === "failed" && lastIsInstall;
  if (lastInstallFailed) reasons.push(last.error ?? "The last installation operation failed; inspect its output before retrying.");
  const state = activeInstall ? "installing" : !inspected.executable ? (lastInstallFailed ? "failed" : "missing") : reasons.length ? "repair-needed" : "ready";
  const idle = !busy && !world.processId && isWorldStopped(world);
  return { state, reasons, lastJobId: last?.id ?? null, prerequisite,
    canStart: state === "ready" && idle,
    canBackup: inspected.saves && !busy && world.status !== "unknown",
    canInstall: supported && idle };
}

export async function adoptWorld(raw: unknown): Promise<WorldView> {
  const input = createWorldSchema.parse({ platform: hostCapabilities().defaultWorldPlatform, ...(raw && typeof raw === "object" ? raw : {}) });
  const executable = input.platform === "windows" ? "PalServer.exe" : "PalServer.sh";
  try { await access(path.join(/* turbopackIgnore: true */ input.installDir, executable)); }
  catch { throw new ConflictError(`Existing installation is missing ${executable}.`); }
  const inspection = await inspectInstallation(input.installDir, input.platform);
  if (!inspection.executable) throw new ConflictError("Existing installation is incomplete. Register it through Install to repair the server files.");
  const world = await createWorld(raw);
  if (inspection.buildId) await database().update(worlds).set({ buildId: inspection.buildId }).where(eq(worlds.id, world.id));
  return (await getWorld(world.id))!;
}

/** Registers a new world: `install` needs an empty directory, `adopt` takes over an existing server. */
export async function registerWorld(body: unknown, mode: "install" | "adopt"): Promise<WorldView> {
  if (mode === "adopt") return adoptWorld(body);
  const installDir = body && typeof body === "object" && typeof (body as Record<string, unknown>).installDir === "string" ? (body as Record<string, string>).installDir : null;
  if (installDir) {
    const directory = await canonicalInstallDir(installDir);
    const entries = await readdir(path.resolve(/* turbopackIgnore: true */ directory)).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    if (entries.length) throw new ConflictError("A new installation must use an empty directory. Use Adopt for an existing server.");
  }
  return createWorld(body);
}
