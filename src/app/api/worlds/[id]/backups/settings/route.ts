import { errorResponse, requireAdmin } from "@/server/http";
import { getBackupSettings, updateBackupSettings } from "@/server/services/backups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, settings: await getBackupSettings((await context.params).id) }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, settings: await updateBackupSettings((await context.params).id, await request.json()) }); }
  catch (error) { return errorResponse(error); }
}
