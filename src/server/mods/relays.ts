import "server-only";
import path from "node:path";
import { createHash } from "node:crypto";
import { appendFile, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { RelayId, RelayView } from "@/contracts/mod";
import type { WorldView } from "@/contracts/world";
import { database } from "@/server/db";
import { appSettings, deaths, events } from "@/server/db/schema";
import { paths } from "@/server/paths";
import { movePath } from "@/server/services/archive";
import { palworldRest } from "@/server/services/rest";
import { runsUnderWine } from "@/server/services/wine";
import { editModsTxt, MANAGED_MARKER, modsTxtState, parseModsTxt } from "./lua-mods";
import { resolveModsDirectory, ue4ssLayout } from "./ue4ss";
import { runtimeRow } from "./ue4ss-runtime";

// The manager's own UE4SS Lua mods, bundled with the app (src/server/mods/lua).
export const RELAYS: Record<RelayId, { folder: string; placeholder: string; file: string }> = {
  "death-relay": { folder: "PSMDeathRelay", placeholder: "__PSM_OUT_PATH__", file: "psm-deaths.jsonl" },
  broadcast: { folder: "PSMBroadcast", placeholder: "__PSM_QUEUE_PATH__", file: "psm-broadcast.jsonl" },
};
export const RELAY_FOLDERS = new Set(Object.values(RELAYS).map((relay) => relay.folder));

type RelayWorld = Pick<WorldView, "id" | "installDir" | "platform" | "status">;
interface RelayMarker { builtin: RelayId; version: number; sha256: string }

function bundledScript(relay: RelayId): string { return path.join(/* turbopackIgnore: true */ process.cwd(), "src", "server", "mods", "lua", RELAYS[relay].folder, "Scripts", "main.lua"); }
function savedFile(world: Pick<WorldView, "installDir">, relay: RelayId): string { return path.join(/* turbopackIgnore: true */ world.installDir, "Pal", "Saved", RELAYS[relay].file); }
export function relayVersion(source: string): number { return Number(source.match(/^-- PSM_MOD_VERSION (\d+)/m)?.[1] ?? 0); }

// Paths as the game process sees them: Wine exposes the Linux filesystem as drive Z:.
function gamePath(world: Pick<WorldView, "platform">, file: string): string { const forward = file.split(path.sep).join("/"); return runsUnderWine(world) ? `Z:${forward}` : forward; }

export function renderRelay(source: string, relay: RelayId, world: Pick<WorldView, "installDir" | "platform">): string {
  const target = gamePath(world, savedFile(world, relay));
  if (target.includes("]]")) throw new Error("The world path cannot be written into a Lua string.");
  return source.replace(RELAYS[relay].placeholder, target);
}

async function folderOf(world: Pick<WorldView, "installDir" | "platform">, relay: RelayId): Promise<{ directory: string; folder: string }> {
  const directory = await resolveModsDirectory(ue4ssLayout(world));
  return { directory, folder: path.join(/* turbopackIgnore: true */ directory, RELAYS[relay].folder) };
}
async function readMarker(folder: string): Promise<RelayMarker | null> {
  try { const marker = JSON.parse(await readFile(path.join(/* turbopackIgnore: true */ folder, MANAGED_MARKER), "utf8")) as RelayMarker; return marker.builtin ? marker : null; } catch { return null; }
}
function assertStopped(world: RelayWorld): void { if (world.status !== "stopped" && world.status !== "crashed") throw new Error("Stop the server before changing PSM relays."); }

export async function relayStatus(world: Pick<WorldView, "id" | "installDir" | "platform">): Promise<RelayView[]> {
  const runtime = await runtimeRow(world.id);
  return Promise.all((Object.keys(RELAYS) as RelayId[]).map(async (id) => {
    const bundled = relayVersion(await readFile(bundledScript(id), "utf8"));
    const { directory, folder } = await folderOf(world, id);
    const present = await stat(folder).then((info) => info.isDirectory(), () => false);
    const marker = present ? await readMarker(folder) : null;
    const listed = parseModsTxt(await readFile(path.join(/* turbopackIgnore: true */ directory, "mods.txt"), "utf8").catch(() => ""));
    const enabled = present && listed.get(RELAYS[id].folder) === true;
    return { id, folder: RELAYS[id].folder, installed: present, managed: marker !== null, enabled, active: enabled && Boolean(runtime?.enabled), version: marker?.version ?? null, bundledVersion: bundled, updateAvailable: Boolean(marker && marker.version < bundled) };
  }));
}

// Writes the bundled relay into the world with this world's paths filled in, and turns it on.
export async function installRelay(world: RelayWorld, relay: RelayId, options: { replace?: boolean } = {}): Promise<void> {
  assertStopped(world);
  const source = await readFile(bundledScript(relay), "utf8");
  const { directory, folder } = await folderOf(world, relay);
  const present = await stat(folder).then(() => true, () => false);
  const managed = present && await readMarker(folder) !== null;
  if (present && !managed) {
    if (!options.replace) throw new Error(`${RELAYS[relay].folder} already exists in this world but was not installed by PSM. Use "Replace with library version".`);
    await movePath(folder, path.join(/* turbopackIgnore: true */ paths.modTrash(world.id), `${RELAYS[relay].folder}-${Date.now()}`));
  }
  const script = renderRelay(source, relay, world);
  await mkdir(path.join(/* turbopackIgnore: true */ folder, "Scripts"), { recursive: true });
  await writeFile(path.join(/* turbopackIgnore: true */ folder, "Scripts", "main.lua"), script);
  const marker: RelayMarker = { builtin: relay, version: relayVersion(source), sha256: createHash("sha256").update(script).digest("hex") };
  await writeFile(path.join(/* turbopackIgnore: true */ folder, MANAGED_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
  await mkdir(path.dirname(savedFile(world, relay)), { recursive: true });
  // A first install turns the relay on; updating or repairing keeps its current on/off choice.
  await editModsTxt(directory, RELAYS[relay].folder, managed ? await modsTxtState(directory, RELAYS[relay].folder) : true);
}

export async function relayActive(world: Pick<WorldView, "id" | "installDir" | "platform">, relay: RelayId): Promise<boolean> {
  return (await relayStatus(world)).some((entry) => entry.id === relay && entry.active);
}

// PSM Broadcast touches this file every few seconds while it runs in the game.
const HEARTBEAT_MS = 15_000;
function heartbeatFile(world: Pick<WorldView, "installDir">): string { return savedFile(world, "broadcast").replace(/\.jsonl$/, ".alive"); }
async function broadcastAlive(world: Pick<WorldView, "installDir">): Promise<boolean> {
  return stat(heartbeatFile(world)).then((info) => Date.now() - info.mtimeMs < HEARTBEAT_MS, () => false);
}

// Called before each server start: the relay reads the queue from the top, so it must start empty,
// and a heartbeat left by the previous run must not count for this one.
export async function resetBroadcastQueue(world: Pick<WorldView, "installDir">): Promise<void> {
  if (await stat(savedFile(world, "broadcast")).then(() => true, () => false)) await writeFile(savedFile(world, "broadcast"), "");
  await rm(heartbeatFile(world), { force: true });
}

// On-screen when PSM Broadcast is installed, enabled, and running in the game; otherwise
// Palworld's REST announce (a chat line), including while the server is still booting.
export async function deliverNotice(world: WorldView, message: string): Promise<"broadcast" | "rest"> {
  if (await relayActive(world, "broadcast").catch(() => false) && await broadcastAlive(world)) {
    const line = `${JSON.stringify({ b64: Buffer.from(message, "utf8").toString("base64"), at: Date.now() })}\n`;
    await mkdir(path.dirname(savedFile(world, "broadcast")), { recursive: true });
    await appendFile(savedFile(world, "broadcast"), line);
    return "broadcast";
  }
  await palworldRest.announce(world, message);
  return "rest";
}

// Death capture: the manager reads new lines from each running world's death file into the
// Deaths tab. The read position is saved, so a manager restart neither loses nor repeats deaths.
declare global { var __psmDeathTails: Map<string, NodeJS.Timeout> | undefined }
const tails = () => (globalThis.__psmDeathTails ??= new Map<string, NodeJS.Timeout>());
const offsetKey = (worldId: string) => `relay-offset:${worldId}:death-relay`;
const MAX_READ_BYTES = 1024 * 1024;

async function savedOffset(worldId: string): Promise<number> {
  const [row] = await database().select().from(appSettings).where(eq(appSettings.key, offsetKey(worldId))).limit(1);
  return typeof row?.value === "number" ? row.value : 0;
}

function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }

// Reads complete lines added since the saved position; a partial last line waits for the next pass.
// One read per world at a time, and the deaths and the new position are saved together, so an
// overlapping poll or a manager exit mid-read cannot record the same death twice.
declare global { var __psmDeathReads: Map<string, Promise<number>> | undefined }
const reads = () => (globalThis.__psmDeathReads ??= new Map<string, Promise<number>>());

export function readNewDeaths(world: Pick<WorldView, "id" | "installDir">): Promise<number> {
  const previous = reads().get(world.id) ?? Promise.resolve(0);
  const next = previous.catch(() => 0).then(() => readDeathsOnce(world));
  reads().set(world.id, next);
  void next.finally(() => { if (reads().get(world.id) === next) reads().delete(world.id); }).catch(() => undefined);
  return next;
}

async function readDeathsOnce(world: Pick<WorldView, "id" | "installDir">): Promise<number> {
  const file = savedFile(world, "death-relay");
  const size = await stat(file).then((info) => info.size, () => null);
  if (size === null) return 0;
  let offset = await savedOffset(world.id);
  if (size < offset) offset = 0;
  if (size === offset) return 0;
  const handle = await open(file, "r");
  let chunk: Buffer;
  try { const length = Math.min(size - offset, MAX_READ_BYTES); chunk = Buffer.alloc(length); await handle.read(chunk, 0, length, offset); }
  finally { await handle.close(); }
  const end = chunk.lastIndexOf(0x0a);
  if (end < 0) return 0;
  const rows: Array<typeof deaths.$inferInsert> = [];
  for (const line of chunk.subarray(0, end).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const victim = text(entry.victim); if (!victim) continue;
      const killer = text(entry.killer);
      rows.push({ worldId: world.id, victim, cause: text(entry.cause), killer, killerRaw: killer, killerKind: text(entry.killerKind), createdAt: typeof entry.at === "number" ? entry.at : Date.now() });
    } catch { /* A malformed line is skipped rather than blocking the rest. */ }
  }
  const position = offset + end + 1;
  database().transaction((tx) => {
    if (rows.length) tx.insert(deaths).values(rows).run();
    tx.insert(appSettings).values({ key: offsetKey(world.id), value: position }).onConflictDoUpdate({ target: appSettings.key, set: { value: position } }).run();
  });
  return rows.length;
}

export function startDeathCapture(world: Pick<WorldView, "id" | "installDir">): void {
  if (tails().has(world.id)) return;
  const timer = setInterval(() => { void readNewDeaths(world).catch(() => undefined); }, 2_000);
  timer.unref(); tails().set(world.id, timer);
}

export async function stopDeathCapture(world: Pick<WorldView, "id" | "installDir">): Promise<void> {
  const timer = tails().get(world.id); if (timer) clearInterval(timer);
  tails().delete(world.id);
  await readNewDeaths(world).catch(() => undefined);
}

export async function noteRelayDelivery(worldId: string, route: "broadcast" | "rest", message: string): Promise<void> {
  await database().insert(events).values({ worldId, kind: "notice", message: route === "broadcast" ? `On-screen notice: ${message}` : `Notice sent as a chat message (PSM Broadcast not running): ${message}`, createdAt: Date.now() });
}

// A managed relay's script must still be the one PSM rendered for this world.
export async function checkRelayFiles(world: Pick<WorldView, "id" | "installDir" | "platform">): Promise<Array<{ id: RelayId; missing: boolean; changed: boolean }>> {
  const results: Array<{ id: RelayId; missing: boolean; changed: boolean }> = [];
  for (const id of Object.keys(RELAYS) as RelayId[]) {
    const { folder } = await folderOf(world, id);
    const marker = await readMarker(folder); if (!marker) continue;
    const script = await readFile(path.join(/* turbopackIgnore: true */ folder, "Scripts", "main.lua")).catch(() => null);
    results.push({ id, missing: script === null, changed: script !== null && createHash("sha256").update(script).digest("hex") !== marker.sha256 });
  }
  return results;
}
