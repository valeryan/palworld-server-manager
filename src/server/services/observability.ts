import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { database } from "@/server/db";
import { deaths, events, sessions } from "@/server/db/schema";
import { paths } from "@/server/paths";
import { NotFoundError } from "@/server/errors";
import { requireWorld } from "./worlds";
import { palworldRest } from "./rest";
import { legacyModerationEvent, moderationEventMessage } from "@/lib/moderation-presentation";

export async function worldActivity(worldId: string, requestedLimit = 25) {
  await requireWorld(worldId);
  const limit = Math.min(Math.max(Math.trunc(requestedLimit) || 25, 5), 500);
  const [eventRows, sessionRows, deathRows] = await Promise.all([
    database().select().from(events).where(eq(events.worldId, worldId)).orderBy(desc(events.createdAt)).limit(limit + 1),
    database().select().from(sessions).where(eq(sessions.worldId, worldId)).orderBy(desc(sessions.createdAt)).limit(limit + 1),
    database().select().from(deaths).where(eq(deaths.worldId, worldId)).orderBy(desc(deaths.createdAt)).limit(limit + 1),
  ]);
  const presentedEvents = eventRows.slice(0, limit).map((event) => {
    const legacy = event.kind === "administrator" ? legacyModerationEvent(event.message) : null;
    if (!legacy) return event;
    const matchingSessions = sessionRows.filter((session) => session.userId === legacy.userId);
    const nearest = matchingSessions.find((session) => session.createdAt <= event.createdAt) ?? matchingSessions[0];
    return { ...event, message: moderationEventMessage(legacy.action, legacy.userId, nearest?.playerName) };
  });
  return { events: presentedEvents, sessions: sessionRows.slice(0, limit), deaths: deathRows.slice(0, limit), hasMore: { events: eventRows.length > limit, sessions: sessionRows.length > limit, deaths: deathRows.length > limit } };
}

export async function worldLogs(worldId: string, selected?: string) {
  await requireWorld(worldId);
  const directory = paths.worldLogs(worldId);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".log")).sort().reverse();
  const name = selected && names.includes(selected) ? selected : names[0];
  if (!name) return { files: [], selected: null, content: "" };
  const filePath = path.join(/* turbopackIgnore: true */ directory, name); const info = await stat(filePath); const content = await readFile(filePath, "utf8");
  return { files: names, selected: name, sizeBytes: info.size, content: content.slice(-250_000) };
}

export async function worldLogFile(worldId: string, selected: string) {
  await requireWorld(worldId);
  const names = (await readdir(paths.worldLogs(worldId))).filter((name) => name.endsWith(".log"));
  if (!names.includes(selected)) throw new NotFoundError("Server log not found.");
  const filePath = path.join(paths.worldLogs(worldId), selected);
  return { filePath, fileName: selected, info: await stat(filePath) };
}

export async function liveWorldStatus(worldId: string) {
  const world = await requireWorld(worldId);
  if (world.status !== "running" || !world.restApiEnabled) return { reachable: false, info: null, players: null, metrics: null };
  try {
    const [info, players, metrics] = await Promise.all([palworldRest.info(world), palworldRest.players(world), palworldRest.metrics(world)]);
    return { reachable: true, info, players, metrics };
  } catch (error) { return { reachable: false, info: null, players: null, metrics: null, error: error instanceof Error ? error.message : String(error) }; }
}
