import { route } from "@/server/http";
import { createSchedule, listSchedules } from "@/server/services/schedules";

export const GET = route<{ id: string }>(async (_request, { id }) => ({ schedules: await listSchedules(id) }));
export const POST = route<{ id: string }>(async (request, { id }) => ({ schedule: await createSchedule(id, await request.json()) }), { status: 201 });
