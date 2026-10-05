import { errorResponse, requireAdmin } from "@/server/http";
import { createSchedule, listSchedules } from "@/server/services/schedules";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, schedules: await listSchedules((await context.params).id) }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, schedule: await createSchedule((await context.params).id, await request.json()) }, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
