import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MaintenanceSettingsInput } from "@/contracts/schedule";
import { createScheduleSchema, maintenanceSettingsSchema, updateScheduleSchema } from "@/contracts/schedule";
import { database } from "@/server/db";
import { maintenanceSettings, schedules } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import { requireWorld } from "./worlds";

type ScheduleRow = typeof schedules.$inferSelect;
export type CustomHttpConfiguration = { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; url: string; headers: string; body: string };

function durationMs(input: { mode: string; intervalHours?: number | null; intervalMinutes?: number | null }): number {
  if (input.mode === "interval") return ((input.intervalHours ?? 0) * 60 + (input.intervalHours == null ? input.intervalMinutes ?? 0 : 0)) * 60_000;
  return (input.intervalMinutes ?? 0) * 60_000;
}

export function nextRun(input: { mode: string; intervalHours?: number | null; intervalMinutes?: number | null; timeOfDay?: string | null }, now = Date.now()): number | null {
  if (input.mode === "on_join") return null;
  if (input.mode === "interval" || input.mode === "minutes") return now + durationMs(input);
  const [hours = 0, minutes = 0] = (input.timeOfDay ?? "").split(":").map(Number);
  const next = new Date(now); next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function parseCustomHttp(message: string | null | undefined): CustomHttpConfiguration | null {
  try {
    const value = JSON.parse(message ?? "") as Partial<CustomHttpConfiguration>;
    if (!value.url || !value.method) return null;
    return { method: value.method, url: value.url, headers: value.headers ?? "", body: value.body ?? "" };
  } catch { return null; }
}

function toValidationInput(row: ScheduleRow): Record<string, unknown> {
  const http = row.action === "custom_http" ? parseCustomHttp(row.message) : null;
  return {
    action: row.action, mode: row.mode, intervalHours: row.intervalHours ?? undefined, intervalMinutes: row.intervalMinutes ?? undefined,
    timeOfDay: row.timeOfDay ?? undefined, message: row.action === "custom_http" ? undefined : row.message ?? undefined,
    joinMatch: row.joinMatch ?? undefined, joinDelaySeconds: row.joinDelaySeconds ?? undefined, enabled: row.enabled,
    ...(http ? { httpMethod: http.method, httpUrl: http.url, httpHeaders: http.headers, httpBody: http.body } : {}),
  };
}

export async function listSchedules(worldId: string) {
  return database().select().from(schedules).where(eq(schedules.worldId, worldId)).orderBy(schedules.createdAt);
}

export async function createSchedule(worldId: string, value: unknown) {
  await requireWorld(worldId);
  const input = createScheduleSchema.parse(value); const now = Date.now();
  const message = input.action === "custom_http" ? JSON.stringify({ method: input.httpMethod ?? "GET", url: input.httpUrl!, headers: input.httpHeaders ?? "", body: input.httpBody ?? "" } satisfies CustomHttpConfiguration) : input.message ?? null;
  const record: typeof schedules.$inferInsert = {
    id: randomUUID(), worldId, action: input.action, mode: input.mode,
    intervalHours: input.mode === "interval" ? input.intervalHours ?? null : null,
    intervalMinutes: input.mode === "minutes" || (input.mode === "interval" && input.intervalHours == null) ? input.intervalMinutes ?? null : null,
    timeOfDay: input.mode === "daily" ? input.timeOfDay ?? null : null, message,
    joinMatch: input.mode === "on_join" ? input.joinMatch || null : null,
    joinDelaySeconds: input.mode === "on_join" ? input.joinDelaySeconds ?? 0 : null,
    enabled: input.enabled, skipNext: false, nextRunAt: nextRun(input, now), createdAt: now,
  };
  await database().insert(schedules).values(record);
  return record;
}

export async function updateSchedule(id: string, value: unknown) {
  const input = updateScheduleSchema.parse(value);
  const [current] = await database().select().from(schedules).where(eq(schedules.id, id)).limit(1);
  if (!current) throw new NotFoundError("Schedule not found.");
  if (input.enabled === true) createScheduleSchema.parse(toValidationInput(current));
  const nextRunAt = input.enabled === true && !current.enabled ? nextRun(current, Date.now()) : current.nextRunAt;
  await database().update(schedules).set({ ...input, nextRunAt }).where(eq(schedules.id, id));
  return (await database().select().from(schedules).where(eq(schedules.id, id)).limit(1))[0];
}

export async function deleteSchedule(id: string): Promise<void> {
  const result = await database().delete(schedules).where(eq(schedules.id, id));
  if (!result.changes) throw new NotFoundError("Schedule not found.");
}

export async function getMaintenanceSettings(worldId: string): Promise<MaintenanceSettingsInput> {
  await requireWorld(worldId);
  const [record] = await database().select().from(maintenanceSettings).where(eq(maintenanceSettings.worldId, worldId)).limit(1);
  return maintenanceSettingsSchema.parse(record ?? {});
}

export async function updateMaintenanceSettings(worldId: string, value: unknown): Promise<MaintenanceSettingsInput> {
  await requireWorld(worldId);
  const input = maintenanceSettingsSchema.parse(value); const updatedAt = Date.now();
  await database().insert(maintenanceSettings).values({ worldId, ...input, updatedAt }).onConflictDoUpdate({ target: maintenanceSettings.worldId, set: { ...input, updatedAt } });
  return input;
}
