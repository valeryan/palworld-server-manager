import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { database } from "@/server/db";
import { deaths, events, sessions } from "@/server/db/schema";
import { paths } from "@/server/paths";
import { getWorld } from "./worlds";
import { palworldRest } from "./rest";

export async function worldActivity(worldId: string) {
  if (!await getWorld(worldId)) throw new Error("World not found.");
  const [eventRows, sessionRows, deathRows] = await Promise.all([
    database().select().from(events).where(eq(events.worldId, worldId)).orderBy(desc(events.createdAt)).limit(200),
    database().select().from(sessions).where(eq(sessions.worldId, worldId)).orderBy(desc(sessions.createdAt)).limit(200),
    database().select().from(deaths).where(eq(deaths.worldId, worldId)).orderBy(desc(deaths.createdAt)).limit(200),
  ]);
  return { events: eventRows, sessions: sessionRows, deaths: deathRows };
}

export async function worldLogs(worldId: string, selected?: string) {
  if (!await getWorld(worldId)) throw new Error("World not found.");
  const directory = paths.worldLogs(worldId);
  const names = (await readdir(directory).catch(() => [] as string[])).filter((name) => name.endsWith(".log")).sort().reverse();
  const name = selected && names.includes(selected) ? selected : names[0];
  if (!name) return { files: [], selected: null, content: "" };
  const filePath = path.join(directory, name); const info = await stat(filePath); const content = await readFile(filePath, "utf8");
  return { files: names, selected: name, sizeBytes: info.size, content: content.slice(-250_000) };
}

export async function worldLogFile(worldId: string, selected: string) {
  if (!await getWorld(worldId)) throw new Error("World not found.");
  const names = (await readdir(paths.worldLogs(worldId)).catch(() => [] as string[])).filter((name) => name.endsWith(".log"));
  if (!names.includes(selected)) throw new Error("Server log not found.");
  const filePath = path.join(paths.worldLogs(worldId), selected);
  return { filePath, fileName: selected, info: await stat(filePath) };
}

export async function liveWorldStatus(worldId: string) {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  if (world.status !== "running" || !world.restApiEnabled) return { reachable: false, info: null, players: null, metrics: null };
  try {
    const [info, players, metrics] = await Promise.all([palworldRest.info(world), palworldRest.players(world), palworldRest.metrics(world)]);
    return { reachable: true, info, players, metrics };
  } catch (error) { return { reachable: false, info: null, players: null, metrics: null, error: error instanceof Error ? error.message : String(error) }; }
}
