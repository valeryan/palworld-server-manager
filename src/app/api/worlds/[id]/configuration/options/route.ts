import { validateAndEncodeSettingChanges } from "@/contracts/palworld-settings";
import { z } from "zod";
import { errorResponse, requireAdmin } from "@/server/http";
import { readConfigurationOptions, saveConfigurationOptions } from "@/server/services/configuration";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { return Response.json({ ok: true, configuration: await readConfigurationOptions((await context.params).id) }); }
  catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const body = z.object({ changes: z.unknown(), baseRevision: z.number().int().nonnegative() }).strict().parse(await request.json()); const changes = validateAndEncodeSettingChanges(body.changes); return Response.json({ ok: true, result: await saveConfigurationOptions((await context.params).id, changes, [], body.baseRevision) }); }
  catch (error) { return errorResponse(error); }
}
