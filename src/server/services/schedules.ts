import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { CreateScheduleInput } from "@/contracts/schedule";
import { createScheduleSchema, updateScheduleSchema } from "@/contracts/schedule";
import { database } from "@/server/db";
import { schedules } from "@/server/db/schema";
import { getWorld } from "./worlds";

export function nextRun(input: Pick<CreateScheduleInput, "mode"> & Partial<CreateScheduleInput>, now = Date.now()): number {
  if (input.mode === "interval") return now + (input.intervalMinutes ?? 0) * 60_000;
  const [hours = 0, minutes = 0] = (input.timeOfDay ?? "").split(":").map(Number);
  const next = new Date(now); next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export async function listSchedules(worldId: string) {
  return database().select().from(schedules).where(eq(schedules.worldId, worldId));
}

export async function createSchedule(worldId: string, value: unknown) {
  if (!await getWorld(worldId)) throw new Error("World not found.");
  const input = createScheduleSchema.parse(value); const now = Date.now();
  const record = {
    id: randomUUID(), worldId, action: input.action, mode: input.mode,
    intervalMinutes: input.mode === "interval" ? input.intervalMinutes : null,
    timeOfDay: input.mode === "daily" ? input.timeOfDay : null,
    enabled: input.enabled, skipNext: false, nextRunAt: nextRun(input, now), createdAt: now,
  } as const;
  await database().insert(schedules).values(record);
  return record;
}

export async function updateSchedule(id: string, value: unknown) {
  const input = updateScheduleSchema.parse(value);
  const [current] = await database().select().from(schedules).where(eq(schedules.id, id)).limit(1);
  if (!current) throw new Error("Schedule not found.");
  const supported = (current.action === "backup" || current.action === "restart") && (current.mode === "interval" || current.mode === "daily");
  if (input.enabled === true && !supported) throw new Error("This imported schedule type is not available in the core release.");
  const nextRunAt = input.enabled === true && !current.enabled
    ? nextRun({ mode: current.mode as "interval" | "daily", intervalMinutes: current.intervalMinutes ?? undefined, timeOfDay: current.timeOfDay ?? undefined }, Date.now())
    : current.nextRunAt;
  await database().update(schedules).set({ ...input, nextRunAt }).where(eq(schedules.id, id));
  return (await database().select().from(schedules).where(eq(schedules.id, id)).limit(1))[0];
}

export async function deleteSchedule(id: string): Promise<void> {
  const result = await database().delete(schedules).where(eq(schedules.id, id));
  if (!result.changes) throw new Error("Schedule not found.");
}
