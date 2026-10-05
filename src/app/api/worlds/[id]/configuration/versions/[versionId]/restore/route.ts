import { errorResponse, requireAdmin } from "@/server/http";
import { z } from "zod";
import { restoreConfiguration } from "@/server/services/configuration";
export async function POST(request: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const { id, versionId } = await context.params; const { baseRevision } = z.object({ baseRevision: z.number().int().nonnegative() }).parse(await request.json()); return Response.json({ ok: true, result: await restoreConfiguration(id, versionId, baseRevision) }); } catch (error) { return errorResponse(error); }
}
