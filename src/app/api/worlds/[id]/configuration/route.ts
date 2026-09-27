import { z } from "zod";
import { errorResponse, requireAdmin } from "@/server/http";
import { readConfiguration, saveConfiguration } from "@/server/services/configuration";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json({ ok: true, configuration: await readConfiguration((await context.params).id) }); } catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const input = z.object({ content: z.string(), baseRevision: z.number().int().nonnegative() }).parse(await request.json()); return Response.json({ ok: true, result: await saveConfiguration((await context.params).id, input.content, input.baseRevision) }); } catch (error) { return errorResponse(error); }
}
