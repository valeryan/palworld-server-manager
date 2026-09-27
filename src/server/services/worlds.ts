import "server-only";
import path from "node:path";
import { access, realpath } from "node:fs/promises";
import { and, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { CreateWorldInput, WorldRegistration, WorldView } from "@/contracts/world";
import { createWorldSchema, managedWorldSettingsSchema, parseWorldUpdate, worldRegistrationSchema } from "@/contracts/world";
import { database } from "@/server/db";
import { worlds, worldSettings } from "@/server/db/schema";
import { eventBus } from "./events";
import { withReservationLock } from "./reservations";

type WorldRow = typeof worlds.$inferSelect;
const PORT_FIELDS = ["gamePort", "queryPort", "restApiPort", "rconPort"] as const;
const STOP_REQUIRED_FIELDS = ["installDir", "platform", ...PORT_FIELDS, "restApiEnabled", "rconEnabled", "communityServer", "legacyPerfFlags", "extraArgs", "env", "wineBinary", "winePrefix", "wineLaunchFlags"] as const;

function toView(row: WorldRow): WorldView {
  return {
    id: row.id, displayName: row.displayName, installDir: row.installDir, platform: row.platform,
    gamePort: row.gamePort, queryPort: row.queryPort, restApiPort: row.restApiPort, rconPort: row.rconPort,
    adminPassword: row.adminPassword, serverPassword: row.serverPassword, restApiEnabled: row.restApiEnabled,
    rconEnabled: row.rconEnabled, communityServer: row.communityServer, autostart: row.autostart,
    crashGuard: row.crashGuard, legacyPerfFlags: row.legacyPerfFlags, extraArgs: row.extraArgs,
    env: row.environment, wineBinary: row.wineBinary, winePrefix: row.winePrefix, wineLaunchFlags: row.wineLaunchFlags,
    status: row.status, processId: row.processId, buildId: row.buildId, latestBuildId: row.latestBuildId,
    lastStartedAt: row.lastStartedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export async function canonicalInstallDir(candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  let ancestor = resolved;
  const missing: string[] = [];
  while (true) {
    try { return path.join(await realpath(ancestor), ...missing.reverse()); }
    catch {
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

async function validateIsolation(input: CreateWorldInput, excludingId?: string): Promise<CreateWorldInput> {
  const installDir = await canonicalInstallDir(input.installDir);
  const existing = await database().select().from(worlds);
  const desiredRows = await database().select().from(worldSettings);
  const desiredByWorld = new Map(desiredRows.map((row) => [row.worldId, managedWorldSettingsSchema.parse(row.desiredManager)]));
  for (const row of existing) {
    if (row.id === excludingId) continue;
    for (const reservation of [row, desiredByWorld.get(row.id)].filter(Boolean) as Array<typeof row | NonNullable<ReturnType<typeof desiredByWorld.get>>>) {
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
  const parsed = createWorldSchema.parse(raw);
  const row = await withReservationLock(async () => {
    const input = await validateIsolation(parsed); const now = Date.now();
    const candidate: typeof worlds.$inferInsert = {
      id: randomUUID(), displayName: input.displayName, installDir: input.installDir, platform: input.platform,
      gamePort: input.gamePort, queryPort: input.queryPort, restApiPort: input.restApiPort, rconPort: input.rconPort,
      adminPassword: input.adminPassword, serverPassword: input.serverPassword, restApiEnabled: input.restApiEnabled,
      rconEnabled: input.rconEnabled, communityServer: input.communityServer, autostart: input.autostart,
      crashGuard: input.crashGuard, legacyPerfFlags: input.legacyPerfFlags, extraArgs: input.extraArgs,
      environment: input.env, wineBinary: input.wineBinary, winePrefix: input.winePrefix, wineLaunchFlags: input.wineLaunchFlags,
      status: "stopped", createdAt: now, updatedAt: now,
    };
    await database().insert(worlds).values(candidate); return candidate;
  });
  eventBus().publish({ type: "world", worldId: row.id, data: { action: "created" } });
  return (await getWorld(row.id))!;
}

export async function adoptWorld(raw: unknown): Promise<WorldView> {
  const input = createWorldSchema.parse(raw);
  const executable = input.platform === "windows" ? "PalServer.exe" : "PalServer.sh";
  try { await access(path.join(input.installDir, executable)); }
  catch { throw new Error(`Existing installation is missing ${executable}.`); }
  return createWorld(input);
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
    crashGuard: input.crashGuard, legacyPerfFlags: input.legacyPerfFlags, extraArgs: input.extraArgs, environment: input.env,
    wineBinary: input.wineBinary, winePrefix: input.winePrefix, wineLaunchFlags: input.wineLaunchFlags, updatedAt: Date.now(),
  }).where(eq(worlds.id, id)); });
  eventBus().publish({ type: "world", worldId: id, data: { action: "updated" } });
  return (await getWorld(id))!;
}

export function exportWorldRegistration(world: WorldView): WorldRegistration {
  return worldRegistrationSchema.parse({
    format: "psm-next/world-registration",
    version: 1,
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
  try { await access(path.join(world.installDir, executable)); return true; } catch { return false; }
}
