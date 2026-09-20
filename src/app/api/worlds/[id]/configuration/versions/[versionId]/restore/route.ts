import { errorResponse, requireAdmin } from "@/server/http";
import { restoreConfiguration } from "@/server/services/configuration";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const { id, versionId } = await context.params; return Response.json({ ok: true, result: await restoreConfiguration(id, versionId) }); } catch (error) { return errorResponse(error); }
}
