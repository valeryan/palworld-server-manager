import { validateAndEncodeSettingChanges } from "@/contracts/palworld-settings";
import { errorResponse, requireAdmin } from "@/server/http";
import { readConfigurationOptions, saveConfigurationOptions } from "@/server/services/configuration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { return Response.json({ ok: true, configuration: await readConfigurationOptions((await context.params).id) }); }
  catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const body = await request.json() as { changes?: unknown }; const changes = validateAndEncodeSettingChanges(body.changes); return Response.json({ ok: true, result: await saveConfigurationOptions((await context.params).id, changes) }); }
  catch (error) { return errorResponse(error); }
}
