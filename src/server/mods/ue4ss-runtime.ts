import "server-only";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { eq } from "drizzle-orm";
import type { ModVariant } from "@/contracts/mod";
import type { WorldView } from "@/contracts/world";
import { database } from "@/server/db";
import { events, modRuntimes } from "@/server/db/schema";
import { paths } from "@/server/paths";
import { fileMatches, movePath, relativeEntry, safeEntries } from "@/server/services/archive";
import type { JobContext } from "@/server/services/jobs";
import { runsUnderWine, withWineOverrides } from "@/server/services/wine";
import { MOD_CATALOG, artifactPath, type CatalogArtifact } from "./catalog";
import { ue4ssLayout } from "./ue4ss";

type RuntimeRow = typeof modRuntimes.$inferSelect;
type RuntimeWorld = Pick<WorldView, "id" | "installDir" | "platform" | "status" | "processId">;

// How each build's archive maps onto a world. Everything under the archive's Mods folder is left
// out except the shared Lua helpers: releases ship example, cheat, and experimental mods.
const PACKAGES: Record<ModVariant, { marker: string; mods: string; settings: string; memberLayout: string; loader: string }> = {
  windows: { marker: "dwmapi.dll", mods: "ue4ss/Mods/", settings: "ue4ss/UE4SS-settings.ini", memberLayout: "ue4ss/MemberVariableLayout.ini", loader: "dwmapi.dll" },
  linux: { marker: "libUE4SS.so", mods: "Mods/", settings: "UE4SS-settings.ini", memberLayout: "MemberVariableLayout.ini", loader: "libUE4SS.so" },
};
const DISABLED_SUFFIX = ".psm-disabled";
const CONSOLE_KEYS = ["ConsoleEnabled", "GuiConsoleEnabled", "GuiConsoleVisible"] as const;
// A crash this soon after start, twice in a row with UE4SS enabled, pauses crash recovery.
export const EARLY_CRASH_WINDOW_MS = 120_000;
const EARLY_CRASH_LIMIT = 2;

function destination(world: Pick<WorldView, "installDir" | "platform">): string { return ue4ssLayout(world).variant === "windows" ? ue4ssLayout(world).binaries : world.installDir; }
function relativeToInstall(world: Pick<WorldView, "installDir">, absolute: string): string { return path.relative(world.installDir, absolute).split(path.sep).join("/"); }
function absolute(world: Pick<WorldView, "installDir">, relative: string): string { return path.join(/* turbopackIgnore: true */ world.installDir, ...relative.split("/")); }
async function exists(target: string): Promise<boolean> { try { await stat(target); return true; } catch { return false; } }

export async function runtimeRow(worldId: string): Promise<RuntimeRow | null> {
  const [row] = await database().select().from(modRuntimes).where(eq(modRuntimes.worldId, worldId)).limit(1);
  return row ?? null;
}

function artifactFor(variant: ModVariant): CatalogArtifact {
  const found = MOD_CATALOG.find((entry) => entry.kind === "ue4ss" && entry.variant === variant);
  if (!found) throw new Error(`No UE4SS build is pinned for ${variant} worlds.`);
  return found;
}

function assertStopped(world: RuntimeWorld): void {
  if (world.status !== "stopped" && world.status !== "crashed") throw new Error("Stop the server before changing UE4SS.");
}

// Entries to install, as paths relative to the world's UE4SS destination.
export function installPlan(zip: AdmZip, variant: ModVariant): Array<{ relative: string; size: number; data: () => Buffer }> {
  const spec = PACKAGES[variant];
  const names = zip.getEntries().map((entry) => entry.entryName.replaceAll("\\", "/"));
  const marker = names.filter((name) => name === spec.marker || name.endsWith(`/${spec.marker}`)).sort((a, b) => a.length - b.length)[0];
  if (!marker) throw new Error(`The archive does not contain ${spec.marker}; it is not a ${variant} UE4SS build.`);
  const root = marker.slice(0, marker.length - spec.marker.length);
  return zip.getEntries().filter((entry) => !entry.isDirectory).flatMap((entry) => {
    const name = entry.entryName.replaceAll("\\", "/");
    if (!name.startsWith(root)) return [];
    const relative = relativeEntry(name, root);
    if (relative.startsWith(spec.mods) && !relative.startsWith(`${spec.mods}shared/`)) return [];
    return [{ relative, size: entry.header.size, data: () => entry.getData() }];
  });
}

// Dedicated servers must never open the UE4SS console or GUI.
export function withConsoleDisabled(content: string): string {
  let result = content;
  for (const key of CONSOLE_KEYS) {
    const pattern = new RegExp(`^(\\s*${key}\\s*=\\s*).*$`, "m");
    result = pattern.test(result) ? result.replace(pattern, "$10") : `${result}${result.endsWith("\n") || !result ? "" : "\n"}${key} = 0\n`;
  }
  return result;
}

async function pruneEmptyDirectories(world: RuntimeWorld, relativeFiles: string[]): Promise<void> {
  const root = path.resolve(/* turbopackIgnore: true */ world.installDir);
  const directories = [...new Set(relativeFiles.flatMap((file) => {
    const parts = file.split("/").slice(0, -1); return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
  }))].sort((a, b) => b.length - a.length);
  for (const directory of directories) {
    const target = absolute(world, directory);
    if (path.resolve(/* turbopackIgnore: true */ target) === root) continue;
    if ((await readdir(target).catch(() => ["keep"])).length === 0) await rmdir(target).catch(() => undefined);
  }
}

// Installs (or updates, or with replace: takes over) UE4SS in a stopped world from the verified
// library copy. Never downloads.
export async function installUe4ss(world: RuntimeWorld, options: { replace: boolean }, context: JobContext): Promise<void> {
  assertStopped(world);
  const layout = ue4ssLayout(world); const artifact = artifactFor(layout.variant);
  if (!await exists(layout.binaries)) throw new Error("The server binaries for this world were not found; install or update the server first.");
  const archive = await readFile(artifactPath(artifact)).catch(() => { throw new Error(`${artifact.name} ${artifact.version} is not in the Mods library. Download it from the Mods library first.`); });
  if (createHash("sha256").update(archive).digest("hex") !== artifact.sha256) throw new Error(`The library copy of ${artifact.name} ${artifact.version} failed verification. Remove it from the Mods library and download it again.`);
  const zip = new AdmZip(archive);
  if (!safeEntries(zip)) throw new Error("The UE4SS archive contains unsafe paths.");
  const plan = installPlan(zip, layout.variant);
  const base = destination(world);
  const targets = plan.map((entry) => ({ ...entry, file: relativeToInstall(world, path.join(/* turbopackIgnore: true */ base, ...entry.relative.split("/"))) }));
  const previous = await runtimeRow(world.id);
  const owned = new Set(previous?.installedFiles ?? []);
  const spec = PACKAGES[layout.variant];
  const disabledLoader = relativeToInstall(world, path.join(/* turbopackIgnore: true */ base, `${spec.loader}${DISABLED_SUFFIX}`));
  const conflicts = (await Promise.all(targets.map(async (target) => !owned.has(target.file) && await exists(absolute(world, target.file)) ? target.file : null))).filter((file): file is string => file !== null);
  if (conflicts.length && !options.replace) throw new Error(`This world already has UE4SS files that PSM did not install (${conflicts.slice(0, 3).join(", ")}${conflicts.length > 3 ? ", …" : ""}). Use "Replace with library version" to move them aside and install the library build.`);
  if (conflicts.length) {
    const trash = path.join(/* turbopackIgnore: true */ paths.modTrash(world.id), `ue4ss-${Date.now()}`);
    for (const file of conflicts) await movePath(absolute(world, file), path.join(/* turbopackIgnore: true */ trash, ...file.split("/")));
    context.log(`Moved ${conflicts.length} existing UE4SS file(s) to ${trash}`);
  }
  await context.update(20, `Installing ${artifact.name} ${artifact.version}`);
  await rm(absolute(world, disabledLoader), { force: true });
  for (const [index, target] of targets.entries()) {
    const file = absolute(world, target.file);
    await mkdir(path.dirname(file), { recursive: true });
    const data = target.relative === spec.settings ? Buffer.from(withConsoleDisabled(target.data().toString("utf8"))) : target.data();
    await writeFile(file, data);
    if (index % 25 === 0) await context.update(20 + Math.floor((index / targets.length) * 70), `Installed ${index + 1} of ${targets.length} files`);
  }
  const installed = targets.map((target) => target.file);
  const stale = [...owned].filter((file) => !installed.includes(file));
  for (const file of stale) await rm(absolute(world, file), { force: true });
  await pruneEmptyDirectories(world, stale);
  const now = Date.now();
  // Updating or repairing keeps a disabled install disabled, with its Windows loader parked again.
  const enabled = previous ? previous.enabled : true;
  if (!enabled && layout.variant === "windows") { const loader = path.join(/* turbopackIgnore: true */ base, spec.loader); await rename(loader, `${loader}${DISABLED_SUFFIX}`).catch(() => undefined); }
  const values = { artifactId: artifact.id, variant: layout.variant, version: artifact.version, sha256: artifact.sha256, enabled, installedFiles: installed, earlyCrashes: 0, recoveryPaused: false, updatedAt: now };
  if (previous) await database().update(modRuntimes).set(values).where(eq(modRuntimes.worldId, world.id));
  else await database().insert(modRuntimes).values({ worldId: world.id, ...values, installedAt: now });
  context.log(`Installed ${installed.length} files for ${artifact.name} ${artifact.version} (example and cheat mods left out; console disabled).`);
  await context.update(100, `${artifact.name} ${artifact.version} installed; it loads on the next server start`);
}

export async function setUe4ssEnabled(world: RuntimeWorld, enabled: boolean): Promise<void> {
  assertStopped(world);
  const row = await runtimeRow(world.id); if (!row) throw new Error("UE4SS was not installed by PSM in this world.");
  if (row.variant === "windows") {
    // Native Windows loads dwmapi.dll from the game folder unconditionally, so disabling moves it aside.
    const base = destination(world); const loader = path.join(/* turbopackIgnore: true */ base, PACKAGES.windows.loader); const parked = `${loader}${DISABLED_SUFFIX}`;
    if (enabled && await exists(parked)) await rename(parked, loader);
    if (!enabled && await exists(loader)) await rename(loader, parked);
  }
  await database().update(modRuntimes).set({ enabled, earlyCrashes: 0, recoveryPaused: false, updatedAt: Date.now() }).where(eq(modRuntimes.worldId, world.id));
}

// Removes only files PSM installed. Mods the user added and files UE4SS created (its log, its
// status mod) stay, so nothing outside the manager's own install is lost.
export async function removeUe4ss(world: RuntimeWorld, context: JobContext): Promise<void> {
  assertStopped(world);
  const row = await runtimeRow(world.id); if (!row) throw new Error("UE4SS was not installed by PSM in this world.");
  const loader = row.installedFiles.find((file) => file.endsWith(`/${PACKAGES.windows.loader}`) || file === PACKAGES.windows.loader);
  const files = [...row.installedFiles, ...(loader ? [`${loader}${DISABLED_SUFFIX}`] : [])];
  for (const file of files) await rm(absolute(world, file), { force: true });
  await pruneEmptyDirectories(world, files);
  await database().delete(modRuntimes).where(eq(modRuntimes.worldId, world.id));
  context.log(`Removed ${row.installedFiles.length} UE4SS files installed by PSM.`);
  await context.update(100, "UE4SS removed from this world");
}

// Adds what the server process needs to load UE4SS, and refuses a start that would crash.
export async function applyUe4ssLaunch(world: Pick<WorldView, "id" | "installDir" | "platform">, env: NodeJS.ProcessEnv): Promise<void> {
  const row = await runtimeRow(world.id); if (!row?.enabled) return;
  const spec = PACKAGES[row.variant]; const base = destination(world);
  const loader = path.join(/* turbopackIgnore: true */ base, spec.loader);
  const settings = await readFile(path.join(/* turbopackIgnore: true */ base, ...spec.settings.split("/")), "utf8").catch(() => null);
  const problems = [
    !await exists(loader) && `${spec.loader} is missing`,
    !await exists(path.join(/* turbopackIgnore: true */ base, ...spec.memberLayout.split("/"))) && "MemberVariableLayout.ini is missing, and hooked game events would crash the server",
    settings === null && "UE4SS-settings.ini is missing",
    settings !== null && CONSOLE_KEYS.some((key) => !new RegExp(`^\\s*${key}\\s*=\\s*0\\s*$`, "m").test(settings)) && "the UE4SS console is enabled in UE4SS-settings.ini",
  ].filter((problem): problem is string => Boolean(problem));
  if (problems.length) throw new Error(`UE4SS is enabled but ${problems.join("; ")}. Reinstall it or disable it in the Mods tab.`);
  if (row.variant === "linux") env.LD_PRELOAD = [loader, env.LD_PRELOAD].filter(Boolean).join(":");
  else if (runsUnderWine(world)) env.WINEDLLOVERRIDES = withWineOverrides(env.WINEDLLOVERRIDES, "dwmapi=n,b");
}

// Called for every unexpected server exit. Returns true when crash recovery must not restart the
// server: two crashes in a row shortly after start while UE4SS is enabled.
export async function recordUnexpectedExit(worldId: string, exit: { code: number | null; uptimeMs: number | null }): Promise<boolean> {
  const row = await runtimeRow(worldId); if (!row?.enabled) return false;
  const early = exit.code !== 0 && exit.uptimeMs !== null && exit.uptimeMs < EARLY_CRASH_WINDOW_MS;
  const earlyCrashes = early ? row.earlyCrashes + 1 : 0; const pause = earlyCrashes >= EARLY_CRASH_LIMIT;
  await database().update(modRuntimes).set({ earlyCrashes, recoveryPaused: pause, updatedAt: Date.now() }).where(eq(modRuntimes.worldId, worldId));
  if (pause) await database().insert(events).values({ worldId, kind: "mods", message: `Crash recovery paused: the server crashed ${earlyCrashes} times within two minutes of starting with UE4SS enabled. Disable or reinstall UE4SS in the Mods tab.`, createdAt: Date.now() });
  return pause;
}

export async function recordHealthyExit(worldId: string): Promise<void> {
  await database().update(modRuntimes).set({ earlyCrashes: 0, updatedAt: Date.now() }).where(eq(modRuntimes.worldId, worldId));
}

export interface FileCheck { missing: string[]; changed: string[]; libraryAvailable: boolean }

// Compares the files PSM installed with the library build they came from, byte for byte.
export async function checkUe4ssFiles(world: Pick<WorldView, "id" | "installDir" | "platform">): Promise<FileCheck | null> {
  const row = await runtimeRow(world.id); if (!row) return null;
  const spec = PACKAGES[row.variant]; const base = destination(world);
  const artifact = MOD_CATALOG.find((entry) => entry.id === row.artifactId);
  const archive = artifact && artifact.sha256 === row.sha256 ? await readFile(artifactPath(artifact)).catch(() => null) : null;
  const expected = new Map<string, { size: number; data: () => Buffer }>();
  if (archive) for (const entry of installPlan(new AdmZip(archive), row.variant)) {
    const file = relativeToInstall(world, path.join(/* turbopackIgnore: true */ base, ...entry.relative.split("/")));
    if (entry.relative !== spec.settings) { expected.set(file, entry); continue; }
    const settings = Buffer.from(withConsoleDisabled(entry.data().toString("utf8")));
    expected.set(file, { size: settings.byteLength, data: () => settings });
  }
  const missing: string[] = []; const changed: string[] = [];
  for (const file of row.installedFiles) {
    // A disabled Windows build keeps its loader parked under another name.
    const parked = !row.enabled && row.variant === "windows" && path.basename(file) === spec.loader;
    const target = absolute(world, parked ? `${file}${DISABLED_SUFFIX}` : file); const wanted = expected.get(file);
    const matches = wanted ? await fileMatches(target, row.sha256, wanted) : await exists(target) || null;
    if (matches === null) missing.push(file); else if (!matches) changed.push(file);
  }
  return { missing, changed, libraryAvailable: archive !== null };
}
