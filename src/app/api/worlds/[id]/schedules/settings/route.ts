import { errorResponse, requireAdmin } from "@/server/http";
import { getMaintenanceSettings, updateMaintenanceSettings } from "@/server/services/schedules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, settings: await getMaintenanceSettings((await context.params).id) }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, settings: await updateMaintenanceSettings((await context.params).id, await request.json()) }); }
  catch (error) { return errorResponse(error); }
}
