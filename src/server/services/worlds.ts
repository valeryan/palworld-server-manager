import "server-only";
import { assertSupportedTarget, assertLocalWindowsPath, hostCapabilities, hostPlatform } from "@/server/host";
import path from "node:path";
import { access, realpath, readFile } from "node:fs/promises";
import { and, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { CreateWorldInput, WorldPorts, WorldRegistration, WorldView } from "@/contracts/world";
import { createWorldSchema, defaultWorldPorts, managedWorldSettingsSchema, parseWorldUpdate, worldRegistrationSchema } from "@/contracts/world";
import { database } from "@/server/db";
import { worlds, worldSettings } from "@/server/db/schema";
import { paths } from "@/server/paths";
import { eventBus } from "./events";
import { withReservationLock } from "./reservations";

type WorldRow = typeof worlds.$inferSelect;
const PORT_FIELDS = ["gamePort", "queryPort", "restApiPort", "rconPort"] as const;
const STOP_REQUIRED_FIELDS = ["installDir", "platform", ...PORT_FIELDS, "restApiEnabled", "rconEnabled", "communityServer", "legacyPerfFlags", "extraArgs", "argumentFormat", "env", "wineBinary", "winePrefix", "wineLaunchFlags"] as const;

function toView(row: WorldRow): WorldView {
  return {
    id: row.id, displayName: row.displayName, installDir: row.installDir, platform: row.platform,
    gamePort: row.gamePort, queryPort: row.queryPort, restApiPort: row.restApiPort, rconPort: row.rconPort,
    adminPassword: row.adminPassword, serverPassword: row.serverPassword, restApiEnabled: row.restApiEnabled,
    rconEnabled: row.rconEnabled, communityServer: row.communityServer, autostart: row.autostart,
    crashGuard: row.crashGuard, legacyPerfFlags: row.legacyPerfFlags, extraArgs: row.extraArgs, argumentFormat: row.argumentFormat,
    env: row.environment, wineBinary: row.wineBinary, winePrefix: row.winePrefix, wineLaunchFlags: row.wineLaunchFlags,
    status: row.status, processId: row.processId, buildId: row.buildId, latestBuildId: row.latestBuildId,
    lastStartedAt: row.lastStartedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export async function canonicalInstallDir(candidate: string): Promise<string> {
  assertLocalWindowsPath(candidate);
  const resolved = path.resolve(/* turbopackIgnore: true */ candidate);
  let ancestor = resolved;
  const missing: string[] = [];
  while (true) {
    try {
      const canonical = path.join(/* turbopackIgnore: true */ await realpath(ancestor), ...missing.reverse());
      assertLocalWindowsPath(canonical); // Resolve mapped shares and junctions before accepting storage.
      return canonical;
    }
    catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return resolved;
      missing.push(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

export function pathsOverlap(left: string, right: string): boolean {
  const relative = path.relative(left, right);
  const reverse = path.relative(right, left);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) || (!reverse.startsWith("..") && !path.isAbsolute(reverse));
}

async function reservations(excludingId?: string): Promise<Array<{ row: WorldRow; reserved: Array<Pick<CreateWorldInput, "installDir" | (typeof PORT_FIELDS)[number]>> }>> {
  const existing = await database().select().from(worlds);
  const desiredRows = await database().select().from(worldSettings);
  const desiredByWorld = new Map(desiredRows.map((row) => [row.worldId, managedWorldSettingsSchema.parse(row.desiredManager)]));
  return existing.filter((row) => row.id !== excludingId).map((row) => ({ row, reserved: [row, desiredByWorld.get(row.id)].filter((entry) => entry !== undefined) }));
}

// Development profiles shift the first-world defaults (8211 -> 9211, …) so a
// disposable world never collides with production servers on the same host.
function portOffset(): number {
  const raw = process.env.PALWORLD_MANAGER_WORLD_PORT_OFFSET;
  if (!raw) return 0;
  const offset = Number(raw);
  if (!Number.isInteger(offset) || PORT_FIELDS.some((field) => defaultWorldPorts[field] + offset < 1 || defaultWorldPorts[field] + offset > 65535)) throw new Error("PALWORLD_MANAGER_WORLD_PORT_OFFSET must keep every default port between 1 and 65535.");
  return offset;
}

// Each service continues from the highest port any world uses or has reserved
// for it, skipping numbers another service already occupies.
export async function suggestWorldPorts(): Promise<WorldPorts> {
  const reserved = (await reservations()).flatMap((entry) => entry.reserved);
  const taken = new Set(reserved.flatMap((entry) => PORT_FIELDS.map((field) => entry[field])));
  const offset = portOffset();
  const suggestion = {} as WorldPorts;
  for (const field of PORT_FIELDS) {
    const used = reserved.map((entry) => entry[field]);
    let candidate = used.length ? Math.max(...used) + 1 : defaultWorldPorts[field] + offset;
    while (taken.has(candidate)) candidate += 1;
    if (candidate > 65535) throw new Error(`No free ${field} remains above the highest registered port.`);
    taken.add(candidate); suggestion[field] = candidate;
  }
  return suggestion;
}

async function validateIsolation(input: CreateWorldInput, excludingId?: string): Promise<CreateWorldInput> {
  assertSupportedTarget(input.platform);
  const installDir = await validateInstallLocation(input.installDir);
  for (const { row, reserved } of await reservations(excludingId)) {
    for (const reservation of reserved) {
      if (pathsOverlap(installDir, await canonicalInstallDir(reservation.installDir))) {
        throw new Error(`Install directory overlaps with ${row.displayName}: ${reservation.installDir}`);
      }
      for (const field of PORT_FIELDS) {
        for (const otherField of PORT_FIELDS) {
          if (input[field] === reservation[otherField]) throw new Error(`Port ${input[field]} is already used or reserved by ${row.displayName} (${otherField}).`);
        }
      }
    }
  }
  const values = PORT_FIELDS.map((field) => input[field]);
  if (new Set(values).size !== values.length) throw new Error("A world cannot reuse the same port for multiple services.");
  return { ...input, installDir };
}

export async function listWorlds(): Promise<WorldView[]> {
  const rows = await database().select().from(worlds).orderBy(worlds.createdAt);
  return rows.map(toView);
}

export async function getWorld(id: string): Promise<WorldView | null> {
  const [row] = await database().select().from(worlds).where(eq(worlds.id, id)).limit(1);
  return row ? toView(row) : null;
}

export async function createWorld(raw: unknown): Promise<WorldView> {
  const row = await withReservationLock(async () => {
    // Omitted ports are allocated under the reservation lock so concurrent
    // registrations cannot be handed the same suggestion.
    const provided = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const parsed = createWorldSchema.parse(PORT_FIELDS.some((field) => provided[field] == null) ? { platform: hostCapabilities().defaultWorldPlatform, ...await suggestWorldPorts(), ...Object.fromEntries(Object.entries(provided).filter(([, value]) => value != null)) } : { platform: hostCapabilities().defaultWorldPlatform, ...provided });
    const input = await validateIsolation(parsed); const now = Date.now();
    const candidate: typeof worlds.$inferInsert = {
      id: randomUUID(), displayName: input.displayName, installDir: input.installDir, platform: input.platform,
      gamePort: input.gamePort, queryPort: input.queryPort, restApiPort: input.restApiPort, rconPort: input.rconPort,
      adminPassword: input.adminPassword, serverPassword: input.serverPassword, restApiEnabled: input.restApiEnabled,
      rconEnabled: input.rconEnabled, communityServer: input.communityServer, autostart: input.autostart,
      crashGuard: input.crashGuard, legacyPerfFlags: input.legacyPerfFlags, extraArgs: input.extraArgs, argumentFormat: input.argumentFormat ?? (hostPlatform() === "win32" ? "windows" : "legacy"),
      environment: input.env, wineBinary: input.wineBinary, winePrefix: input.winePrefix, wineLaunchFlags: input.wineLaunchFlags,
      status: "stopped", createdAt: now, updatedAt: now,
    };
    await database().insert(worlds).values(candidate); return candidate;
  });
  eventBus().publish({ type: "world", worldId: row.id, data: { action: "created" } });
  return (await getWorld(row.id))!;
}

export async function adoptWorld(raw: unknown): Promise<WorldView> {
  const input = createWorldSchema.parse({ platform: hostCapabilities().defaultWorldPlatform, ...(raw && typeof raw === "object" ? raw : {}) });
  const executable = input.platform === "windows" ? "PalServer.exe" : "PalServer.sh";
  try { await access(path.join(/* turbopackIgnore: true */ input.installDir, executable)); }
  catch { throw new Error(`Existing installation is missing ${executable}.`); }
  const { inspectInstallation } = await import("./installation");
  const inspection = await inspectInstallation(input.installDir, input.platform);
  if (!inspection.executable) throw new Error("Existing installation is incomplete. Register it through Install to repair the server files.");
  const world = await createWorld(raw);
  if (inspection.buildId) await database().update(worlds).set({ buildId: inspection.buildId }).where(eq(worlds.id, world.id));
  return (await getWorld(world.id))!;
}

export async function updateWorld(id: string, raw: unknown): Promise<WorldView> {
  const current = await getWorld(id);
  if (!current) throw new Error("World not found.");
  const patch = parseWorldUpdate(raw);
  if (current.status !== "stopped" && STOP_REQUIRED_FIELDS.some((field) => Object.hasOwn(patch, field) && JSON.stringify(patch[field]) !== JSON.stringify(current[field]))) {
    throw new Error("Stop the world before changing launch, path, port, platform, or environment settings.");
  }
  const merged = createWorldSchema.parse({ ...current, ...patch });
  await withReservationLock(async () => { const input = await validateIsolation(merged, id); await database().update(worlds).set({
    displayName: input.displayName, installDir: input.installDir, platform: input.platform,
    gamePort: input.gamePort, queryPort: input.queryPort, restApiPort: input.restApiPort, rconPort: input.rconPort,
    adminPassword: input.adminPassword, serverPassword: input.serverPassword, restApiEnabled: input.restApiEnabled,
    rconEnabled: input.rconEnabled, communityServer: input.communityServer, autostart: input.autostart,
    crashGuard: input.crashGuard, legacyPerfFlags: input.legacyPerfFlags, extraArgs: input.extraArgs, argumentFormat: input.argumentFormat ?? (hostPlatform() === "win32" ? "windows" : "legacy"), environment: input.env,
    wineBinary: input.wineBinary, winePrefix: input.winePrefix, wineLaunchFlags: input.wineLaunchFlags, updatedAt: Date.now(),
  }).where(eq(worlds.id, id)); });
  eventBus().publish({ type: "world", worldId: id, data: { action: "updated" } });
  return (await getWorld(id))!;
}

export function exportWorldRegistration(world: WorldView): WorldRegistration {
  return worldRegistrationSchema.parse({
    format: "psm-next/world-registration",
    version: 2,
    exportedAt: new Date().toISOString(),
    sourceWorldId: world.id,
    world: {
      displayName: world.displayName,
      installDir: world.installDir,
      platform: world.platform,
      gamePort: world.gamePort,
      queryPort: world.queryPort,
      restApiPort: world.restApiPort,
      rconPort: world.rconPort,
      restApiEnabled: world.restApiEnabled,
      rconEnabled: world.rconEnabled,
      communityServer: world.communityServer,
      autostart: false,
      crashGuard: world.crashGuard,
      legacyPerfFlags: world.legacyPerfFlags,
      extraArgs: world.extraArgs,
      argumentFormat: world.argumentFormat,
      env: world.env,
      wineBinary: world.wineBinary,
      winePrefix: world.winePrefix,
      wineLaunchFlags: world.wineLaunchFlags,
    },
  });
}

export async function unregisterWorld(id: string): Promise<void> {
  const world = await getWorld(id);
  if (!world) return;
  if (world.status !== "stopped" || world.processId) throw new Error("Stop the world before removing its registration.");
  await database().delete(worlds).where(and(eq(worlds.id, id), ne(worlds.status, "running")));
  eventBus().publish({ type: "world", worldId: id, data: { action: "unregistered" } });
}

export async function setRuntimeState(id: string, status: WorldView["status"], processId: number | null): Promise<void> {
  await database().update(worlds).set({ status, processId, updatedAt: Date.now() }).where(eq(worlds.id, id));
  eventBus().publish({ type: "world", worldId: id, data: { action: "status", status, processId } });
}

export async function installationExists(world: WorldView): Promise<boolean> {
  const executable = world.platform === "windows" ? "PalServer.exe" : "PalServer.sh";
  try { await access(path.join(/* turbopackIgnore: true */ world.installDir, executable)); return true; } catch { return false; }
}

export async function validateInstallLocation(candidate: string): Promise<string> {
  const canonical = await canonicalInstallDir(candidate);
  if (canonical === path.parse(canonical).root) throw new Error("An installation cannot use a drive or filesystem root.");
  if (pathsOverlap(canonical, await canonicalInstallDir(paths.data()))) throw new Error("An installation cannot overlap manager-owned data.");
  return canonical;
}
export async function assertWorldOwnership(world: Pick<WorldView, "installDir">): Promise<void> {
  for (const name of [".psm-runtime-owner.json", ".psm-operation-owner.json"]) {
    let lease: { profile: string; owner: import("./process-inspection").ProcessIdentity; processes?: import("./process-inspection").ProcessIdentity[] };
    try { lease = JSON.parse(await readFile(path.join(/* turbopackIgnore: true */ world.installDir, name), "utf8")); }
    catch (error) { if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) continue; throw new Error("Installation ownership record is unreadable; inspect it before making changes."); }
    if (lease.profile === paths.data()) continue;
    const { processSnapshot, sameProcess, ownedTree } = await import("./process-inspection"); const snapshot = await processSnapshot();
    if (snapshot.some((row) => sameProcess(lease.owner, row)) || ownedTree(lease.processes ?? [], snapshot).length) throw new Error("Another manager profile owns this installation; close its operations before making changes here.");
  }
}
