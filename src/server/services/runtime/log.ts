import "server-only";
import { database } from "@/server/db";
import { events } from "@/server/db/schema";

export async function log(worldId: string | null, kind: string, message: string): Promise<void> {
  await database().insert(events).values({ worldId, kind, message, createdAt: Date.now() });
}
