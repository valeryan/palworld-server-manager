import "server-only";
import { assertSupportedTarget, assertLocalWindowsPath, hostCapabilities, hostPlatform } from "@/server/host";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { and, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { ArgumentFormat, CreateWorldInput, ManagedWorldSettings, PortField, WorldPorts, WorldRegistration, WorldView } from "@/contracts/world";
import { createWorldSchema, defaultWorldPorts, isWorldStopped, managedWorldSettingsSchema, pickManaged, PORT_FIELDS, worldRegistrationSchema } from "@/contracts/world";
import { ConflictError, NotFoundError } from "@/server/errors";
import { database } from "@/server/db";
import { worlds, worldSettings } from "@/server/db/schema";
import { paths } from "@/server/paths";
import { eventBus } from "./events";
import { withReservationLock } from "./reservations";
import { holdWorldLock } from "./locks";

type WorldRow = typeof worlds.$inferSelect;
type Reservation = Pick<CreateWorldInput, "installDir" | PortField>;

// The row as the application sees it: `environment` becomes `env`, and columns that only the
// process monitor uses (identity, crash counters) are not part of the view.
function toView(row: WorldRow): WorldView {
  const { environment, ...rest } = row;
  const view: WorldView & Partial<Pick<WorldRow, "processIdentity" | "crashCount">> = { ...rest, env: environment };
  delete view.processIdentity; delete view.crashCount;
  return view;
}

/** The managed settings as `worlds` columns. The argument format defaults per host when a world is created. */
export function toWorldColumns(settings: ManagedWorldSettings, argumentFormat: ArgumentFormat) {
  const { env, argumentFormat: chosen, ...rest } = settings;
  return { ...rest, environment: env, argumentFormat: chosen ?? argumentFormat };
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

// Every world's current registration plus its staged (desired) settings, since a staged move or
// port change reserves its target just as firmly as the live one.
async function reservations(excludingId?: string): Promise<Array<{ row: WorldRow; reserved: Reservation[] }>> {
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

/**
 * Checks that `candidate`'s install directory and ports collide with no other world's live or
 * staged registration, and that its own ports are distinct. Returns the canonical install directory.
 * Callers must hold the reservation lock.
 */
export async function assertReservationsFree(candidate: Reservation, excludingId?: string): Promise<string> {
  const installDir = await validateInstallLocation(candidate.installDir);
  for (const { row, reserved } of await reservations(excludingId)) {
    for (const reservation of reserved) {
      if (pathsOverlap(installDir, await canonicalInstallDir(reservation.installDir))) throw new ConflictError(`Install directory overlaps with ${row.displayName}: ${reservation.installDir}`);
      for (const field of PORT_FIELDS) for (const otherField of PORT_FIELDS) if (candidate[field] === reservation[otherField]) throw new ConflictError(`Port ${candidate[field]} is already used or reserved by ${row.displayName} (${otherField}).`);
    }
  }
  if (new Set(PORT_FIELDS.map((field) => candidate[field])).size !== PORT_FIELDS.length) throw new ConflictError("A world cannot reuse the same port for multiple services.");
  return installDir;
}

export async function listWorlds(): Promise<WorldView[]> {
  const rows = await database().select().from(worlds).orderBy(worlds.createdAt);
  return rows.map(toView);
}

export async function getWorld(id: string): Promise<WorldView | null> {
  const [row] = await database().select().from(worlds).where(eq(worlds.id, id)).limit(1);
  return row ? toView(row) : null;
}

export async function requireWorld(id: string): Promise<WorldView> {
  const world = await getWorld(id);
  if (!world) throw new NotFoundError("World not found.");
  return world;
}

/** Rejects a change while the world's server process is, or may be, alive. */
export function assertWorldStopped(world: Pick<WorldView, "status"> & { processId?: number | null }, message: string): void {
  if (!isWorldStopped(world) || world.processId) throw new ConflictError(message);
}

export async function createWorld(raw: unknown): Promise<WorldView> {
  const row = await withReservationLock(async () => {
    // Omitted ports are allocated under the reservation lock so concurrent
    // registrations cannot be handed the same suggestion.
    const provided = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const parsed = createWorldSchema.parse(PORT_FIELDS.some((field) => provided[field] == null) ? { platform: hostCapabilities().defaultWorldPlatform, ...await suggestWorldPorts(), ...Object.fromEntries(Object.entries(provided).filter(([, value]) => value != null)) } : { platform: hostCapabilities().defaultWorldPlatform, ...provided });
    assertSupportedTarget(parsed.platform);
    const installDir = await assertReservationsFree(parsed);
    const now = Date.now();
    const candidate: typeof worlds.$inferInsert = {
      id: randomUUID(), ...toWorldColumns({ ...pickManaged(parsed), installDir }, hostPlatform() === "win32" ? "windows" : "legacy"),
      adminPassword: parsed.adminPassword, serverPassword: parsed.serverPassword,
      status: "stopped", createdAt: now, updatedAt: now,
    };
    await database().insert(worlds).values(candidate); return candidate;
  });
  eventBus().publish({ type: "world", worldId: row.id, data: { action: "created" } });
  return (await getWorld(row.id))!;
}

export function exportWorldRegistration(world: WorldView): WorldRegistration {
  return worldRegistrationSchema.parse({
    format: "psm-next/world-registration",
    version: 2,
    exportedAt: new Date().toISOString(),
    sourceWorldId: world.id,
    world: { ...pickManaged(world), autostart: false },
  });
}

export async function unregisterWorld(id: string): Promise<void> {
  return holdWorldLock(id, () => withReservationLock(async () => {
    const world = await getWorld(id);
    if (!world) return;
    assertWorldStopped(world, "Stop the world before removing its registration.");
    await database().delete(worlds).where(and(eq(worlds.id, id), ne(worlds.status, "running")));
    eventBus().publish({ type: "world", worldId: id, data: { action: "unregistered" } });
  }));
}

export async function setRuntimeState(id: string, status: WorldView["status"], processId: number | null): Promise<void> {
  await database().update(worlds).set({ status, processId, updatedAt: Date.now() }).where(eq(worlds.id, id));
  eventBus().publish({ type: "world", worldId: id, data: { action: "status", status, processId } });
}

export async function validateInstallLocation(candidate: string): Promise<string> {
  const canonical = await canonicalInstallDir(candidate);
  if (canonical === path.parse(canonical).root) throw new ConflictError("An installation cannot use a drive or filesystem root.");
  if (pathsOverlap(canonical, await canonicalInstallDir(paths.data()))) throw new ConflictError("An installation cannot overlap manager-owned data.");
  return canonical;
}
