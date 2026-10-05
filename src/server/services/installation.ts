import "server-only";
import path from "node:path";
import { readFile, stat, readdir } from "node:fs/promises";
import { desc, eq } from "drizzle-orm";
import type { WorldView } from "@/contracts/world";
import type { InstallationHealth } from "@/contracts/installation";
import { hostCapabilities } from "@/server/host";
import { database } from "@/server/db";
import { jobs } from "@/server/db/schema";
import { readInstalledBuild } from "./steamcmd";
import { configPath, configurationIsValid } from "./configuration";
import { inspectPrerequisites } from "./prerequisites";
export async function inspectInstallation(installDir: string, target?: "linux" | "windows") {
  const present = async (file: string) => (await stat(file).catch(() => null))?.isFile() ?? false;
  const platforms: Array<"linux" | "windows"> = [];
  if (await present(path.join(/* turbopackIgnore: true */ installDir, "PalServer.sh"))) platforms.push("linux");
  if (await present(path.join(/* turbopackIgnore: true */ installDir, "PalServer.exe"))) platforms.push("windows");
  const platform = target ?? (platforms.length === 1 ? platforms[0] : undefined);
  const warnings: string[] = []; let executable = false;
  if (platform) {
    const launcher = path.join(/* turbopackIgnore: true */ installDir, platform === "windows" ? "PalServer.exe" : "PalServer.sh");
    const bytes = await readFile(launcher).catch(() => null);
    executable = Boolean(bytes?.length && (platform !== "windows" || bytes.subarray(0, 2).toString() === "MZ"));
    if (platform === "windows") {
      const names = await readdir(path.join(/* turbopackIgnore: true */ installDir, "Pal", "Binaries", "Win64")).catch(() => []);
      if (!names.some((name) => /^PalServer.*Shipping.*\.exe$/i.test(name))) { executable = false; warnings.push("The Windows shipping-server executable is missing."); }
    }
  }
  const content = platform ? await readFile(configPath(installDir, platform), "utf8").catch(() => "") : "";
  const configuration = configurationIsValid(content);
  const template = !content.trim() ? await readFile(path.join(/* turbopackIgnore: true */ installDir, "DefaultPalWorldSettings.ini"), "utf8").catch(() => "") : "";
  const canInitialize = !content.trim() && configurationIsValid(template);
  const saves = (await stat(path.join(/* turbopackIgnore: true */ installDir, "Pal", "Saved")).catch(() => null))?.isDirectory() ?? false;
  const build = platform ? readInstalledBuild({ installDir, platform } as WorldView) : null;
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
  const busy = Boolean(last && ["queued", "running"].includes(last.state));
  const activeInstall = busy && /install|update/.test(last?.kind ?? "");
  const supported = hostCapabilities().worldPlatforms.includes(world.platform);
  const reasons = [...inspected.warnings.filter((warning) => !warning.startsWith("Installed build"))];
  if (world.status === "unknown") reasons.push("Process ownership is uncertain. Inspect the manager log and Windows processes before changing this installation.");
  if (!supported) reasons.push("This host cannot run the selected world platform.");
  if (!inspected.executable) reasons.push("Server files are missing or incomplete. Install or repair this world.");
  if (prerequisite.state === "missing") reasons.push(prerequisite.detail);
  if (last?.state === "failed" && /^(install|update)$/.test(last.kind)) reasons.push(last.error ?? "The last installation operation failed; inspect its output before retrying.");
  const state = activeInstall ? "installing" : !inspected.executable ? last?.state === "failed" && /install|update/.test(last.kind) ? "failed" : "missing" : reasons.length ? "repair-needed" : "ready";
  return { state, reasons, lastJobId: last?.id ?? null, prerequisite,
    canStart: state === "ready" && !busy && !world.processId && ["stopped", "crashed"].includes(world.status),
    canBackup: inspected.saves && !busy && world.status !== "unknown",
    canInstall: supported && !busy && !world.processId && ["stopped", "crashed"].includes(world.status) };
}
