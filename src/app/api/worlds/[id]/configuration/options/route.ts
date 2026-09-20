import { z } from "zod";
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
  try { const input = z.object({ changes: z.record(z.string(), z.string()).refine((value) => Object.keys(value).length <= 100) }).parse(await request.json()); return Response.json({ ok: true, result: await saveConfigurationOptions((await context.params).id, input.changes) }); }
  catch (error) { return errorResponse(error); }
}
