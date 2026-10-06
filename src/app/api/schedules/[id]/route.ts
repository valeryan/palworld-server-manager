import { route } from "@/server/http";
import { deleteSchedule, updateSchedule } from "@/server/services/schedules";

export const PATCH = route<{ id: string }>(async (request, { id }) => ({ schedule: await updateSchedule(id, await request.json()) }));
export const DELETE = route<{ id: string }>(async (_request, { id }) => { await deleteSchedule(id); });
