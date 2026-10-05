import { errorResponse, requireAdmin } from "@/server/http";
import { deleteSchedule, updateSchedule } from "@/server/services/schedules";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, schedule: await updateSchedule((await context.params).id, await request.json()) }); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { await deleteSchedule((await context.params).id); return Response.json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
